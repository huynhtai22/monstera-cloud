/**
 * Checkpointed backfill worker foundation.
 *
 * Relational executable chunks (`WarehouseBackfillChunk`) give multi-slice
 * backfills crash-resume semantics: each chunk is claimed atomically, fenced
 * by lease + monotonic fencing token, and completed only after metric
 * publication commits. Parent-job progress is derived from persisted chunk
 * states and mirrored into the legacy JSON `items`/`results` contract.
 *
 * SAFETY: this module never enables extended execution. Materialization
 * refuses chunk-guarded (Meta/Google) totals beyond the approved automatic
 * window and any per-slice span over 30 days. Extended execution additionally
 * requires `EXTENDED_BACKFILL_EXECUTION_ENABLED=true` (default off, env only,
 * never a request parameter). Public routes keep their raw-range guards.
 */

import { createHash, randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getCanonicalDateRange } from "./warehouse-date-range";
import { HistoricalBackfillPlanningError } from "./historical-backfill-plan";
import {
  WAREHOUSE_GENERIC_EXECUTION_MAX_DAYS,
  isChunkGuardedWarehouseProvider,
} from "./warehouse-execution-guard";
import { getHistoricalIngestionCapability } from "./historical-ingestion-capabilities";
import type { BatchImportJobResult } from "./warehouse-import-job";

export const CHECKPOINTED_CHUNK_MAX_ATTEMPTS = 3;
export const CHUNK_LEASE_TTL_MS = 60_000;
export const CHUNK_HEARTBEAT_INTERVAL_MS = 10_000;

export type BackfillChunkStatus = "queued" | "running" | "completed" | "failed";

export interface BackfillChunkSpec {
  readonly connectionId: string;
  /** Always a string; "" marks a connection-level chunk. */
  readonly accountId: string;
  readonly provider: string;
  /** Inclusive strict YYYY-MM-DD calendar dates. */
  readonly since: string;
  readonly until: string;
  /** Newest-first: 0 executes first. */
  readonly ordinal: number;
}

export interface BackfillChunkRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly jobId: string;
  readonly connectionId: string;
  readonly provider: string;
  readonly accountId: string;
  readonly since: string;
  readonly until: string;
  readonly ordinal: number;
  readonly status: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly persistedRows: number;
  readonly leaseId: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly fencingToken: bigint;
  readonly lastErrorCode: string | null;
  readonly lastError: string | null;
  readonly heartbeatAt: Date | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
}

export class StaleChunkLeaseError extends Error {
  constructor(readonly chunkId: string) {
    super(`Chunk ${chunkId} lease was lost, expired, or superseded.`);
    this.name = "StaleChunkLeaseError";
  }
}

export class ChunkAttemptsExhaustedError extends Error {
  constructor(readonly chunkId: string) {
    super(`Chunk ${chunkId} has no attempts remaining.`);
    this.name = "ChunkAttemptsExhaustedError";
  }
}

/** Extended execution is env-only, default off, never a request parameter. */
export function isExtendedBackfillExecutionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EXTENDED_BACKFILL_EXECUTION_ENABLED === "true";
}

function inclusiveDays(since: string, until: string): number {
  const canonical = getCanonicalDateRange(since, until);
  return Math.round((canonical.endUtc.getTime() - canonical.startUtc.getTime()) / 86_400_000) + 1;
}

/** Deterministic, persistently stable chunk identity. */
export function chunkIdFor(
  jobId: string,
  spec: Pick<BackfillChunkSpec, "connectionId" | "accountId" | "since" | "until">,
): string {
  const digest = createHash("sha256")
    .update(`${jobId}\u0000${spec.connectionId}\u0000${spec.accountId}\u0000${spec.since}\u0000${spec.until}`)
    .digest("hex");
  return `wchk_${digest.slice(0, 24)}`;
}

/**
 * Validates executable chunk specs using the canonical strict date helper
 * (rejects timestamps and impossible dates). Chunk-guarded providers are
 * limited to 30 inclusive days per slice; totals beyond the approved
 * automatic window require the disabled-by-default extended flag.
 */
