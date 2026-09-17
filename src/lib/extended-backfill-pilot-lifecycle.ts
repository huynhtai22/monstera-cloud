/**
 * Extended-backfill pilot lifecycle: admission, quotas, pause/resume/cancel,
 * and operator-driven execution.
 *
 * All durable state lives on the deployed tables (`WarehouseImportJob` +
 * `WarehouseBackfillChunk`); no migration was required. Pilot jobs are
 * identified by the `xbpilot:` idempotency prefix and are invisible to the
 * generic schedulers (`claimNextImportJob({ excludePilotJobs: true })`,
 * `runDurableImportWorker` refusal). Execution happens only through
 * `runPilotBackfillJob`, invoked by the operator execute endpoint with an
 * injected executor (synthetic for qualification, warehouse-sync for gated
 * live stages).
 *
 * Parent lifecycle states add `paused`, `pause_requested`, `cancelled`, and
 * `partial_cancelled` to the deployed set. Chunk states add `cancelled`.
 * `failed` is never overloaded for pause or cancellation.
 */

import prisma from "@/lib/prisma";
import { getCanonicalDateRange } from "./warehouse-date-range";
import { planHistoricalBackfill } from "./historical-backfill-plan";
import {
  aggregateChunkStates,
  CHUNK_HEARTBEAT_INTERVAL_MS,
  ChunkAttemptsExhaustedError,
  claimNextBackfillChunk,
  completeBackfillChunk,
  failBackfillChunk,
  failExhaustedQueuedChunks,
  heartbeatBackfillChunk,
  listBackfillChunks,
  refreshParentJobFromChunks,
  StaleChunkLeaseError,
  sweepExhaustedChunks,
  validateChunkSpecs,
  type BackfillChunkRecord,
  type CheckpointChunkExecutor,
  type ParentBackfillAggregation,
} from "./warehouse-backfill-chunks";
import { createImportJob, claimImportJob, completeImportJob, type BatchImportJobState } from "./warehouse-import-job";
import {
  auditPilotEvent,
  createPilotJobKey,
  decideExtendedBackfill,
  estimatePilotCapacity,
  getProviderPilotEligibility,
  isPilotJobKey,
  loadExtendedBackfillPilotConfig,
  normalizePilotAccountId,
  normalizePilotProvider,
  PILOT_ROWS_PER_CALL_PLANNING_ASSUMPTION,
  PilotAdmissionError,
  type CapacityDecision,
  type ExtendedBackfillDecision,
  type ExtendedBackfillPilotConfig,
  type ExtendedBackfillReasonCode,
} from "./extended-backfill-pilot";

export const PILOT_ACTIVE_JOB_STATUSES = ["queued", "running", "paused", "pause_requested"] as const;
export const PILOT_TERMINAL_JOB_STATUSES = ["completed", "partial", "failed", "cancelled", "partial_cancelled"] as const;
/** Chunks per operator execute invocation (resumable; HTTP-timeout hygiene). */
export const PILOT_EXECUTE_CHUNK_BUDGET = 25;

function startOfUtcDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function inclusiveDays(since: string, until: string): number {
  const canonical = getCanonicalDateRange(since, until);
  return Math.round((canonical.endUtc.getTime() - canonical.startUtc.getTime()) / 86_400_000) + 1;
}

function rangesOverlap(aSince: string, aUntil: string, bSince: string, bUntil: string): boolean {
  return aSince <= bUntil && bSince <= aUntil;
}

export interface PilotAdmissionParams {
  actorUserId: string;
  workspaceId: string;
  provider: unknown;
  connectionId: string;
  accountId?: unknown;
  since: string;
  until: string;
  clientKey?: string;
  observedRowsPerDay?: number | null;
  bytesPerRow?: number | null;
  config?: ExtendedBackfillPilotConfig;
  env?: NodeJS.ProcessEnv;
}

export interface AdmittedPilotJob {
  job: BatchImportJobState;
  chunks: { id: string; since: string; until: string; ordinal: number }[];
  decision: ExtendedBackfillDecision;
  capacity: CapacityDecision;
  reused: boolean;
}

