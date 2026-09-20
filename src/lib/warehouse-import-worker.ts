import prisma from "@/lib/prisma";
import { safeDecrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { parseConnectionCredentialsJson } from "@/lib/parse-connection-credentials";
import { syncConnectionData } from "@/lib/sync-connection";
import { listEnabledWorkspaceProviders } from "@/lib/workspace-provider-access";
import { updateImportJobProgress, completeImportJob, retryPartialImportJob, failImportJob, heartbeatImportJob, LeaseLostError, type BatchImportItem, type BatchImportJobResult } from "@/lib/warehouse-import-job";
import { runPostWarehouseRefreshQualityChecks } from "@/lib/observability/data-quality";
import { emitMonitor } from "@/lib/observability/monitors";
import { notifyWarehouseJobIfNeeded } from "@/lib/ingestion/notify-run";
import { chunkResultsForModal, hasBackfillChunks, listBackfillChunks, runCheckpointedBackfillWorker } from "@/lib/warehouse-backfill-chunks";
import { isPilotJobKey } from "@/lib/extended-backfill-pilot";

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
 * Shared warehouse-sync chunk executor used by the checkpoint worker and the
 * operator-gated pilot worker. Executes exactly one persisted slice through
 * the production `processBatchItems` path (provider locks, tenant checks,
 * idempotent upserts) and preserves partial connector outcomes.
 */
export function createWarehouseChunkExecutor(opts: {
  jobId: string;
  leaseId: string;
  plan: string;
  syncFn?: typeof syncConnectionData;
  isLeaseLost: () => boolean;
  onProgress?: (completedItems: number, approximateRows: number, results: BatchImportJobResult[]) => Promise<void>;
}): (chunk: {
  workspaceId: string;
  connectionId: string;
  provider: string;
  accountId: string;
  since: string;
  until: string;
}) => Promise<{ rows: number; partialError?: { code?: string; error?: unknown } }> {
  const { jobId, leaseId } = opts;
  return async ({ workspaceId, connectionId, provider, accountId, since, until }) => {
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
        if (opts.onProgress) {
          await opts.onProgress(currentResults.length, approxRows, currentResults);
        } else {
          await updateImportJobProgress(jobId, leaseId, {
            completedItems: currentResults.length,
            approximateRows: approxRows,
            results: currentResults,
          });
        }
      },
    });
    const first = chunkResults[0];
    if (!first) throw new Error(`${provider} chunk produced no result`);
    const rows = first.upserted ?? first.rowsIngested ?? 0;
    // Preserve partial connector outcomes: committed rows count toward
    // the slice (successful accounts are never re-contacted) while the
    // recorded partial error keeps parent aggregation truthfully partial.
    if (!first.ok && rows === 0) {
      throw new Error(first.error ?? `${provider} chunk did not complete`);
    }
    return {
      rows,
      ...(first.ok ? {} : { partialError: { code: "PARTIAL_ACCOUNTS", error: first.error ?? "Some provider accounts failed" } }),
    };
  };
}

/**
 * Executes relational checkpoint slices for a job when they exist. Returns
 * modal-compatible results, or null when the job predates chunk
 * materialization (legacy JSON replay applies). A lost parent lease aborts
 * via LeaseLostError; a missing chunk model (older environments) falls back
 * to legacy replay instead of failing the job. Progress mirroring here never
 * writes a terminal parent status: the lease-fenced `completeImportJob` tail
 * below owns the terminal transition. If unfinished chunks remain under
 * another worker's active lease, this throws so the parent is requeued
 * instead of falsely failed.
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
      executor: createWarehouseChunkExecutor({
        jobId,
        leaseId,
        plan: opts.plan,
        syncFn: opts.syncFn,
        isLeaseLost: opts.isLeaseLost,
      }),
    });
  } catch (err) {
    if (err instanceof LeaseLostError || opts.isLeaseLost()) {
      throw err instanceof Error ? err : new LeaseLostError(jobId, leaseId);
    }
    throw err;
  }
  const chunks = await listBackfillChunks({ workspaceId: opts.workspaceId, jobId });
  if (chunks.some((chunk) => chunk.status === "running")) {
    // Slices remain under another worker's active lease: requeue the parent
    // via the standard retry path instead of reporting terminal results.
    throw new Error(
      `Checkpoint chunks for job ${jobId} remain running under another worker lease; parent requeued without terminal results.`,
    );
  }
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

    // Extended-pilot jobs are exclusively driven by the operator-gated pilot
    // worker (pause/cancel aware). A stray generic dispatch is a safe no-op.
    if (isPilotJobKey(jobRecord.idempotencyKey)) {
      logger.warn(`[runDurableImportWorker] Refusing generic execution of pilot job ${jobId}`);
      return;
    }

    // Fence execution before the first provider call, not only after 10 seconds.
    await heartbeatImportJob(jobId, leaseId);
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