export function validateChunkSpecs(
  specs: readonly BackfillChunkSpec[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const spec of specs) {
    if (typeof spec.connectionId !== "string" || spec.connectionId.length === 0) {
      throw new HistoricalBackfillPlanningError("INVALID_CHUNK_SPEC", "Chunk connectionId is required.");
    }
    if (typeof spec.accountId !== "string") {
      throw new HistoricalBackfillPlanningError(
        "INVALID_CHUNK_SPEC",
        "Chunk accountId must be a string (use \"\" for connection-level chunks).",
      );
    }
    let days: number;
    try {
      days = inclusiveDays(spec.since, spec.until);
    } catch (error) {
      throw new HistoricalBackfillPlanningError(
        "INVALID_DATE_RANGE",
        error instanceof Error ? error.message : "Chunks must use strict YYYY-MM-DD calendar dates.",
      );
    }
    if (isChunkGuardedWarehouseProvider(spec.provider)) {
      if (days > WAREHOUSE_GENERIC_EXECUTION_MAX_DAYS) {
        throw new HistoricalBackfillPlanningError(
          "REQUEST_CHUNKING_NOT_IMPLEMENTED",
          `Chunk ${spec.since}..${spec.until} spans ${days} days, exceeding the maximum executable span of ${WAREHOUSE_GENERIC_EXECUTION_MAX_DAYS} days. Extended checkpointed backfill is not yet enabled.`,
        );
      }
    }
  }
  const byProvider = new Map<string, { since: string; until: string }[]>();
  for (const spec of specs) {
    const list = byProvider.get(spec.provider) ?? [];
    list.push({ since: spec.since, until: spec.until });
    byProvider.set(spec.provider, list);
  }
  for (const [provider, ranges] of byProvider) {
    if (!isChunkGuardedWarehouseProvider(provider)) continue;
    const earliest = ranges.map((range) => range.since).sort()[0]!;
    const latest = ranges.map((range) => range.until).sort().at(-1)!;
    const total = inclusiveDays(earliest, latest);
    const approved =
      getHistoricalIngestionCapability(provider)?.defaultAutomaticBackfill.days ??
      WAREHOUSE_GENERIC_EXECUTION_MAX_DAYS;
    if (total > approved && !isExtendedBackfillExecutionEnabled(env)) {
      throw new HistoricalBackfillPlanningError(
        "EXTENDED_EXECUTION_NOT_ALLOWED",
        `Chunk set for ${provider} spans ${total} days, beyond the approved automatic window of ${approved} days. Extended checkpointed backfill is not yet enabled.`,
      );
    }
  }
}

function toRecord(row: any): BackfillChunkRecord {
  return {
    ...row,
    fencingToken: typeof row.fencingToken === "bigint" ? row.fencingToken : BigInt(row.fencingToken ?? 0),
  };
}

/**
 * Persists chunk rows for a parent job. Must be called inside the parent's
 * creation transaction so a failure leaves neither a partial parent nor
 * orphaned chunks. Replay-safe: deterministic IDs plus the
 * (jobId, connectionId, accountId, since, until) unique constraint make a
 * retried creation converge instead of duplicating slices.
 */
export async function materializeChunksForJobTx(
  tx: { warehouseBackfillChunk: { createMany: (args: any) => Promise<unknown> } },
  opts: { workspaceId: string; jobId: string; specs: readonly BackfillChunkSpec[] },
): Promise<string[]> {
  validateChunkSpecs(opts.specs);
  const data = opts.specs.map((spec) => ({
    id: chunkIdFor(opts.jobId, spec),
    workspaceId: opts.workspaceId,
    jobId: opts.jobId,
    connectionId: spec.connectionId,
    provider: spec.provider,
    accountId: spec.accountId,
    since: spec.since,
    until: spec.until,
    ordinal: spec.ordinal,
    status: "queued",
    maxAttempts: CHECKPOINTED_CHUNK_MAX_ATTEMPTS,
  }));
  await tx.warehouseBackfillChunk.createMany({ data });
  return data.map((row) => row.id);
}

