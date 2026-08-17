import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth-session";
import { safeDecrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { parseConnectionCredentialsJson } from "@/lib/parse-connection-credentials";
import { syncConnectionData } from "@/lib/sync-connection";
import { syncMetaInsightsIntoWarehouse } from "@/lib/ingestion/meta-campaign-metrics";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { clampTimeRangeToPlanMaxDays, getPlanLimits } from "@/lib/plan-config";
import {
  createImportJob,
  updateImportJobProgress,
  completeImportJob,
  failImportJob,
  heartbeatImportJob,
  LeaseLostError,
  type BatchImportItem,
  type BatchImportJobResult,
} from "@/lib/warehouse-import-job";
import { runPostWarehouseRefreshQualityChecks } from "@/lib/observability/data-quality";

const MAX_CONCURRENT_JOBS_PER_WORKSPACE = 5;
const MAX_ITEMS_PER_REQUEST = 50;

const ItemSchema = z.object({
  connectionId: z.string().min(1, "connectionId is required"),
  adAccountId: z.string().optional(),
});

const ImportBatchSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "since must be formatted as YYYY-MM-DD"),
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "until must be formatted as YYYY-MM-DD"),
  items: z
    .array(ItemSchema)
    .min(1, "At least one item must be provided")
    .max(
      MAX_ITEMS_PER_REQUEST,
      `Cannot import more than ${MAX_ITEMS_PER_REQUEST} items per batch`
    ),
  async: z.boolean().optional(),
  idempotencyKey: z.string().max(128).optional(),
});

/**
 * Executes warehouse refresh sync for an array of items.
 */
