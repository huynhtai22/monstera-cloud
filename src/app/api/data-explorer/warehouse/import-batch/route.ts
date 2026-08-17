import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { syncMetaInsightsIntoWarehouse } from "@/lib/ingestion/meta-campaign-metrics";
import { syncConnectionData } from "@/lib/sync-connection";
import { safeDecrypt } from "@/lib/encryption";
import { parseConnectionCredentialsJson } from "@/lib/parse-connection-credentials";
import { logger } from "@/lib/logger";
import { requireWorkspaceAccess } from "@/lib/rbac";

import { randomUUID } from "crypto";
import {
  createImportJob,
  updateImportJob,
  type BatchImportJobResult,
} from "@/lib/warehouse-import-job";

const AD_PROVIDERS = new Set([
  "meta_ads",
  "google_ads",
  "tiktok_business",
  "shopee",
]);

/** One import job — Meta may repeat per ad account id */
export interface BatchImportItem {
  connectionId: string;
  /** Meta only: constrain to one ad account; omit = all accounts on connection */
  adAccountId?: string;
}

async function processBatchItems(params: {
  workspaceId: string;
  since: string;
  until: string;
  plan: string;
  items: BatchImportItem[];
  onProgress?: (progress: { completed: number; total: number; results: BatchImportJobResult[] }) => Promise<void>;
}): Promise<BatchImportJobResult[]> {
  const { workspaceId, since, until, plan, items, onProgress } = params;
  const results: BatchImportJobResult[] = [];
  const processedNonMetaConnections = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const conn = await prisma.connection.findFirst({
      where: {
        id: item.connectionId,
        workspaceId,
        type: "source",
      },
      select: { id: true, provider: true },
    });

    if (!conn || !AD_PROVIDERS.has(conn.provider)) {
      results.push({
        connectionId: item.connectionId,
        provider: conn?.provider ?? "unknown",
        adAccountId: item.adAccountId,
        ok: false,
        error: "Connection not found or not a supported ad warehouse source.",
      });
      if (onProgress) await onProgress({ completed: i + 1, total: items.length, results });
      continue;
    }

    try {
      if (conn.provider === "meta_ads") {
        const r = await syncMetaInsightsIntoWarehouse({
          workspaceId,
          connectionId: conn.id,
          since,
          until,
          userPlan: plan,
          adAccountId: item.adAccountId || undefined,
        });
        results.push({
          connectionId: conn.id,
          provider: conn.provider,
          adAccountId: item.adAccountId,
          ok: true,
          upserted: r.upserted,
        });
      } else {
        if (processedNonMetaConnections.has(conn.id)) {
          results.push({
            connectionId: conn.id,
            provider: conn.provider,
            ok: true,
            rowsIngested: 0,
          });
          if (onProgress) await onProgress({ completed: i + 1, total: items.length, results });
          continue;
        }
        processedNonMetaConnections.add(conn.id);
        const raw = safeDecrypt(
          (
            await prisma.connection.findFirstOrThrow({
              where: { id: conn.id, workspaceId },
              select: { credentials: true },
            })
          ).credentials,
        );
        const credentials = parseConnectionCredentialsJson(raw) as Record<string, unknown>;
        const sync = await syncConnectionData({
          connectionId: conn.id,
          provider: conn.provider,
          credentials,
          workspaceId,
          since,
          until,
          userPlan: plan,
        });
        results.push({
          connectionId: conn.id,
          provider: conn.provider,
          ok: sync.success,
          rowsIngested: sync.rowsIngested,
          error: sync.error,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Import failed";
      logger.error("[warehouse/import-batch]", { connectionId: conn.id }, e);
      results.push({
        connectionId: conn.id,
        provider: conn.provider,
        adAccountId: item.adAccountId,
        ok: false,
        error: msg,
      });
    }

    if (onProgress) {
      await onProgress({ completed: i + 1, total: items.length, results });
    }
  }

  return results;
}

/**
 * POST /api/data-explorer/warehouse/import-batch
 * Runs warehouse refresh for selected connections (and optional Meta ad accounts).
 * Supports both synchronous and asynchronous (async: true) execution modes.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    workspaceId?: string;
    since?: string;
    until?: string;
    items?: BatchImportItem[];
    async?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { workspaceId, since, until, items, async: isAsync } = body;
  if (!workspaceId || !since || !until || !items?.length) {
    return NextResponse.json(
      { error: "workspaceId, since, until, and non-empty items[] are required" },
      { status: 400 },
    );
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(since) || !dateRe.test(until)) {
    return NextResponse.json({ error: "since and until must be YYYY-MM-DD" }, { status: 400 });
  }

  await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "member", operation: "batch_import_warehouse" });
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  const plan = workspace?.plan ?? "pilot";

  if (isAsync) {
    const jobId = `import_${randomUUID()}`;
    await createImportJob({
      id: jobId,
      workspaceId,
      since,
      until,
      totalItems: items.length,
    });

    // Fire and run asynchronously in the background
    (async () => {
      try {
        await updateImportJob(jobId, { status: "running" });
        const results = await processBatchItems({
          workspaceId,
          since,
          until,
          plan,
          items,
          onProgress: async ({ completed, results: currentResults }) => {
            const approxRows = currentResults.reduce((s, r) => s + (r.upserted ?? r.rowsIngested ?? 0), 0);
            await updateImportJob(jobId, {
              completedItems: completed,
              approximateRows: approxRows,
              results: currentResults,
            });
          },
        });

        const okCount = results.filter((r) => r.ok).length;
        const totalUpserts = results.reduce((s, r) => s + (r.upserted ?? r.rowsIngested ?? 0), 0);

        await updateImportJob(jobId, {
          status: "completed",
          completedItems: items.length,
          approximateRows: totalUpserts,
          results,
        });
        logger.info(`[warehouse/import-batch] Async job ${jobId} finished: ${okCount}/${results.length} succeeded`);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : "Batch job failed";
        logger.error(`[warehouse/import-batch] Async job ${jobId} failed:`, err);
        await updateImportJob(jobId, {
          status: "failed",
          error: errorMsg,
        });
      }
    })();

    return NextResponse.json(
      {
        success: true,
        async: true,
        jobId,
        status: "queued",
        totalJobs: items.length,
        message: `Batch import job ${jobId} started with ${items.length} task(s).`,
      },
      { status: 202 }
    );
  }

  const results = await processBatchItems({
    workspaceId,
    since,
    until,
    plan,
    items,
  });

  const okCount = results.filter((r) => r.ok).length;
  const totalUpserts = results.reduce((s, r) => s + (r.upserted ?? r.rowsIngested ?? 0), 0);

  return NextResponse.json({
    success: okCount > 0,
    okCount,
    totalJobs: results.length,
    approximateRows: totalUpserts,
    results,
    message:
      okCount === results.length
        ? `All ${results.length} import job(s) completed.`
        : `${okCount}/${results.length} job(s) completed; see results for detail.`,
  });
}