export async function listBackfillChunks(opts: {
  workspaceId: string;
  jobId: string;
}): Promise<BackfillChunkRecord[]> {
  const rows = await (prisma as any).warehouseBackfillChunk.findMany({
    where: { workspaceId: opts.workspaceId, jobId: opts.jobId },
    orderBy: { ordinal: "asc" },
  });
  return rows.map(toRecord);
}

/** True only for a missing-table error (pre-migration DBs); never for outages. */
export function isMissingChunkTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  if (record.code === "P2021") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /relation .* does not exist|does not exist|Unknown table|no such table/i.test(message);
}

/**
 * Chunks missing (legacy jobs, older DBs) mean "no checkpoint state".
 * Only a missing-table error falls back; real outages propagate so a job
 * fails loudly instead of silently replaying without checkpointing.
 */
export async function hasBackfillChunks(opts: { workspaceId: string; jobId: string }): Promise<boolean> {
  try {
    const count = await (prisma as any).warehouseBackfillChunk.count({
      where: { workspaceId: opts.workspaceId, jobId: opts.jobId },
    });
    return count > 0;
  } catch (error) {
    if (isMissingChunkTableError(error)) return false;
    throw error;
  }
}

function claimGuard(now: Date) {
  return {
    OR: [{ status: "queued" }, { status: "running", leaseExpiresAt: { lt: now } }],
  };
}

/**
 * Atomically claims one chunk. Two workers racing for the same chunk cannot
 * both succeed: the guarded single-statement update admits exactly one
 * winner. Returns a fresh lease ID and incremented fencing token. A failed
 * claim performs zero provider calls by construction (callers must claim
 * before contacting providers).
 */
export async function claimBackfillChunk(opts: {
  chunkId: string;
  workspaceId: string;
  leaseTtlMs?: number;
}): Promise<{ claimed: true; chunk: BackfillChunkRecord; leaseId: string } | { claimed: false; reason: string }> {
  const now = new Date();
  const leaseId = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + (opts.leaseTtlMs ?? CHUNK_LEASE_TTL_MS));
  const current = await (prisma as any).warehouseBackfillChunk.findFirst({
    where: { id: opts.chunkId, workspaceId: opts.workspaceId },
  });
  if (!current) return { claimed: false, reason: "not_found" };
  const seen = toRecord(current);
  if (seen.status === "completed") return { claimed: false, reason: "already_completed" };
  if (seen.status === "failed") return { claimed: false, reason: "terminally_failed" };
  if (seen.attempts >= seen.maxAttempts) return { claimed: false, reason: "attempts_exhausted" };
  const updated = await (prisma as any).warehouseBackfillChunk.updateMany({
    where: {
      id: opts.chunkId,
      workspaceId: opts.workspaceId,
      ...claimGuard(now),
    },
    data: {
      status: "running",
      attempts: { increment: 1 },
      fencingToken: { increment: 1 },
      leaseId,
      leaseExpiresAt,
      heartbeatAt: now,
      startedAt: now,
      updatedAt: now,
    },
  });
  if (updated.count === 0) {
    const latest = await (prisma as any).warehouseBackfillChunk.findFirst({
      where: { id: opts.chunkId, workspaceId: opts.workspaceId },
    });
    if (!latest) return { claimed: false, reason: "not_found" };
    if (latest.status === "completed") return { claimed: false, reason: "already_completed" };
    if (latest.status === "failed") return { claimed: false, reason: "terminally_failed" };
    if (latest.status === "running") return { claimed: false, reason: "lease_active" };
    return { claimed: false, reason: "not_claimable" };
  }
  const row = await (prisma as any).warehouseBackfillChunk.findFirst({
    where: { id: opts.chunkId, workspaceId: opts.workspaceId },
  });
  const chunk = toRecord(row);
  if (chunk.attempts > chunk.maxAttempts) {
    await (prisma as any).warehouseBackfillChunk.updateMany({
      where: { id: opts.chunkId, workspaceId: opts.workspaceId, leaseId },
      data: {
        status: "failed",
        leaseId: null,
        leaseExpiresAt: null,
        lastErrorCode: "ATTEMPTS_EXHAUSTED",
        lastError: "Chunk attempts exhausted.",
        updatedAt: new Date(),
      },
    });
    throw new ChunkAttemptsExhaustedError(opts.chunkId);
  }
  return { claimed: true, chunk, leaseId };
}