/**
 * Admits and transactionally creates an extended pilot job. The advisory lock
 * serializes admission per workspace so two concurrent requests cannot both
 * consume the last quota slot; the idempotency key makes exact replays
 * converge without consuming quota twice. Throws PilotAdmissionError (with
 * the structured decision) on any gate failure — with zero jobs, chunks,
 * provider calls, writes, or success audits.
 */
export async function admitAndCreatePilotJob(params: PilotAdmissionParams): Promise<AdmittedPilotJob> {
  const config = params.config ?? loadExtendedBackfillPilotConfig(params.env);
  const provider = normalizePilotProvider(params.provider);
  const accountId = normalizePilotAccountId(params.accountId);
  const workspaceId = params.workspaceId;

  const refuse = (reasonCode: ExtendedBackfillReasonCode): never => {
    const decision: ExtendedBackfillDecision = {
      allowed: false,
      reasonCode,
      provider: provider ?? String(params.provider ?? ""),
      stage: config.stage,
      requestedDays: 0,
      maximumDays: getProviderPilotEligibility(provider ?? "")?.pilotMaxDays ?? 0,
      workspaceAllowed: false,
      operatorAuthorized: true,
      capacityAccepted: false,
    };
    throw new PilotAdmissionError(reasonCode, decision);
  };
  if (!provider || accountId === null) refuse("PROVIDER_INELIGIBLE");
  if (!params.connectionId || typeof params.connectionId !== "string") refuse("PROVIDER_INELIGIBLE");
  if (!getProviderPilotEligibility(provider!)) refuse("PROVIDER_INELIGIBLE");

  let requestedDays = 0;
  try {
    requestedDays = inclusiveDays(params.since, params.until);
  } catch {
    refuse("INVALID_DATE_RANGE");
  }

  const idempotencyKey = createPilotJobKey({
    workspaceId,
    provider: provider!,
    connectionId: params.connectionId,
    accountId: accountId!,
    since: params.since,
    until: params.until,
    stage: config.stage,
    ...(params.clientKey ? { clientKey: params.clientKey } : {}),
  });

  // Canonical deterministic plan (planning mode never executes).
  let plan: ReturnType<typeof planHistoricalBackfill>;
  try {
    plan = planHistoricalBackfill({
      provider: provider!,
      since: params.since,
      until: params.until,
      asOf: params.until,
      execution: "plan",
    });
  } catch {
    refuse("INVALID_DATE_RANGE");
    throw new Error("unreachable");
  }

  const result = await (prisma as any).$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"xbpilot:admit:" + workspaceId}))`;

    const existing = await tx.warehouseImportJob.findUnique({
      where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey } },
    });
    if (existing) {
      return { reusedJob: existing, created: false as const };
    }

    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
    const connection = await tx.connection.findFirst({
      where: { id: params.connectionId, workspaceId },
      select: { id: true },
    });
    const facts = {
      workspaceExists: Boolean(workspace),
      connectionExists: Boolean(connection),
      workspaceAllowlisted: config.allowedWorkspaceIds.includes(workspaceId),
      activeJobsInWorkspace: await tx.warehouseImportJob.count({
        where: {
          workspaceId,
          idempotencyKey: { startsWith: "xbpilot:" },
          status: { in: [...PILOT_ACTIVE_JOB_STATUSES] },
        },
      }),
      overlappingActiveJobs: 0,
      plannedChunks: plan.chunks.length,
      providerCallsToday: 0,
      runningChunksWorkspace: 0,
      runningChunksAccount: 0,
      capacity: { status: "unknown", estimatedRows: null, estimatedStorageBytes: null, plannedChunks: plan.chunks.length, assumptions: [] as string[], reasonCodes: ["NOT_EVALUATED"] } as CapacityDecision,
    };

    // Overlap against active pilot jobs for the same connection/account/range.
    const candidates = await tx.warehouseImportJob.findMany({
      where: {
        workspaceId,
        idempotencyKey: { startsWith: "xbpilot:" },
        status: { in: [...PILOT_ACTIVE_JOB_STATUSES] },
        since: { lte: params.until },
        until: { gte: params.since },
      },
      select: { id: true, since: true, until: true, items: true },
    });
    const overlapping = candidates.filter((job: any) => {
      const items = (job.items as any[]) ?? [];
      const sameScope = items.some(
        (item: any) =>
          item?.connectionId === params.connectionId &&
          (item?.accountId ?? item?.adAccountId ?? "") === accountId,
      );
      return sameScope && rangesOverlap(job.since, job.until, params.since, params.until);
    });
    facts.overlappingActiveJobs = overlapping.length;

    const dayStart = startOfUtcDay();
    facts.providerCallsToday = await tx.warehouseBackfillChunk.count({
      where: {
        workspaceId,
        provider: provider!,
        completedAt: { gte: dayStart },
      },
    });
    facts.runningChunksWorkspace = await tx.warehouseBackfillChunk.count({
      where: { workspaceId, status: "running" },
    });
    facts.runningChunksAccount = await tx.warehouseBackfillChunk.count({
      where: {
        workspaceId,
        status: "running",
        connectionId: params.connectionId,
        accountId: accountId!,
      },
    });
    const existingScopeRows = await tx.campaignMetric.count({
      where: { workspaceId, connectionId: params.connectionId },
    });
    const capacity = estimatePilotCapacity({
      provider: provider!,
      requestedDays,
      plannedChunks: plan.chunks.length,
      observedRowsPerDay: params.observedRowsPerDay ?? null,
      existingScopeRows,
      activeJobs: facts.activeJobsInWorkspace,
      activeChunks: facts.runningChunksWorkspace,
      bytesPerRow: params.bytesPerRow ?? null,
      limits: {
        maxChunksPerJob: config.maxChunksPerJob,
        maxEstimatedRows: config.maxProviderCallsPerDay * PILOT_ROWS_PER_CALL_PLANNING_ASSUMPTION,
      },
    });
    facts.capacity = capacity;

    const decision = decideExtendedBackfill(
      {
        entryPoint: "operator",
        operation: "create",
        provider: provider!,
        since: params.since,
        until: params.until,
        operatorAuthorized: true,
      },
      config,
      facts,
    );
    if (!decision.allowed) {
      throw new PilotAdmissionError(decision.reasonCode, decision);
    }

    const specs = plan.chunks.map((chunk) => ({
      connectionId: params.connectionId,
      accountId: accountId!,
      provider: provider!,
      since: chunk.since,
      until: chunk.until,
      ordinal: chunk.ordinal,
    }));
    validateChunkSpecs(specs, params.env, { pilotTotalDaysAllowed: decision.maximumDays });
    const job = await createImportJob({
      workspaceId,
      userId: params.actorUserId,
      plan: "pilot",
      since: params.since,
      until: params.until,
      items: specs.map((spec) => ({
        connectionId: spec.connectionId,
        ...(spec.accountId ? { accountId: spec.accountId } : {}),
        executionSince: spec.since,
        executionUntil: spec.until,
      })),
      chunks: specs,
      pilotTotalDaysAllowed: decision.maximumDays,
      idempotencyKey,
      priority: 5,
      client: {
        warehouseImportJob: tx.warehouseImportJob,
        warehouseBackfillChunk: tx.warehouseBackfillChunk,
      },
      throwOnConflict: true,
    });
    await auditPilotEvent(tx, {
      workspaceId,
      actorUserId: params.actorUserId,
      action: "pilot.extended_backfill.job_created",
      jobId: job.id,
      provider: provider!,
      stage: config.stage,
      reasonCode: "OK",
      requestedDays,
      plannedChunks: plan.chunks.length,
    });
    return { createdJob: job, createdCapacity: capacity, created: true as const };
  });

  if (!result.created) {
    const job = result.reusedJob;
    const state = {
      id: job.id, workspaceId: job.workspaceId, userId: job.userId, plan: job.plan,
      since: job.since, until: job.until, items: job.items, totalItems: job.totalItems,
      completedItems: job.completedItems, approximateRows: job.approximateRows, status: job.status,
      retryCount: job.retryCount, maxRetries: job.maxRetries, scheduledAt: job.scheduledAt,
      startedAt: job.startedAt, finishedAt: job.finishedAt, heartbeatAt: job.heartbeatAt,
      leaseId: job.leaseId, leaseExpiresAt: job.leaseExpiresAt, priority: job.priority,
      idempotencyKey: job.idempotencyKey, results: job.results, errorMsg: job.errorMsg,
      createdAt: job.createdAt, updatedAt: job.updatedAt,
    } as unknown as BatchImportJobState;
    const chunks = await listBackfillChunks({ workspaceId, jobId: job.id });
    return {
      job: state,
      chunks: chunks.map((chunk) => ({ id: chunk.id, since: chunk.since, until: chunk.until, ordinal: chunk.ordinal })),
      decision: {
        allowed: true, reasonCode: "OK", provider: provider!, stage: config.stage,
        requestedDays, maximumDays: getProviderPilotEligibility(provider!)?.pilotMaxDays ?? 0,
        workspaceAllowed: true, operatorAuthorized: true, capacityAccepted: true,
      },
      capacity: estimatePilotCapacity({
        provider: provider!, requestedDays, plannedChunks: chunks.length,
        observedRowsPerDay: params.observedRowsPerDay ?? null, existingScopeRows: 0,
        activeJobs: 0, activeChunks: 0, bytesPerRow: params.bytesPerRow ?? null,
        limits: { maxChunksPerJob: config.maxChunksPerJob, maxEstimatedRows: null },
      }),
      reused: true,
    };
  }

  const chunks = await listBackfillChunks({ workspaceId, jobId: result.createdJob.id });
  return {
    job: result.createdJob,
    chunks: chunks.map((chunk) => ({ id: chunk.id, since: chunk.since, until: chunk.until, ordinal: chunk.ordinal })),
    decision: {
      allowed: true, reasonCode: "OK", provider: provider!, stage: config.stage,
      requestedDays, maximumDays: getProviderPilotEligibility(provider!)?.pilotMaxDays ?? 0,
      workspaceAllowed: true, operatorAuthorized: true,
      capacityAccepted: result.createdCapacity.status === "accept" || result.createdCapacity.status === "warn",
    },
    capacity: result.createdCapacity,
    reused: false,
  };
}

export interface PilotJobContext {
  job: any;
  chunks: BackfillChunkRecord[];
  aggregation: ParentBackfillAggregation;
}

/** Loads a pilot job with workspace isolation and pilot-marker enforcement. */
export async function loadPilotJob(opts: {
  workspaceId: string;
  jobId: string;
}): Promise<PilotJobContext | null> {
  const job = await (prisma as any).warehouseImportJob.findFirst({
    where: { id: opts.jobId, workspaceId: opts.workspaceId },
  });
  if (!job || !isPilotJobKey(job.idempotencyKey)) return null;
  const chunks = await listBackfillChunks({ workspaceId: opts.workspaceId, jobId: opts.jobId });
  return { job, chunks, aggregation: aggregateChunkStates(chunks) };
}

async function auditTransition(opts: {
  workspaceId: string;
  actorUserId: string;
  action: string;
  jobId: string;
  provider: string;
  stage: string;
  reasonCode?: string;
}): Promise<void> {
  await auditPilotEvent(prisma as any, {
    workspaceId: opts.workspaceId,
    actorUserId: opts.actorUserId,
    action: opts.action,
    jobId: opts.jobId,
    provider: opts.provider,
    stage: opts.stage,
    reasonCode: opts.reasonCode ?? "OK",
  });
}

async function providerOfJob(opts: { workspaceId: string; jobId: string }): Promise<string> {
  const chunks = await listBackfillChunks(opts);
  return chunks[0]?.provider ?? "";
}

/**
 * Pauses a pilot job. New claims stop immediately; in-flight leased chunks
 * finish safely. Reports `paused` once nothing remains actively owned, else
 * `pause_requested` while draining. Idempotent.
 */
export async function pausePilotJob(opts: {
  workspaceId: string;
  jobId: string;
  actorUserId: string;
}): Promise<{ status: string; changed: boolean }> {
  const ctx = await loadPilotJob(opts);
  if (!ctx) throw new PilotNotFoundError();
  const current = String(ctx.job.status);
  if (current === "paused" || current === "pause_requested") {
    return { status: current, changed: false };
  }
  if ((PILOT_TERMINAL_JOB_STATUSES as readonly string[]).includes(current)) {
    return { status: current, changed: false };
  }
  const runningOwned = ctx.chunks.filter(
    (chunk) => chunk.status === "running" && chunk.leaseExpiresAt && chunk.leaseExpiresAt.getTime() >= Date.now(),
  );
  const next = runningOwned.length > 0 ? "pause_requested" : "paused";
  const updated = await (prisma as any).warehouseImportJob.updateMany({
    where: { id: opts.jobId, workspaceId: opts.workspaceId, status: current },
    data: { status: next, updatedAt: new Date() },
  });
  if (updated.count === 0) {
    const latest = await loadPilotJob(opts);
    return { status: String(latest?.job.status ?? current), changed: false };
  }
  await auditTransition({
    workspaceId: opts.workspaceId,
    actorUserId: opts.actorUserId,
    action: "pilot.extended_backfill.job_paused",
    jobId: opts.jobId,
    provider: await providerOfJob(opts),
    stage: "operator",
  });
  return { status: next, changed: true };
}

/**
 * Resumes a paused pilot job. Re-checks stage, allowlist, and capacity gates
 * (quota is evaluated excluding the job itself); never resets completed
 * chunks or attempt counters. Idempotent.
 */
export async function resumePilotJob(opts: {
  workspaceId: string;
  jobId: string;
  actorUserId: string;
  config?: ExtendedBackfillPilotConfig;
  env?: NodeJS.ProcessEnv;
  observedRowsPerDay?: number | null;
  bytesPerRow?: number | null;
}): Promise<{ status: string; changed: boolean }> {
  const ctx = await loadPilotJob(opts);
  if (!ctx) throw new PilotNotFoundError();
  const current = String(ctx.job.status);
  if (current === "queued" || current === "running") {
    return { status: current, changed: false };
  }
  if ((PILOT_TERMINAL_JOB_STATUSES as readonly string[]).includes(current)) {
    throw new PilotStateError(`Cannot resume terminal pilot job (status ${current}).`);
  }
  const config = opts.config ?? loadExtendedBackfillPilotConfig(opts.env);
  const provider = await providerOfJob(opts);
  const dayStart = startOfUtcDay();
  const connectionId = ctx.chunks[0]?.connectionId ?? "";
  const accountId = ctx.chunks[0]?.accountId ?? "";
  const [providerCallsToday, runningChunksWorkspace, runningChunksAccount] = await Promise.all([
    prisma.warehouseBackfillChunk.count({
      where: { workspaceId: opts.workspaceId, provider, completedAt: { gte: dayStart } },
    }),
    prisma.warehouseBackfillChunk.count({ where: { workspaceId: opts.workspaceId, status: "running" } }),
    prisma.warehouseBackfillChunk.count({
      where: { workspaceId: opts.workspaceId, status: "running", connectionId, accountId },
    }),
  ]);
  const activeJobs = await (prisma as any).warehouseImportJob.count({
    where: {
      workspaceId: opts.workspaceId,
      idempotencyKey: { startsWith: "xbpilot:" },
      status: { in: [...PILOT_ACTIVE_JOB_STATUSES] },
      NOT: { id: opts.jobId },
    },
  });
  const capacity = estimatePilotCapacity({
    provider,
    requestedDays: inclusiveDays(ctx.job.since, ctx.job.until),
    plannedChunks: ctx.chunks.length,
    observedRowsPerDay: opts.observedRowsPerDay ?? null,
    existingScopeRows: 0,
    activeJobs,
    activeChunks: 0,
    bytesPerRow: opts.bytesPerRow ?? null,
    limits: {
      maxChunksPerJob: config.maxChunksPerJob,
      maxEstimatedRows: config.maxProviderCallsPerDay * PILOT_ROWS_PER_CALL_PLANNING_ASSUMPTION,
    },
  });
  const decision = decideExtendedBackfill(
    {
      entryPoint: "operator",
      operation: "create",
      provider,
      since: ctx.job.since,
      until: ctx.job.until,
      operatorAuthorized: true,
    },
    config,
    {
      workspaceExists: true,
      connectionExists: true,
      workspaceAllowlisted: config.allowedWorkspaceIds.includes(opts.workspaceId),
      activeJobsInWorkspace: activeJobs,
      overlappingActiveJobs: 0,
      plannedChunks: ctx.chunks.length,
      providerCallsToday,
      runningChunksWorkspace,
      runningChunksAccount,
      capacity,
    },
  );
  if (!decision.allowed) {
    throw new PilotAdmissionError(decision.reasonCode, decision);
  }
  const updated = await (prisma as any).warehouseImportJob.updateMany({
    where: { id: opts.jobId, workspaceId: opts.workspaceId, status: current },
    data: { status: "queued", scheduledAt: new Date(), updatedAt: new Date() },
  });
  if (updated.count === 0) {
    const latest = await loadPilotJob(opts);
    return { status: String(latest?.job.status ?? current), changed: false };
  }
  await auditTransition({
    workspaceId: opts.workspaceId,
    actorUserId: opts.actorUserId,
    action: "pilot.extended_backfill.job_resumed",
    jobId: opts.jobId,
    provider,
    stage: "operator",
  });
  return { status: "queued", changed: true };
}

/**
 * Cancels a pilot job. Queued chunks transition to `cancelled` immediately
 * and can never be claimed again; running chunks keep their leases and may
 * finish (fenced) with metrics preserved. Completed metrics remain
 * available. Idempotent.
 */
export async function cancelPilotJob(opts: {
  workspaceId: string;
  jobId: string;
  actorUserId: string;
}): Promise<{ status: string; changed: boolean }> {
  const ctx = await loadPilotJob(opts);
  if (!ctx) throw new PilotNotFoundError();
  const current = String(ctx.job.status);
  if (current === "cancelled" || current === "partial_cancelled") {
    return { status: current, changed: false };
  }
  if (current === "completed" || current === "partial" || current === "failed") {
    return { status: current, changed: false };
  }
  const cancelled = await (prisma as any).warehouseBackfillChunk.updateMany({
    where: { workspaceId: opts.workspaceId, jobId: opts.jobId, status: "queued" },
    data: { status: "cancelled", leaseId: null, leaseExpiresAt: null, updatedAt: new Date() },
  });
  void cancelled;
  const after = await listBackfillChunks({ workspaceId: opts.workspaceId, jobId: opts.jobId });
  const completedCount = after.filter((chunk) => chunk.status === "completed").length;
  const next = completedCount > 0 ? "partial_cancelled" : "cancelled";
  const updated = await (prisma as any).warehouseImportJob.updateMany({
    where: { id: opts.jobId, workspaceId: opts.workspaceId, status: current },
    data: {
      status: next,
      finishedAt: new Date(),
      errorMsg: null,
      updatedAt: new Date(),
    },
  });
  if (updated.count === 0) {
    const latest = await loadPilotJob(opts);
    return { status: String(latest?.job.status ?? current), changed: false };
  }
  await refreshParentJobFromChunks({ workspaceId: opts.workspaceId, jobId: opts.jobId });
  await (prisma as any).warehouseImportJob.updateMany({
    where: { id: opts.jobId, workspaceId: opts.workspaceId, status: { in: ["queued", "running", "paused", "pause_requested"] } },
    data: { status: next, finishedAt: new Date(), updatedAt: new Date() },
  });
  await auditTransition({
    workspaceId: opts.workspaceId,
    actorUserId: opts.actorUserId,
    action: "pilot.extended_backfill.job_cancelled",
    jobId: opts.jobId,
    provider: await providerOfJob(opts),
    stage: "operator",
  });
  return { status: next, changed: true };
}

export class PilotNotFoundError extends Error {
  constructor() {
    super("Pilot job not found in workspace.");
    this.name = "PilotNotFoundError";
  }
}

export class PilotStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PilotStateError";
  }
}

/**
 * Settles a held parent lease when a pilot run stops without finalizing
 * (chunk budget, pause/cancel break). A running parent goes back to queued
 * with the lease cleared so the job stays resumable; an operator-moved
 * parent (paused/cancelled) only has the stale lease reference dropped.
 * Never touches terminal rows. Best-effort: zero matched rows are fine.
 */
async function settleParentLease(opts: { jobId: string; workspaceId: string; leaseId: string }): Promise<void> {
  const reset = await (prisma as any).warehouseImportJob.updateMany({
    where: { id: opts.jobId, workspaceId: opts.workspaceId, leaseId: opts.leaseId, status: "running" },
    data: { status: "queued", leaseId: null, leaseExpiresAt: null, updatedAt: new Date() },
  });
  if (reset.count === 0) {
    await (prisma as any).warehouseImportJob.updateMany({
      where: {
        id: opts.jobId,
        workspaceId: opts.workspaceId,
        leaseId: opts.leaseId,
        status: { in: ["paused", "pause_requested"] },
      },
      data: { leaseId: null, leaseExpiresAt: null, updatedAt: new Date() },
    });
  }
}

/**
 * Operator-driven pilot execution. Claims the parent, then executes up to a
 * bounded number of chunks with pause/cancel awareness: the parent is
 * re-read before every claim, and any pause/cancel/terminal state stops the
 * loop without finalizing. Terminal transitions happen only through the
 * lease-fenced `completeImportJob` while the parent is still running.
 * Resumable: re-invoking continues from the first unfinished chunk.
 */
export async function runPilotBackfillJob(
  jobId: string,
  opts: {
    workspaceId: string;
    executor?: CheckpointChunkExecutor;
    /** Builds the executor once the parent lease is held (receives the lease for progress writes). */
    createExecutor?: (parentLeaseId: string) => CheckpointChunkExecutor;
    leaseTtlMs?: number;
    maxChunks?: number;
    finalizeParent?: boolean;
    onChunkSettled?: (aggregation: ParentBackfillAggregation) => Promise<void> | void;
  },
): Promise<ParentBackfillAggregation> {
  const budget = opts.maxChunks ?? PILOT_EXECUTE_CHUNK_BUDGET;
  const parentClaim = await claimImportJob(jobId);
  if (!parentClaim.claimed || !parentClaim.leaseId) {
    throw new PilotStateError("Pilot parent job is not claimable (already running or terminal).");
  }
  const parentLeaseId = parentClaim.leaseId;
  const executor = opts.createExecutor ? opts.createExecutor(parentLeaseId) : opts.executor;
  if (!executor) {
    throw new PilotStateError("Pilot execution requires an executor.");
  }
  let executed = 0;
  try {
    await sweepExhaustedChunks({ workspaceId: opts.workspaceId, jobId });
    await failExhaustedQueuedChunks({ workspaceId: opts.workspaceId, jobId });
    let aggregation = aggregateChunkStates(await listBackfillChunks({ workspaceId: opts.workspaceId, jobId }));
    for (;;) {
      const parent = await (prisma as any).warehouseImportJob.findFirst({
        where: { id: jobId, workspaceId: opts.workspaceId },
        select: { status: true },
      });
      const parentStatus = String(parent?.status ?? "");
      // Stop on pause/cancel/terminal without finalizing; the held lease is
      // released at the end so the job stays resumable instead of wedged.
      if (parentStatus !== "running") break;
      if (executed >= budget) break;
      const claim = await claimNextBackfillChunk({ workspaceId: opts.workspaceId, jobId, leaseTtlMs: opts.leaseTtlMs });
      if (!claim.claimed) {
        if (claim.reason === "attempts_exhausted") {
          await failExhaustedQueuedChunks({ workspaceId: opts.workspaceId, jobId });
          continue;
        }
        break;
      }
      const chunk = claim.chunk;
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
        const outcome = await executor({
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
        executed += 1;
      } catch (error) {
        if (error instanceof ChunkAttemptsExhaustedError) {
          // Already marked failed by the claim path.
        } else if (error instanceof Error && error.name === "LeaseLostError") {
          throw error;
        } else {
          try {
            const current = await (prisma as any).warehouseBackfillChunk.findFirst({
              where: { id: chunk.id, workspaceId: opts.workspaceId },
            });
            await failBackfillChunk({
              chunkId: chunk.id,
              workspaceId: opts.workspaceId,
              leaseId: claim.leaseId,
              fencingToken: toRecord(current).fencingToken,
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
        (await refreshParentJobFromChunks({ workspaceId: opts.workspaceId, jobId })) ?? aggregation;
      if (opts.onChunkSettled) await opts.onChunkSettled(aggregation);
      // Settle a drain request once nothing remains actively owned.
      const current = await listBackfillChunks({ workspaceId: opts.workspaceId, jobId });
      const stillRunning = current.some((row) => row.status === "running");
      const parentNow = await (prisma as any).warehouseImportJob.findFirst({
        where: { id: jobId, workspaceId: opts.workspaceId },
        select: { status: true },
      });
      if (String(parentNow?.status) === "pause_requested" && !stillRunning) {
        await (prisma as any).warehouseImportJob.updateMany({
          where: { id: jobId, workspaceId: opts.workspaceId, status: "pause_requested" },
          data: { status: "paused", updatedAt: new Date() },
        });
        break;
      }
    }
    aggregation = aggregateChunkStates(await listBackfillChunks({ workspaceId: opts.workspaceId, jobId }));
    const parentNow = await (prisma as any).warehouseImportJob.findFirst({
      where: { id: jobId, workspaceId: opts.workspaceId },
      select: { status: true },
    });
    // Finalize only when no unfinished work remains: a budget-capped stop
    // with queued/running chunks stays resumable instead of falsely
    // completing. Pause/cancel/terminal parents are never finalized here.
    const unfinished = aggregation.queuedChunks + aggregation.runningChunks;
    let finalized = false;
    if (String(parentNow?.status) === "running" && opts.finalizeParent !== false && unfinished === 0) {
      try {
        const { chunkResultsForModal } = await import("./warehouse-backfill-chunks");
        const chunks = await listBackfillChunks({ workspaceId: opts.workspaceId, jobId });
        const modalResults = chunkResultsForModal(chunks);
        const failed = modalResults.filter((result) => !result.ok);
        const outcome =
          failed.length === 0 ? "completed" : failed.length === modalResults.length ? "failed" : "partial";
        const totalRows = modalResults.reduce((sum, result) => sum + (result.upserted ?? result.rowsIngested ?? 0), 0);
        await completeImportJob(
          jobId,
          parentLeaseId,
          modalResults,
          totalRows,
          outcome,
          failed.length > 0
            ? `${outcome === "failed" ? "Import failed" : "Partial import"}: ${failed.length}/${modalResults.length} chunk(s) failed.`
            : undefined,
        );
        finalized = true;
        aggregation = aggregateChunkStates(chunks);
      } catch (error) {
        await settleParentLease({ jobId, workspaceId: opts.workspaceId, leaseId: parentLeaseId }).catch(() => {});
        throw error;
      }
    }
    if (!finalized) {
      // No terminal transition took ownership: release the held parent lease
      // (no-op when already lost) so the job stays resumable.
      await settleParentLease({ jobId, workspaceId: opts.workspaceId, leaseId: parentLeaseId }).catch(() => {});
    }
    return aggregation;
  } catch (error) {
    if (error instanceof Error && error.name === "LeaseLostError") throw error;
    throw error;
  }
}

function toRecord(row: any) {
  return {
    ...row,
    fencingToken: typeof row.fencingToken === "bigint" ? row.fencingToken : BigInt(row.fencingToken ?? 0),
  };
}
