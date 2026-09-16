import { NextResponse, after } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth-session";
import { safeDecrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { parseConnectionCredentialsJson } from "@/lib/parse-connection-credentials";
import { syncConnectionData } from "@/lib/sync-connection";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { listEnabledWorkspaceProviders } from "@/lib/workspace-provider-access";
import { clampTimeRangeToPlanMaxDays, getPlanLimits } from "@/lib/plan-config";
import {
  createImportJob,
  claimImportJob,
  updateImportJobProgress,
  completeImportJob,
  retryPartialImportJob,
  failImportJob,
  heartbeatImportJob,
  LeaseLostError,
  type BatchImportItem,
  type BatchImportJobResult,
} from "@/lib/warehouse-import-job";
import { runPostWarehouseRefreshQualityChecks } from "@/lib/observability/data-quality";
import { emitMonitor } from "@/lib/observability/monitors";
import { notifyWarehouseJobIfNeeded } from "@/lib/ingestion/notify-run";
import { HistoricalBackfillPlanningError } from "@/lib/historical-backfill-plan";
import {
  assertExecutableWarehouseRange,
  getOversizedExecutionDetails,
  toOversizedExecutionResponse,
} from "@/lib/warehouse-execution-guard";
import {
  chunkResultsForModal,
  hasBackfillChunks,
  listBackfillChunks,
  runCheckpointedBackfillWorker,
} from "@/lib/warehouse-backfill-chunks";

const MAX_CONCURRENT_JOBS_PER_WORKSPACE = 5;
const MAX_ITEMS_PER_REQUEST = 50;

/**
 * Keeps the generic import endpoint from bypassing the historical planner.
 * OAuth is the sole current caller that can persist its approved 90-day Meta
 * and Google window as bounded item ranges; every other multi-chunk request
 * must fail closed until a general resumable chunk dispatcher exists.
 *
 * Delegates to the shared Warehouse execution guard so single-import and
 * batch-import enforce the identical raw-range policy before plan clamping,
 * job creation, worker dispatch, database writes, or provider contact.
 */
export async function assertBatchHistoricalExecutionAllowed(opts: {
  workspaceId: string;
  since: string;
  until: string;
  planMaximumDays?: number;
  items: BatchImportItem[];
}): Promise<void> {
  const connectionIds = Array.from(new Set(opts.items.map((item) => item.connectionId)));
  const connections = await prisma.connection.findMany({
    where: { id: { in: connectionIds }, workspaceId: opts.workspaceId },
    select: { provider: true },
  });

  for (const provider of new Set(connections.map((connection) => connection.provider))) {
    // A plan projection may be smaller than a dangerous raw request. The
    // guard intentionally evaluates raw provider execution first; the
    // route performs visible product clamping only after this check passes.
    assertExecutableWarehouseRange({ provider, since: opts.since, until: opts.until });
  }
}

const ItemSchema = z.object({
  connectionId: z.string().min(1, "connectionId is required"),
  accountId: z.string().optional(),
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
  isLeaseLost?: () => boolean;
  onProgress?: (progress: {
    completed: number;
    total: number;
    results: BatchImportJobResult[];
  }) => Promise<void>;
}): Promise<BatchImportJobResult[]> {
  const { workspaceId, since, until, plan, items, onProgress, syncFn, isLeaseLost } = opts;
  const syncRunner = syncFn ?? syncConnectionData;
  const results: BatchImportJobResult[] = [];

  const connIds = Array.from(new Set(items.map((i) => i.connectionId)));
  const connections = await prisma.connection.findMany({
    where: {
      id: { in: connIds },
      workspaceId,
      OR: [
        { status: "connected" },
        // Manual retry remains valid for a TikTok connection whose previous
        // non-auth synchronization attempt truthfully set status=error.
        { provider: "tiktok_business", status: "error" },
      ],
    },
  });
  const connMap = new Map(connections.map((c) => [c.id, c]));
  const enabledProviders = await listEnabledWorkspaceProviders(workspaceId);

  for (let i = 0; i < items.length; i++) {
    // Fencing check: halt processing immediately if lease was lost or heartbeat failed
    if (isLeaseLost?.()) {
      throw new LeaseLostError(opts.jobId ?? "unknown", opts.leaseId ?? "unknown");
    }

    const item = items[i];
    const executionSince = item.executionSince ?? since;
    const executionUntil = item.executionUntil ?? until;
    const conn = connMap.get(item.connectionId);
    if (!conn) {
      results.push({
        connectionId: item.connectionId,
        provider: "unknown",
        adAccountId: item.adAccountId,
        executionSince,
        executionUntil,
        ok: false,
        error: "Connection not found or not connected",
      });
      if (onProgress) {
        await onProgress({ completed: i + 1, total: items.length, results });
      }
      continue;
    }

    if (!enabledProviders.has(conn.provider)) {
      results.push({
        connectionId: conn.id,
        provider: conn.provider,
        adAccountId: item.adAccountId,
        executionSince,
        executionUntil,
        ok: false,
        error: "Provider is not enabled for this workspace",
      });
      if (onProgress) {
        await onProgress({ completed: i + 1, total: items.length, results });
      }
      continue;
    }

    try {
      const rawCreds = safeDecrypt(conn.credentials);
      const parsedCreds = parseConnectionCredentialsJson(rawCreds) as Record<
        string,
        unknown
      >;
      const credentials = {
        ...parsedCreds,
        remoteAccountId: conn.remoteAccountId,
      };

      const targetAccountId = item.accountId ?? item.adAccountId;
      const providerTargetCredentials = targetAccountId
        ? conn.provider === "meta_ads"
          ? { selectedAdAccountIds: [targetAccountId] }
          : conn.provider === "google_ads"
            ? { selectedCustomerIds: [targetAccountId] }
            : conn.provider === "tiktok_business"
              ? { selectedAdvertiserIds: [targetAccountId] }
              : {}
        : {};
      const itemCreds = conn.provider === "tiktok_business" && targetAccountId
        ? {
            ...credentials,
            ...providerTargetCredentials,
            extraFields: {
              ...(typeof parsedCreds.extraFields === "object" && parsedCreds.extraFields !== null
                ? parsedCreds.extraFields as Record<string, unknown>
                : {}),
              selectedAdvertiserIds: [targetAccountId],
            },
          }
        : { ...credentials, ...providerTargetCredentials };

      const sync = await syncRunner({
        workspaceId,
        connectionId: conn.id,
        provider: conn.provider,
        credentials: itemCreds,
        since: executionSince,
        until: executionUntil,
        userPlan: plan,
        providerState: item.providerState,
      });
      // Keep the worker tolerant of older test doubles / extension providers while
      // first-party sync providers always return the full outcome contract.
      const syncOutcome = sync.outcome ?? (sync.success ? "success" : "failed");
      const syncChildren = sync.children ?? [{ id: "connection", kind: "connection", ok: sync.success, error: sync.error, retryable: false }];

      results.push({
        connectionId: conn.id,
        provider: conn.provider,
        outcome: syncOutcome,
        accountId: targetAccountId,
        adAccountId: item.adAccountId,
        executionSince,
        executionUntil,
        ok: sync.success,
        rowsIngested: sync.rowsIngested,
        upserted: sync.rowsIngested,
        error: sync.error,
        retryable: syncChildren.some((child) => !child.ok && child.retryable),
        retryItems: syncChildren
          .filter((child) => !child.ok && child.retryable)
          .map((child) => ({
            connectionId: conn.id,
            ...(child.kind === "connection" ? {} : { accountId: child.id }),
            ...(child.retryState ? { providerState: child.retryState } : {}),
            ...(item.executionSince ? { executionSince: item.executionSince } : {}),
            ...(item.executionUntil ? { executionUntil: item.executionUntil } : {}),
          })),
      });

      if (syncOutcome === "success" && !conn.lastSyncAt) {
        emitMonitor("time_to_first_row", {
          workspaceId,
          connectionId: conn.id,
          provider: conn.provider,
          rows: sync.rowsIngested ?? 0,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Import failed";
      logger.error("[warehouse/import-batch]", { connectionId: conn.id }, e);
      results.push({
        connectionId: conn.id,
        provider: conn.provider,
        adAccountId: item.adAccountId,
        executionSince,
        executionUntil,
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
 * Executes relational checkpoint slices for a job when they exist. Returns
 * modal-compatible results, or null when the job predates chunk
 * materialization (legacy JSON replay applies). A lost parent lease aborts
 * via LeaseLostError; a missing chunk model (older environments) falls back
 * to legacy replay instead of failing the job.
 */
export async function runCheckpointedSlicesForJob(opts: {
  jobId: string;
  leaseId: string;
  workspaceId: string;
  plan: string;
  syncFn?: typeof syncConnectionData;
  isLeaseLost: () => boolean;
}): Promise<BatchImportJobResult[] | null> {
  const { jobId, leaseId } = opts;
  // Missing-table (pre-migration) environments have no chunks: legacy replay
  // applies. Real database errors propagate so the job fails loudly instead
  // of silently replaying without checkpointing.
  if (!(await hasBackfillChunks({ workspaceId: opts.workspaceId, jobId: opts.jobId }))) return null;

  try {
    await runCheckpointedBackfillWorker(jobId, {
      workspaceId: opts.workspaceId,
      executor: async ({ workspaceId, connectionId, provider, accountId, since, until }) => {
        if (opts.isLeaseLost()) throw new LeaseLostError(jobId, leaseId);
        const chunkResults = await processBatchItems({
          workspaceId,
          since,
          until,
          plan: opts.plan,
          items: [
            {
              connectionId,
              ...(accountId ? { accountId } : {}),
              executionSince: since,
              executionUntil: until,
            },
          ],
          jobId,
          leaseId,
          syncFn: opts.syncFn,
          isLeaseLost: opts.isLeaseLost,
          onProgress: async ({ results: currentResults }) => {
            if (opts.isLeaseLost()) throw new LeaseLostError(jobId, leaseId);
            const approxRows = currentResults.reduce(
              (s, r) => s + (r.upserted ?? r.rowsIngested ?? 0),
              0
            );
            await updateImportJobProgress(jobId, leaseId, {
              completedItems: currentResults.length,
              approximateRows: approxRows,
              results: currentResults,
            });
          },
        });
        const first = chunkResults[0];
        if (!first?.ok) throw new Error(first?.error ?? `${provider} chunk did not complete`);
        return { rows: first.upserted ?? first.rowsIngested ?? 0 };
      },
    });
  } catch (err) {
    if (err instanceof LeaseLostError || opts.isLeaseLost()) {
      throw err instanceof Error ? err : new LeaseLostError(jobId, leaseId);
    }
    throw err;
  }
  const chunks = await listBackfillChunks({ workspaceId: opts.workspaceId, jobId });
  return chunkResultsForModal(chunks);
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

    // Start continuous heartbeat while processing (every 10s)
    heartbeatTimer = setInterval(async () => {
      try {
        await heartbeatImportJob(jobId, leaseId);
      } catch (err) {
        isLeaseLost = true;
        logger.error(`[runDurableImportWorker] Heartbeat failed for job ${jobId}, aborting execution:`, err);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
      }
    }, 10000);

    const items = (jobRecord.items as unknown as BatchImportItem[]) || [];

    // Checkpointed path: jobs with relational chunks execute slice-by-slice
    // with crash-resume instead of replaying JSON items from the beginning.
    // Chunk retries are the retry mechanism here, so parent-level partial
    // requeue is bypassed (chunk results carry no retryItems). Jobs without
    // chunks (created before materialization) use the legacy replay below.
    const checkpointedResults = await runCheckpointedSlicesForJob({
      jobId,
      leaseId,
      workspaceId: jobRecord.workspaceId,
      plan: jobRecord.plan,
      syncFn,
      isLeaseLost: () => isLeaseLost,
    });

    const results = checkpointedResults ?? (await processBatchItems({
      workspaceId: jobRecord.workspaceId,
      since: jobRecord.since,
      until: jobRecord.until,
      plan: jobRecord.plan,
      items,
      jobId,
      leaseId,
      syncFn,
      isLeaseLost: () => isLeaseLost,
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
    }));

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

    const retryItems = results.flatMap((result) => result.retryable ? (result.retryItems ?? []) : []);
    const failedResults = results.filter((result) => !result.ok);
    if (failedResults.length > 0 && retryItems.length > 0) {
      const requeued = await retryPartialImportJob(
        jobId,
        leaseId,
        dedupeRetryItems(retryItems),
        results,
        totalUpserts,
        `Partial import: ${failedResults.length}/${results.length} requested source scope(s) failed. Retrying only retryable failed targets.`,
      );
      await notifyWarehouseJobIfNeeded(requeued).catch(() => {});
      return;
    }

    const outcome = failedResults.length === 0
      ? "completed"
      : failedResults.length === results.length
        ? "failed"
        : "partial";
    await completeImportJob(
      jobId,
      leaseId,
      results,
      totalUpserts,
      outcome,
      failedResults.length > 0
        ? `${outcome === "failed" ? "Import failed" : "Partial import"}: ${failedResults.length}/${results.length} requested source scope(s) failed. ${failedResults.map((result) => result.error).filter(Boolean).slice(0, 2).join(" | ")}`
        : undefined,
    );

    logger.info(
      `[warehouse/import-batch] Durable job ${jobId} finished: ${okCount}/${results.length} succeeded`
    );
  } catch (err: unknown) {
    if (err instanceof LeaseLostError || isLeaseLost) {
      logger.warn(`[runDurableImportWorker] Aborted job ${jobId} due to lost lease or heartbeat failure`);
      return;
    }
    const errorMsg = err instanceof Error ? err.message : "Batch job execution failed";
    logger.error(`[warehouse/import-batch] Durable job ${jobId} failed:`, err);
    try {
      const failed = await failImportJob(jobId, leaseId, errorMsg);
      await notifyWarehouseJobIfNeeded(failed).catch(() => {});
    } catch {
      // Lease may have been lost during fail update
    }
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
  }
}

function dedupeRetryItems(items: BatchImportItem[]): BatchImportItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.connectionId}:${item.accountId ?? item.adAccountId ?? "connection"}:${item.executionSince ?? ""}:${item.executionUntil ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  // Evaluate the caller's full request before a product limit can shrink it.
  // Otherwise a 90-day generic Meta/Google request could be reduced to a
  // smaller plan window and incorrectly reach the unchunked worker.
  try {
    await assertBatchHistoricalExecutionAllowed({
      workspaceId,
      since: rawSince,
      until: rawUntil,
      planMaximumDays: planLimits.maxHistoryDays,
      items: rawItems,
    });
  } catch (error) {
    const oversized = getOversizedExecutionDetails(error);
    if (oversized) {
      return NextResponse.json(
        toOversizedExecutionResponse(oversized.provider, oversized.requestedRange, oversized.maxExecutableDays),
        { status: 422 },
      );
    }
    if (error instanceof HistoricalBackfillPlanningError) {
      if (error.code === "INVALID_DATE_RANGE") {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 422 },
      );
    }
    throw error;
  }

  const { since, until, clamped } = clampTimeRangeToPlanMaxDays(plan, {
    since: rawSince,
    until: rawUntil,
  });

  if (clamped && planLimits.maxHistoryDays) {
    logger.info(
      `[warehouse/import-batch] Clamped date range for plan ${plan} to ${since}..${until} (max ${planLimits.maxHistoryDays} days)`
    );
  }

  // Deduplicate items: unique requested connection/account scope.
  const itemMap = new Map<string, BatchImportItem>();
  for (const item of rawItems) {
    const key = `${item.connectionId}:${item.accountId ?? item.adAccountId ?? ""}`;
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
      requestedSince: rawSince,
      requestedUntil: rawUntil,
      clamped,
      items,
      idempotencyKey,
      priority: planLimits.priority,
    });

    // Durably schedule execution in the serverless background context using Next.js after()
    after(async () => {
      try {
        const claim = await claimImportJob(jobState.id);
        if (claim.claimed && claim.leaseId) {
          await runDurableImportWorker(jobState.id, claim.leaseId);
        }
      } catch (err) {
        logger.error(`[warehouse/import-batch] after() worker execution error for job ${jobState.id}:`, err);
      }
    });

    return NextResponse.json(
      {
        success: true,
        async: true,
        jobId: jobState.id,
        status: jobState.status,
        totalJobs: items.length,
        requestedRange: { since: rawSince, until: rawUntil },
        effectiveRange: { since, until },
        clamped,
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
    requestedRange: { since: rawSince, until: rawUntil },
    effectiveRange: { since, until },
    clamped,
    message:
      okCount === results.length
        ? `All ${results.length} import job(s) completed.`
        : `${okCount}/${results.length} job(s) completed; see results for detail.`,
  });
}