/** Claims the next executable chunk newest-first (ordinal ascending). */
export async function claimNextBackfillChunk(opts: {
  workspaceId: string;
  jobId: string;
  leaseTtlMs?: number;
}): Promise<{ claimed: true; chunk: BackfillChunkRecord; leaseId: string } | { claimed: false; reason: string }> {
  const now = new Date();
  const candidate = await (prisma as any).warehouseBackfillChunk.findFirst({
    where: { workspaceId: opts.workspaceId, jobId: opts.jobId, ...claimGuard(now) },
    orderBy: { ordinal: "asc" },
  });
  if (!candidate) return { claimed: false, reason: "no_claimable_chunk" };
  return claimBackfillChunk({ chunkId: candidate.id, workspaceId: opts.workspaceId, leaseTtlMs: opts.leaseTtlMs });
}

function fencingGuard(opts: { chunkId: string; workspaceId: string; leaseId: string; fencingToken: bigint | number | string }) {
  return {
    id: opts.chunkId,
    workspaceId: opts.workspaceId,
    leaseId: opts.leaseId,
    fencingToken: typeof opts.fencingToken === "bigint" ? opts.fencingToken : BigInt(opts.fencingToken),
    status: "running",
  };
}

async function assertChunkExists(chunkId: string, workspaceId?: string): Promise<void> {
  const current = await (prisma as any).warehouseBackfillChunk.findFirst({
    where: workspaceId ? { id: chunkId, workspaceId } : { id: chunkId },
  });
  if (!current) throw new StaleChunkLeaseError(chunkId);
}

export async function heartbeatBackfillChunk(opts: {
  chunkId: string;
  workspaceId: string;
  leaseId: string;
  fencingToken: bigint | number | string;
  leaseTtlMs?: number;
}): Promise<void> {
  const now = new Date();
  const updated = await (prisma as any).warehouseBackfillChunk.updateMany({
    where: { ...fencingGuard(opts), leaseExpiresAt: { gte: now } },
    data: { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + (opts.leaseTtlMs ?? CHUNK_LEASE_TTL_MS)), updatedAt: now },
  });
  if (updated.count === 0) {
    await assertChunkExists(opts.chunkId, opts.workspaceId);
    throw new StaleChunkLeaseError(opts.chunkId);
  }
}

const SENSITIVE_VALUE_PATTERN =
  /(["']?)(access_token|refresh_token|client_secret|accessToken|refreshToken)\1\s*[:=]\s*["']?[^\s"',;}\]]+["']?/gi;

/** Truncates and redacts credential-like material from persisted errors. */
export function sanitizeChunkError(error: unknown, code = "CHUNK_FAILED"): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Chunk failed";
  const redacted = String(raw).replace(SENSITIVE_VALUE_PATTERN, "$2=[redacted]");
  return { code, message: redacted.slice(0, 500) };
}

/**
 * Records durable success. Callers must invoke this only after metric
 * publication commits; `persistedRows` is the committed count, never a
 * pre-call estimate. `partialError` preserves a partial provider outcome
 * (some accounts committed rows while others failed) without re-contacting
 * the successful accounts: the slice stays completed, but the recorded error
 * keeps the parent aggregation truthfully partial.
 */
