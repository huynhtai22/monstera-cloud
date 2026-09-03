import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { safeDecrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { parseConnectionCredentialsJson } from "@/lib/parse-connection-credentials";
import { requireCronSecret } from "@/lib/request-auth";
import { syncConnectionData } from "@/lib/sync-connection";
import { runPostWarehouseRefreshQualityChecks } from "@/lib/observability/data-quality";
import { claimNextImportJob } from "@/lib/warehouse-import-job";
import { runDurableImportWorker } from "@/app/api/data-explorer/warehouse/import-batch/route";
import { workspaceAllowsScheduledRefresh } from "@/lib/plan-config";
import { withSystemScope } from "@/lib/tenant-guard";

const PILOT_PROVIDERS = new Set(["meta_ads", "google_ads", "tiktok_business", "shopee"]);

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

/**
 * GET /api/cron/warehouse-refresh?lookbackDays=30
 * Warehouse-only refresh for all connected ad sources.
 * Supports lookbackDays (e.g. lookbackDays=3 for frequent 4h cron runs).
 */
export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const startTime = Date.now();
  const url = new URL(request.url);
  const lookbackParam = parseInt(url.searchParams.get("lookbackDays") || "30", 10);
  const lookbackDays = Number.isFinite(lookbackParam) && lookbackParam > 0 ? Math.min(lookbackParam, 90) : 30;
  const sinceDate = isoDate(-(lookbackDays - 1));
  const untilDate = isoDate();

  const workspaces = await prisma.workspace.findMany({
    where: { status: { in: ["PILOT", "ACTIVE"] } },
    select: {
      id: true,
      plan: true,
      providerAccess: { where: { enabled: true }, select: { provider: true } },
      connections: {
        where: { type: "source", status: "connected" },
        select: { id: true, provider: true, credentials: true },
      },
    },
  });

  const jobs = workspaces.flatMap((workspace) => {
    if (!workspaceAllowsScheduledRefresh(workspace.plan)) return [];
    const enabled = new Set(workspace.providerAccess.map((access) => access.provider));
    return workspace.connections
      .filter((connection) => PILOT_PROVIDERS.has(connection.provider) && enabled.has(connection.provider))
      .map((connection) => ({ workspace, connection }));
  });

  const results: Array<{ workspaceId: string; connectionId: string; provider: string; ok: boolean; rows: number; error?: string }> = [];
  for (let index = 0; index < jobs.length; index += 3) {
    const batch = jobs.slice(index, index + 3);
    const settled = await Promise.all(batch.map(async ({ workspace, connection }) => {
      try {
        const credentials = parseConnectionCredentialsJson(safeDecrypt(connection.credentials)) as Record<string, unknown>;
        const result = await syncConnectionData({
          workspaceId: workspace.id,
          connectionId: connection.id,
          provider: connection.provider,
          credentials,
          userPlan: workspace.plan,
          since: sinceDate,
          until: untilDate,
        });
        if (result.success) {
          // lastSyncAt/lastError are persisted by the lease-fenced
          // persistConnectionSyncOutcome inside syncConnectionData; this route
          // must not write them again (an unfenced duplicate could misreport
          // freshness after a lease steal).

          // Await post-refresh data quality checks
          try {
            await runPostWarehouseRefreshQualityChecks(workspace.id, connection.id);
          } catch (dqErr) {
            logger.error("[WAREHOUSE_REFRESH][DATA_QUALITY]", { workspaceId: workspace.id, connectionId: connection.id }, dqErr);
          }
        }
        return {
          workspaceId: workspace.id,
          connectionId: connection.id,
          provider: connection.provider,
          ok: result.success,
          rows: result.rowsIngested,
          ...(result.error ? { error: result.error } : {}),
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Refresh failed";
        logger.error("[WAREHOUSE_REFRESH]", { workspaceId: workspace.id, connectionId: connection.id, provider: connection.provider }, error);
        await prisma.connection.updateMany({
          where: { id: connection.id, workspaceId: workspace.id },
          data: { lastError: message },
        });
        return { workspaceId: workspace.id, connectionId: connection.id, provider: connection.provider, ok: false, rows: 0, error: message };
      }
    }));
    results.push(...settled);
  }

  // Drain and process up to 3 queued/pending background import jobs
  let processedImportJobs = 0;
  for (let i = 0; i < 3; i++) {
    try {
      const claim = await claimNextImportJob();
      if (claim.claimed && claim.job && claim.leaseId) {
        await runDurableImportWorker(claim.job.id, claim.leaseId);
        processedImportJobs++;
      } else {
        break;
      }
    } catch (jobErr) {
      logger.error("[WAREHOUSE_REFRESH][JOB_DRAIN]", jobErr);
      break;
    }
  }

  const durationMs = Date.now() - startTime;
  const succeeded = results.filter((result) => result.ok).length;
  const totalRows = results.reduce((sum, r) => sum + (r.rows || 0), 0);

  // Stale data canary: identify active connections that have not synced in > 26 hours
  let staleConnectionsCount = 0;
  try {
    const staleThreshold = new Date(Date.now() - 26 * 60 * 60 * 1000);
    const staleList = await withSystemScope(() =>
      prisma.connection.findMany({
        where: {
          status: "connected",
          type: "source",
          OR: [
            { lastSyncAt: { lt: staleThreshold } },
            { lastSyncAt: null },
          ],
        },
        select: { id: true, provider: true, lastSyncAt: true },
      })
    );
    staleConnectionsCount = staleList.length;
    if (staleConnectionsCount > 0) {
      logger.warn("[WAREHOUSE_REFRESH_STALE_CANARY]", {
        staleConnectionsCount,
        sample: staleList.slice(0, 5),
      });
    }
  } catch (canaryErr) {
    logger.warn("[WAREHOUSE_REFRESH_STALE_CANARY_FAIL]", canaryErr);
  }

  logger.info("[WAREHOUSE_REFRESH_COMPLETE]", {
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    totalRows,
    processedImportJobs,
    staleConnectionsCount,
    durationMs,
    lookbackDays,
  });

  return NextResponse.json({
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    totalRows,
    processedImportJobs,
    staleConnectionsCount,
    durationMs,
    window: { since: sinceDate, until: untilDate, lookbackDays },
    results,
  });
}
