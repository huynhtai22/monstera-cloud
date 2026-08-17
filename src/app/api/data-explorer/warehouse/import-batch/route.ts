import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { syncMetaInsightsIntoWarehouse } from "@/lib/ingestion/meta-campaign-metrics";
import { syncConnectionData } from "@/lib/sync-connection";
import { safeDecrypt } from "@/lib/encryption";
import { parseConnectionCredentialsJson } from "@/lib/parse-connection-credentials";
import { logger } from "@/lib/logger";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { getPlanLimits, clampTimeRangeToPlanMaxDays } from "@/lib/plan-config";
import { z } from "zod";
import {
  createImportJob,
  claimImportJob,
  heartbeatImportJob,
  updateImportJobProgress,
  completeImportJob,
  failImportJob,
  type BatchImportItem,
  type BatchImportJobResult,
} from "@/lib/warehouse-import-job";

const AD_PROVIDERS = new Set([
  "meta_ads",
  "google_ads",
  "tiktok_business",
  "shopee",
]);

const MAX_ITEMS_PER_BATCH = 50;
const MAX_CONCURRENT_JOBS_PER_WORKSPACE = 5;

const ImportBatchSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "since must be YYYY-MM-DD"),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "until must be YYYY-MM-DD"),
  items: z
    .array(
      z.object({
        connectionId: z.string().min(1, "connectionId is required"),
        adAccountId: z.string().optional(),
      })
    )
    .min(1, "items must contain at least 1 item")
    .max(MAX_ITEMS_PER_BATCH, `Maximum ${MAX_ITEMS_PER_BATCH} items per batch request`),
  async: z.boolean().optional().default(false),
  idempotencyKey: z.string().max(128).optional(),
});

export async function processBatchItems(params: {
  workspaceId: string;
  since: string;
  until: string;
  plan: string;
  items: BatchImportItem[];
  jobId?: string;
  leaseId?: string;
  onProgress?: (progress: { completed: number; total: number; results: BatchImportJobResult[] }) => Promise<void>;
}): Promise<BatchImportJobResult[]> {
  const { workspaceId, since, until, plan, items, jobId, leaseId, onProgress } = params;
  const results: BatchImportJobResult[] = [];
  const processedNonMetaConnections = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Maintain lease heartbeat if processing background job
    if (jobId && leaseId) {
      await heartbeatImportJob(jobId, leaseId).catch(() => {});
    }

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
        const connectionRecord = await prisma.connection.findFirst({
          where: { id: conn.id, workspaceId },
          select: { credentials: true },
        });

        if (!connectionRecord) {
          throw new Error("Connection credentials not found");
        }

        const raw = safeDecrypt(connectionRecord.credentials);
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
 * Runs a background import job with durable state updates and exponential backoff retry.
 */
export async function runDurableImportWorker(jobId: string, leaseId: string) {
  try {
    const jobRecord = await prisma.warehouseImportJob.findUnique({
      where: { id: jobId },
    });
    if (!jobRecord) return;

    const items = (jobRecord.items as unknown as BatchImportItem[]) || [];
    const results = await processBatchItems({
      workspaceId: jobRecord.workspaceId,
      since: jobRecord.since,
      until: jobRecord.until,
      plan: jobRecord.plan,
      items,
      jobId,
      leaseId,
      onProgress: async ({ completed, results: currentResults }) => {
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

    const okCount = results.filter((r) => r.ok).length;
    const totalUpserts = results.reduce(
      (s, r) => s + (r.upserted ?? r.rowsIngested ?? 0),
      0
    );

    await completeImportJob(jobId, leaseId, {
      completedItems: items.length,
      approximateRows: totalUpserts,
      results,
    });

    logger.info(
      `[warehouse/import-batch] Durable job ${jobId} finished: ${okCount}/${results.length} succeeded`
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Batch job execution failed";
    logger.error(`[warehouse/import-batch] Durable job ${jobId} failed:`, err);
    await failImportJob(jobId, leaseId, errorMsg, true);
  }
}

/**
 * POST /api/data-explorer/warehouse/import-batch
 * Runs warehouse refresh for selected connections (and optional Meta ad accounts).
 * Supports durable background asynchronous execution and synchronous execution.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
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

  const { workspaceId, since: rawSince, until: rawUntil, items: rawItems, async: isAsync, idempotencyKey } = parsed.data;

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

  // Plan limits: clamp or validate date span
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

    // Attempt to claim and start processing immediately
    const claim = await claimImportJob(jobState.id);
    if (claim.claimed && claim.leaseId) {
      // Run background worker asynchronously
      void runDurableImportWorker(jobState.id, claim.leaseId);
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