export async function completeBackfillChunk(opts: {
  chunkId: string;
  workspaceId: string;
  leaseId: string;
  fencingToken: bigint | number | string;
  persistedRows: number;
  partialError?: { code?: string; error?: unknown };
}): Promise<BackfillChunkRecord> {
  const now = new Date();
  const partial = opts.partialError
    ? sanitizeChunkError(opts.partialError.error, opts.partialError.code ?? "PARTIAL_ACCOUNTS")
    : null;
  const updated = await (prisma as any).warehouseBackfillChunk.updateMany({
    where: fencingGuard(opts),
    data: {
      status: "completed",
      persistedRows: Math.max(0, Math.floor(opts.persistedRows)),
      leaseId: null,
      leaseExpiresAt: null,
      lastErrorCode: partial?.code ?? null,
      lastError: partial?.message ?? null,
      completedAt: now,
      updatedAt: now,
    },
  });
  if (updated.count === 0) {
    await assertChunkExists(opts.chunkId, opts.workspaceId);
    throw new StaleChunkLeaseError(opts.chunkId);
  }
  const row = await (prisma as any).warehouseBackfillChunk.findFirst({
    where: { id: opts.chunkId, workspaceId: opts.workspaceId },
  });
  return toRecord(row);
}

/**
 * Records failure. Retryable failures return the chunk to `queued` (attempts
 * were already consumed by the claim); exhausted chunks become `failed`.
 */
export async function failBackfillChunk(opts: {
  chunkId: string;
  workspaceId: string;
  leaseId: string;
  fencingToken: bigint | number | string;
  code?: string;
  error?: unknown;
}): Promise<BackfillChunkRecord> {
  const now = new Date();
  const current = await (prisma as any).warehouseBackfillChunk.findFirst({
    where: { id: opts.chunkId, workspaceId: opts.workspaceId },
  });
  if (!current) throw new StaleChunkLeaseError(opts.chunkId);
  const record = toRecord(current);
  if (
    record.leaseId !== opts.leaseId ||
    record.fencingToken !== (typeof opts.fencingToken === "bigint" ? opts.fencingToken : BigInt(opts.fencingToken)) ||
    record.status !== "running"
  ) {
    throw new StaleChunkLeaseError(opts.chunkId);
  }
  const { code, message } = sanitizeChunkError(opts.error, opts.code);
  const terminal = record.attempts >= record.maxAttempts;
  await (prisma as any).warehouseBackfillChunk.updateMany({
    where: fencingGuard(opts),
    data: {
      status: terminal ? "failed" : "queued",
      leaseId: null,
      leaseExpiresAt: null,
      lastErrorCode: code,
      lastError: message,
      updatedAt: now,
    },
  });
  const row = await (prisma as any).warehouseBackfillChunk.findFirst({
    where: { id: opts.chunkId, workspaceId: opts.workspaceId },
  });
  return toRecord(row);
}

/** Marks expired running chunks with no attempts left as terminally failed. */
export async function sweepExhaustedChunks(opts: { workspaceId: string; jobId: string }): Promise<number> {
  const now = new Date();
  const expired = await (prisma as any).warehouseBackfillChunk.findMany({
    where: { workspaceId: opts.workspaceId, jobId: opts.jobId, status: "running", leaseExpiresAt: { lt: now } },
  });
  let swept = 0;
  for (const row of expired) {
    const record = toRecord(row);
    if (record.attempts < record.maxAttempts) continue;
    const updated = await (prisma as any).warehouseBackfillChunk.updateMany({
      where: { id: record.id, workspaceId: opts.workspaceId, status: "running", leaseExpiresAt: { lt: new Date() } },
      data: {
        status: "failed",
        leaseId: null,
        leaseExpiresAt: null,
        lastErrorCode: "ATTEMPTS_EXHAUSTED",
        lastError: "Chunk lease expired with no attempts remaining.",
        updatedAt: new Date(),
      },
    });
    swept += updated.count;
  }
  return swept;
}

/**
 * Marks queued chunks with no attempts left as terminally failed. The claim
 * path refuses them, so without this step a worker loop would spin on an
 * unclaimable queued chunk instead of converging to a terminal parent.
 */
