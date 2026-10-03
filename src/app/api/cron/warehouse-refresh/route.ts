import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireCronSecret } from "@/lib/request-auth";
import { createImportJob } from "@/lib/warehouse-import-job";
import { getPlanLimits } from "@/lib/plan-config";
import { withSystemScope } from "@/lib/tenant-guard";

const PILOT_PROVIDERS = new Set(["meta_ads", "google_ads", "tiktok_business", "shopee"]);

function isoDate(offsetDays = 0, from = new Date()) {
  const date = new Date(from.getTime());
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

/**
 * GET /api/cron/warehouse-refresh?lookbackDays=30
 * Warehouse-only refresh for all connected ad sources.
 * Supports lookbackDays (e.g. lookbackDays=3 for frequent 4h cron runs).
 */
export async function GET(request: Request) {
  const denied = requireCronSecret(request, "warehouse_refresh");
  if (denied) return denied;

  const startTime = Date.now();
  const now = new Date();
  const url = new URL(request.url);
  const lookbackParam = parseInt(url.searchParams.get("lookbackDays") || "30", 10);
  const lookbackDays = Number.isFinite(lookbackParam) && lookbackParam > 0 ? Math.min(lookbackParam, 90) : 30;
  const untilDate = isoDate(0, now);

  const workspaces = await prisma.workspace.findMany({
    where: { status: { in: ["PILOT", "ACTIVE"] } },
    select: {
      id: true,
      ownerId: true,
      plan: true,
      providerAccess: { where: { enabled: true }, select: { provider: true } },
      connections: {
        where: { type: "source", status: "connected" },
        select: { id: true, provider: true },
      },
    },
  });

  const schedules = workspaces.flatMap((workspace) => {
    const cadence = getPlanLimits(workspace.plan).scheduledRefresh;
    if (cadence === "none") return [];
    const enabled = new Set(workspace.providerAccess.map((access) => access.provider));
    const connections = workspace.connections.filter(
      (connection) => PILOT_PROVIDERS.has(connection.provider) && enabled.has(connection.provider),
    );
    if (connections.length === 0) return [];

    // One durable job per workspace/slot avoids multiplying the global queue
    // load by the number of connected sources. A job keeps per-connection
    // outcomes and retries, while the worker processes its item list.
    const hourly = cadence === "hourly";
    const slot = `hourly:${untilDate}T${now.toISOString().slice(11, 13)}`;
    return [{
      workspace,
      connections,
      cadence,
      windows: hourly
        ? [
            { slot, days: 9 },
            { slot: `daily-repair:${untilDate}`, days: lookbackDays },
          ]
        : [{ slot: `daily:${untilDate}`, days: lookbackDays }],
    }];
  });

  const results: Array<{ workspaceId: string; cadence: string; connectionCount: number; queued: boolean; jobId?: string; error?: string }> = [];
  for (const { workspace, connections, cadence, windows } of schedules) {
    for (const schedule of windows) {
      const since = isoDate(-(schedule.days - 1), now);
      try {
        const job = await createImportJob({
          workspaceId: workspace.id,
          userId: workspace.ownerId,
          plan: workspace.plan,
          since,
          until: untilDate,
          items: connections.map((connection) => ({ connectionId: connection.id })),
          idempotencyKey: `scheduled:${workspace.id}:${schedule.slot}`,
        });
        const accepted = job.status !== "failed" && job.status !== "partial";
        results.push({
          workspaceId: workspace.id,
          cadence,
          connectionCount: connections.length,
          queued: accepted,
          jobId: job.id,
          ...(!accepted ? { error: `Prior scheduled job ended as ${job.status}` } : {}),
        });
      } catch (error) {
        logger.error("[WAREHOUSE_REFRESH][QUEUE]", { workspaceId: workspace.id, cadence, connectionCount: connections.length }, error);
        results.push({ workspaceId: workspace.id, cadence, connectionCount: connections.length, queued: false, error: "Could not queue scheduled refresh" });
      }
    }
  }

  const durationMs = Date.now() - startTime;
  const succeeded = results.filter((result) => result.queued).length;

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

  logger.info("[WAREHOUSE_REFRESH_QUEUED]", {
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    staleConnectionsCount,
    durationMs,
    lookbackDays,
  });

  return NextResponse.json({
    total: results.length,
    queued: succeeded,
    failed: results.length - succeeded,
    staleConnectionsCount,
    durationMs,
    until: untilDate,
    window: { since: isoDate(-(lookbackDays - 1), now), until: untilDate, lookbackDays },
    results,
  }, { status: results.some((result) => !result.queued) ? 207 : 200 });
}