export async function processBatchItems(opts: {
  workspaceId: string;
  since: string;
  until: string;
  plan: string;
  items: BatchImportItem[];
  jobId?: string;
  leaseId?: string;
  syncFn?: typeof syncConnectionData;
  onProgress?: (progress: {
    completed: number;
    total: number;
    results: BatchImportJobResult[];
  }) => Promise<void>;
}): Promise<BatchImportJobResult[]> {
  const { workspaceId, since, until, plan, items, onProgress, syncFn } = opts;
  const results: BatchImportJobResult[] = [];

  const connIds = Array.from(new Set(items.map((i) => i.connectionId)));
  const connections = await prisma.connection.findMany({
    where: {
      id: { in: connIds },
      workspaceId,
      status: "connected",
    },
  });
  const connMap = new Map(connections.map((c) => [c.id, c]));

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const conn = connMap.get(item.connectionId);
    if (!conn) {
      results.push({
        connectionId: item.connectionId,
        provider: "unknown",
        adAccountId: item.adAccountId,
        ok: false,
        error: "Connection not found or not connected",
      });
      if (onProgress) {
        await onProgress({ completed: i + 1, total: items.length, results });
      }
      continue;
    }

    try {
      const rawCreds = safeDecrypt(conn.credentials);
      const credentials = parseConnectionCredentialsJson(rawCreds) as Record<
        string,
        unknown
      >;

      if (syncFn) {
        const sync = await syncFn({
          workspaceId,
          connectionId: conn.id,
          provider: conn.provider,
          credentials,
          since,
          until,
          userPlan: plan,
        });
        results.push({
          connectionId: conn.id,
          provider: conn.provider,
          adAccountId: item.adAccountId,
          ok: sync.success,
          rowsIngested: sync.rowsIngested,
          error: sync.error,
        });
      } else if (conn.provider === "meta_ads" && item.adAccountId) {
        const metaRes = await syncMetaInsightsIntoWarehouse({
          workspaceId,
          connectionId: conn.id,
          adAccountId: item.adAccountId,
          userPlan: plan,
          since,
          until,
        });

        results.push({
          connectionId: conn.id,
          provider: conn.provider,
          adAccountId: item.adAccountId,
          ok: true,
          upserted: metaRes.upserted,
        });
      } else {
        const sync = await syncConnectionData({
          workspaceId,
          connectionId: conn.id,
          provider: conn.provider,
          credentials,
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
 * Runs a background import job with durable state updates, continuous heartbeat,
 * deduplicated post-refresh data-quality checks, and exponential backoff retry.
 */
export async function runDurableImportWorker(
  jobId: string,
  leaseId: string,
  syncFn?: typeof syncConnectionData
) {
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let isLeaseLost = false;

  try {
    const jobRecord = await prisma.warehouseImportJob.findUnique({
      where: { id: jobId },
    });
    if (!jobRecord) return;

    // Start continuous heartbeat while processing
    heartbeatTimer = setInterval(async () => {
      try {
        await heartbeatImportJob(jobId, leaseId);
      } catch (err) {
        if (err instanceof LeaseLostError) {
          isLeaseLost = true;
          logger.warn(`[runDurableImportWorker] Lease lost for job ${jobId}, aborting`);
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
      }
    }, 10000);

    const items = (jobRecord.items as unknown as BatchImportItem[]) || [];
    const results = await processBatchItems({
      workspaceId: jobRecord.workspaceId,
      since: jobRecord.since,
      until: jobRecord.until,
      plan: jobRecord.plan,
      items,
      jobId,
      leaseId,
      syncFn,
      onProgress: async ({ completed, results: currentResults }) => {
        if (isLeaseLost) throw new LeaseLostError(jobId, leaseId);
        const approxRows = currentResults.reduce(
          (s, r) => s + (r.upserted ?? r.rowsIngested ?? 0),
          0
        );
        await updateImportJobProgress(jobId, leaseId, {
          completedItems: completed,
          approximateRows: approxRows,
          results: currentResults,
        });
      },
    });

    if (isLeaseLost) throw new LeaseLostError(jobId, leaseId);

    // Run post-refresh data quality checks for each successfully refreshed connection (deduplicated)
    const successfulConnections = Array.from(
      new Set(results.filter((r) => r.ok).map((r) => r.connectionId))
    );

    for (const connId of successfulConnections) {
      try {
        await runPostWarehouseRefreshQualityChecks(jobRecord.workspaceId, connId);
      } catch (dqErr) {
        logger.error(`[runDurableImportWorker][DATA_QUALITY] Error checking connection ${connId}:`, dqErr);
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    const totalUpserts = results.reduce(
      (s, r) => s + (r.upserted ?? r.rowsIngested ?? 0),
      0
    );

    await completeImportJob(jobId, leaseId, results, totalUpserts);

    logger.info(
      `[warehouse/import-batch] Durable job ${jobId} finished: ${okCount}/${results.length} succeeded`
    );
  } catch (err: unknown) {
    if (err instanceof LeaseLostError) {
      logger.warn(`[runDurableImportWorker] Aborted job ${jobId} due to lost lease`);
      return;
    }
    const errorMsg = err instanceof Error ? err.message : "Batch job execution failed";
    logger.error(`[warehouse/import-batch] Durable job ${jobId} failed:`, err);
    try {
      await failImportJob(jobId, leaseId, errorMsg);
    } catch {
      // Lease may have been lost during fail update
    }
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
  }
}

/**
 * POST /api/data-explorer/warehouse/import-batch
 * Runs warehouse refresh for selected connections (and optional Meta ad accounts).
 * Supports durable background asynchronous execution and synchronous execution.
 */
export async function POST(req: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ImportBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const {
    workspaceId,
    since: rawSince,
    until: rawUntil,
    items: rawItems,
    async: isAsync,
    idempotencyKey,
  } = parsed.data;

  // Validate date logic
  const sinceDate = new Date(rawSince);
  const untilDate = new Date(rawUntil);
  if (sinceDate.getTime() > untilDate.getTime()) {
    return NextResponse.json(
      { error: "Date 'since' cannot be after 'until'" },
      { status: 400 }
    );
  }

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "member",
      operation: "batch_import_warehouse",
    });
  } catch (err) {
    const rbacRes = toRbacResponse(err);
    if (rbacRes) return rbacRes;
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  const plan = workspace?.plan ?? "pilot";

  // Plan limits: clamp date span
  const planLimits = getPlanLimits(plan);
  const { since, until, clamped } = clampTimeRangeToPlanMaxDays(plan, {
    since: rawSince,
    until: rawUntil,
  });

  if (clamped && planLimits.maxHistoryDays) {
    logger.info(
      `[warehouse/import-batch] Clamped date range for plan ${plan} to ${since}..${until} (max ${planLimits.maxHistoryDays} days)`
    );
  }

  // Deduplicate items: unique (connectionId, adAccountId)
  const itemMap = new Map<string, BatchImportItem>();
  for (const item of rawItems) {
    const key = `${item.connectionId}:${item.adAccountId ?? ""}`;
    if (!itemMap.has(key)) {
      itemMap.set(key, item);
    }
  }
  const items = Array.from(itemMap.values());

  // Check workspace concurrency limit
  const activeJobsCount = await prisma.warehouseImportJob.count({
    where: {
      workspaceId,
      status: { in: ["queued", "running"] },
    },
  });

  if (activeJobsCount >= MAX_CONCURRENT_JOBS_PER_WORKSPACE) {
    return NextResponse.json(
      {
        error: "Too many active import jobs for this workspace",
        message: `Workspace has ${activeJobsCount} active jobs (max ${MAX_CONCURRENT_JOBS_PER_WORKSPACE}). Please wait for current jobs to finish.`,
      },
      { status: 429 }
    );
  }

  if (isAsync) {
    const jobState = await createImportJob({
      workspaceId,
      userId: session.user.id,
      plan,
      since,
      until,
      items,
      idempotencyKey,
      priority: planLimits.priority,
    });

    // Trigger queue processor out-of-band if cron secret configured
    if (process.env.CRON_SECRET) {
      const baseUrl = (
        process.env.NEXTAUTH_URL?.replace(/\/$/, "") ||
        new URL(req.url).origin
      ).replace(/\/$/, "");

      fetch(`${baseUrl}/api/cron/warehouse-jobs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }).catch(() => {
        // Fallback: 1-minute Vercel Cron will durably pick up the queued job
      });
    }

    return NextResponse.json(
      {
        success: true,
        async: true,
        jobId: jobState.id,
        status: jobState.status,
        totalJobs: items.length,
        message: `Durable batch import job ${jobState.id} queued with ${items.length} task(s).`,
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

  // Await post-refresh quality checks for successful connections
  const successfulConnections = Array.from(
    new Set(results.filter((r) => r.ok).map((r) => r.connectionId))
  );
  for (const connId of successfulConnections) {
    try {
      await runPostWarehouseRefreshQualityChecks(workspaceId, connId);
    } catch (dqErr) {
      logger.error(`[warehouse/import-batch][DATA_QUALITY] Error checking connection ${connId}:`, dqErr);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const totalUpserts = results.reduce(
    (s, r) => s + (r.upserted ?? r.rowsIngested ?? 0),
    0
  );

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