export async function failExhaustedQueuedChunks(opts: { workspaceId: string; jobId: string }): Promise<number> {
  const queued = await (prisma as any).warehouseBackfillChunk.findMany({
    where: { workspaceId: opts.workspaceId, jobId: opts.jobId, status: "queued" },
  });
  let failed = 0;
  for (const row of queued) {
    const record = toRecord(row);
    if (record.attempts < record.maxAttempts) continue;
    const updated = await (prisma as any).warehouseBackfillChunk.updateMany({
      where: { id: record.id, workspaceId: opts.workspaceId, status: "queued" },
      data: {
        status: "failed",
        lastErrorCode: record.lastErrorCode ?? "ATTEMPTS_EXHAUSTED",
        lastError: record.lastError ?? "Chunk attempts exhausted.",
        updatedAt: new Date(),
      },
    });
    failed += updated.count;
  }
  return failed;
}

export interface ParentBackfillAggregation {
  readonly status: "queued" | "running" | "completed" | "partial" | "failed";
  readonly totalChunks: number;
  readonly completedChunks: number;
  readonly failedChunks: number;
  readonly runningChunks: number;
  readonly queuedChunks: number;
  /** Completed chunks that carry a partial provider error. */
  readonly partialChunks: number;
  readonly approximateRows: number;
  readonly errors: readonly { chunkId: string; connectionId: string; accountId: string; code: string; error: string }[];
  /** Inclusive coverage across all chunks (null when no chunks exist). */
  readonly coverage: { since: string; until: string } | null;
  readonly completedCoverage: { since: string; until: string } | null;
}

/** Pure parent-status derivation from persisted chunk states. */
export function aggregateChunkStates(chunks: readonly BackfillChunkRecord[]): ParentBackfillAggregation {
  const completed = chunks.filter((chunk) => chunk.status === "completed");
  const failed = chunks.filter((chunk) => chunk.status === "failed");
  const running = chunks.filter((chunk) => chunk.status === "running");
  const queued = chunks.filter((chunk) => chunk.status === "queued");
  // A completed chunk with a recorded error means some provider accounts in
  // that slice failed while others committed rows: the slice is done (never
  // re-contacted) but the parent must report partial, never completed.
  const partial = completed.filter((chunk) => chunk.lastError);
  const approximateRows = chunks.reduce((sum, chunk) => sum + (chunk.persistedRows ?? 0), 0);
  const errors = chunks
    .filter((chunk) => chunk.lastError)
    .map((chunk) => ({
      chunkId: chunk.id,
      connectionId: chunk.connectionId,
      accountId: chunk.accountId,
      code: chunk.lastErrorCode ?? "CHUNK_FAILED",
      error: chunk.lastError ?? "Chunk failed",
    }));
  const spanOf = (list: readonly BackfillChunkRecord[]) => {
    if (list.length === 0) return null;
    const since = list.map((chunk) => chunk.since).sort()[0]!;
    const until = list.map((chunk) => chunk.until).sort().at(-1)!;
    return { since, until };
  };
  let status: ParentBackfillAggregation["status"];
  if (chunks.length === 0) {
    status = "queued";
  } else if (running.length > 0 || (completed.length > 0 && queued.length > 0)) {
    status = "running";
  } else if (completed.length === chunks.length && failed.length === 0 && partial.length === 0) {
    status = "completed";
  } else if (completed.length > 0 && (failed.length > 0 || partial.length > 0)) {
    status = "partial";
  } else if (failed.length > 0 && queued.length === 0) {
    status = "failed";
  } else {
    status = "queued";
  }
  return {
    status,
    totalChunks: chunks.length,
    completedChunks: completed.length,
    failedChunks: failed.length,
    runningChunks: running.length,
    queuedChunks: queued.length,
    partialChunks: partial.length,
    approximateRows,
    errors,
    coverage: spanOf(chunks),
    completedCoverage: spanOf(completed),
  };
}

/** Modal-compatible per-chunk results derived from persisted chunk states. */
export function chunkResultsForModal(chunks: readonly BackfillChunkRecord[]): BatchImportJobResult[] {
  return [...chunks]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((chunk) => ({
      connectionId: chunk.connectionId,
      provider: chunk.provider,
      ...(chunk.accountId ? { accountId: chunk.accountId } : {}),
      executionSince: chunk.since,
      executionUntil: chunk.until,
      ok: chunk.status === "completed",
      rowsIngested: chunk.persistedRows,
      upserted: chunk.persistedRows,
      ...(chunk.lastError ? { error: chunk.lastError } : {}),
    }));
}

/**
 * Recomputes parent progress from chunks and mirrors counts/results into the
 * legacy JSON contract so `RefreshWarehouseModal` polling is unchanged.
 * Progress mirroring never writes parent `status`: the worker owns `running`
 * from its claim, and only the lease-fenced `completeImportJob` path (via
 * `finalize`) may write a terminal transition (telemetry, cache invalidation,
 * lease release). Writing any other status here would break the owner's
 * lease and make fenced writes misfire as lost leases. Jobs without chunks
 * are left untouched for the legacy worker.
 */
export async function refreshParentJobFromChunks(opts: {
  workspaceId: string;
  jobId: string;
  finalize?: boolean;
}): Promise<ParentBackfillAggregation | null> {
  const chunks = await listBackfillChunks(opts);
  if (chunks.length === 0) return null;
  const aggregation = aggregateChunkStates(chunks);
  const results = chunkResultsForModal(chunks);
  const failedMessages = aggregation.errors.map((entry) => entry.error).filter(Boolean).slice(0, 2);
  const aggregationTerminal =
    aggregation.status === "completed" || aggregation.status === "partial" || aggregation.status === "failed";
  const outcomeToJobStatus = opts.finalize && aggregationTerminal ? aggregation.status : undefined;
  const scopeSummary = [
    ...(aggregation.failedChunks > 0
      ? [`${aggregation.failedChunks}/${aggregation.totalChunks} chunk(s) failed`]
      : []),
    ...(aggregation.partialChunks > 0
      ? [`${aggregation.partialChunks}/${aggregation.totalChunks} chunk(s) partial`]
      : []),
  ].join("; ");
  await (prisma as any).warehouseImportJob.updateMany({
    where: { id: opts.jobId, workspaceId: opts.workspaceId },
    data: {
      completedItems: aggregation.completedChunks,
      approximateRows: aggregation.approximateRows,
      results: results as any,
      ...(outcomeToJobStatus
        ? {
            status: outcomeToJobStatus,
            finishedAt: new Date(),
            errorMsg:
              failedMessages.length > 0
                ? `${outcomeToJobStatus === "failed" ? "Import failed" : "Partial import"}${scopeSummary ? `: ${scopeSummary}` : ""}. ${failedMessages.join(" | ")}`
                : null,
          }
        : {}),
      updatedAt: new Date(),
    },
  });
  try {
    logger.info("[warehouse-backfill-chunks] parent progress refreshed", {
      jobId: opts.jobId,
      status: aggregation.status,
      completed: aggregation.completedChunks,
      total: aggregation.totalChunks,
    });
  } catch {
    // Observability must never break checkpointing.
  }
  return aggregation;
}

export type CheckpointChunkExecutor = (opts: {
  workspaceId: string;
  connectionId: string;
  provider: string;
  accountId: string;
  since: string;
  until: string;
  chunkId: string;
}) => Promise<{ rows: number; partialError?: { code?: string; error?: unknown } }>;

/**
 * Executes every claimable chunk newest-first with per-chunk heartbeats.
 * Completed chunks are never contacted again on retry; failed chunks retry
 * within their bounded attempts; expired running chunks are reclaimed. The
 * executor publishes metrics (idempotent via the `CampaignMetric` unique
 * key); completion is recorded only afterwards with the committed row count,
 * preserving partial provider outcomes instead of discarding them.
 *
 * When no chunk is claimable but unfinished work remains under another
 * worker's active lease, the loop stops without finalizing: the returned
 * aggregation stays `running` so callers must not report terminal results.
 * Parent terminal transitions belong to the caller (`finalizeParent`), which
 * keeps the lease-fenced `completeImportJob` path authoritative.
 */
export async function runCheckpointedBackfillWorker(
  jobId: string,
  opts: {
    workspaceId: string;
    executor: CheckpointChunkExecutor;
    leaseTtlMs?: number;
    finalizeParent?: boolean;
    onChunkSettled?: (aggregation: ParentBackfillAggregation) => Promise<void> | void;
  },
): Promise<ParentBackfillAggregation> {
  await sweepExhaustedChunks({ workspaceId: opts.workspaceId, jobId });
  await failExhaustedQueuedChunks({ workspaceId: opts.workspaceId, jobId });
  let aggregation = aggregateChunkStates(await listBackfillChunks({ workspaceId: opts.workspaceId, jobId }));
  for (;;) {
    const claim = await claimNextBackfillChunk({ workspaceId: opts.workspaceId, jobId, leaseTtlMs: opts.leaseTtlMs });
    if (!claim.claimed) {
      if (claim.reason === "attempts_exhausted") {
        await failExhaustedQueuedChunks({ workspaceId: opts.workspaceId, jobId });
        aggregation =
          (await refreshParentJobFromChunks({ workspaceId: opts.workspaceId, jobId, finalize: opts.finalizeParent })) ??
          aggregation;
        continue;
      }
      break;
    }
    const chunk = claim.chunk;
    // The claim already incremented the fencing token; re-read the authoritative value.
    const claimedRow = await (prisma as any).warehouseBackfillChunk.findFirst({
      where: { id: chunk.id, workspaceId: opts.workspaceId },
    });
    const fencingToken = toRecord(claimedRow).fencingToken;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    try {
      heartbeatTimer = setInterval(() => {
        heartbeatBackfillChunk({ chunkId: chunk.id, workspaceId: opts.workspaceId, leaseId: claim.leaseId, fencingToken }).catch(
          () => {},
        );
      }, CHUNK_HEARTBEAT_INTERVAL_MS);
      const outcome = await opts.executor({
        workspaceId: opts.workspaceId,
        connectionId: chunk.connectionId,
        provider: chunk.provider,
        accountId: chunk.accountId,
        since: chunk.since,
        until: chunk.until,
        chunkId: chunk.id,
      });
      await completeBackfillChunk({
        chunkId: chunk.id,
        workspaceId: opts.workspaceId,
        leaseId: claim.leaseId,
        fencingToken,
        persistedRows: outcome.rows,
        ...(outcome.partialError ? { partialError: outcome.partialError } : {}),
      });
    } catch (error) {
      if (error instanceof ChunkAttemptsExhaustedError) {
        // Already marked failed by the claim path.
      } else if (error instanceof Error && error.name === "LeaseLostError") {
        // Parent lease lost: abort without consuming chunk attempts. The
        // claimed chunk keeps its lease and remains reclaimable on expiry.
        throw error;
      } else {
        try {
          const current = await (prisma as any).warehouseBackfillChunk.findFirst({
            where: { id: chunk.id, workspaceId: opts.workspaceId },
          });
          const fencingToken = toRecord(current).fencingToken;
          await failBackfillChunk({
            chunkId: chunk.id,
            workspaceId: opts.workspaceId,
            leaseId: claim.leaseId,
            fencingToken,
            error,
          });
        } catch (fenceError) {
          if (!(fenceError instanceof StaleChunkLeaseError)) throw fenceError;
        }
      }
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
    aggregation =
      (await refreshParentJobFromChunks({ workspaceId: opts.workspaceId, jobId, finalize: opts.finalizeParent })) ??
      aggregation;
    if (opts.onChunkSettled) await opts.onChunkSettled(aggregation);
  }
  aggregation =
    (await refreshParentJobFromChunks({ workspaceId: opts.workspaceId, jobId, finalize: opts.finalizeParent })) ??
    aggregation;
  return aggregation;
}
