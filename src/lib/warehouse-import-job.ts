import prisma from "@/lib/prisma";
import { getRedis } from "./redis";
import { logger } from "@/lib/logger";
import { randomUUID } from "crypto";

export interface BatchImportItem {
  connectionId: string;
  adAccountId?: string;
}

export interface BatchImportJobResult {
  connectionId: string;
  provider: string;
  adAccountId?: string;
  ok: boolean;
  upserted?: number;
  rowsIngested?: number;
  error?: string;
}

export interface BatchImportJobState {
  id: string;
  workspaceId: string;
  userId?: string;
  plan?: string;
  status: "queued" | "running" | "completed" | "failed";
  since: string;
  until: string;
  totalItems: number;
  completedItems: number;
  approximateRows: number;
  results: BatchImportJobResult[];
  error?: string;
  retryCount?: number;
  maxRetries?: number;
  scheduledAt?: string | Date;
  startedAt?: string | Date | null;
  finishedAt?: string | Date | null;
  createdAt: number;
  updatedAt: number;
}

const JOB_KEY_PREFIX = "monstera:import_job:";
const JOB_CACHE_TTL_SECONDS = 3600; // 1 hour for fast reads

function toState(job: any): BatchImportJobState {
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    userId: job.userId,
    plan: job.plan,
    status: job.status as BatchImportJobState["status"],
    since: job.since,
    until: job.until,
    totalItems: job.totalItems,
    completedItems: job.completedItems,
    approximateRows: job.approximateRows,
    results: (job.results as BatchImportJobResult[]) || [],
    error: job.errorMsg || undefined,
    retryCount: job.retryCount,
    maxRetries: job.maxRetries,
    scheduledAt: job.scheduledAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt instanceof Date ? job.createdAt.getTime() : job.createdAt,
    updatedAt: job.updatedAt instanceof Date ? job.updatedAt.getTime() : job.updatedAt,
  };
}

/**
 * Creates a durable import job in PostgreSQL (and writes cache).
 */
export async function createImportJob(params: {
  id?: string;
  workspaceId: string;
  userId: string;
  plan?: string;
  since: string;
  until: string;
  items: BatchImportItem[];
  idempotencyKey?: string;
  priority?: number;
}): Promise<BatchImportJobState> {
  const jobId = params.id || `import_${randomUUID()}`;

  // If idempotencyKey is provided, check if existing job exists
  if (params.idempotencyKey) {
    const existing = await prisma.warehouseImportJob.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      return toState(existing);
    }
  }

  const created = await prisma.warehouseImportJob.create({
    data: {
      id: jobId,
      workspaceId: params.workspaceId,
      userId: params.userId,
      plan: params.plan || "pilot",
      since: params.since,
      until: params.until,
      items: params.items as any,
      status: "queued",
      totalItems: params.items.length,
      completedItems: 0,
      approximateRows: 0,
      priority: params.priority ?? 1,
      idempotencyKey: params.idempotencyKey || null,
      results: [],
    },
  });

  const state = toState(created);

  try {
    const redis = getRedis();
    const key = `${JOB_KEY_PREFIX}${jobId}`;
    await redis.set(key, JSON.stringify(state), { ex: JOB_CACHE_TTL_SECONDS });
  } catch {
    // Non-fatal: PostgreSQL is authoritative
  }

  return state;
}

/**
 * Claims a queued or expired running job atomically.
 */
export async function claimImportJob(
  jobId: string,
  leaseDurationMs = 60000
): Promise<{ claimed: boolean; leaseId?: string; job?: BatchImportJobState }> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
  const leaseId = randomUUID();

  // Atomically claim if status is queued or lease has expired
  const updated = await prisma.warehouseImportJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: "queued" },
        { status: "running", leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      status: "running",
      leaseId,
      leaseExpiresAt,
      heartbeatAt: now,
      startedAt: now,
    },
  });

  if (updated.count === 0) {
    return { claimed: false };
  }

  const job = await prisma.warehouseImportJob.findUnique({ where: { id: jobId } });
  if (!job) return { claimed: false };

  const state = toState(job);

  try {
    const redis = getRedis();
    await redis.set(`${JOB_KEY_PREFIX}${jobId}`, JSON.stringify(state), { ex: JOB_CACHE_TTL_SECONDS });
  } catch {}

  return { claimed: true, leaseId, job: state };
}

/**
 * Extends lease time on an active job.
 */
export async function heartbeatImportJob(
  jobId: string,
  leaseId: string,
  extendMs = 60000
): Promise<boolean> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + extendMs);

  const updated = await prisma.warehouseImportJob.updateMany({
    where: { id: jobId, leaseId, status: "running" },
    data: {
      heartbeatAt: now,
      leaseExpiresAt,
    },
  });

  return updated.count > 0;
}

/**
 * Updates import job progress.
 */
export async function updateImportJobProgress(
  jobId: string,
  leaseId: string | null,
  patch: {
    completedItems?: number;
    approximateRows?: number;
    results?: BatchImportJobResult[];
  }
): Promise<BatchImportJobState | null> {
  const where: any = { id: jobId };
  if (leaseId) where.leaseId = leaseId;

  const job = await prisma.warehouseImportJob.findFirst({ where });
  if (!job) return null;

  const data: any = {
    updatedAt: new Date(),
  };
  if (typeof patch.completedItems === "number") data.completedItems = patch.completedItems;
  if (typeof patch.approximateRows === "number") data.approximateRows = patch.approximateRows;
  if (patch.results) data.results = patch.results as any;

  const updated = await prisma.warehouseImportJob.update({
    where: { id: jobId },
    data,
  });

  const state = toState(updated);
  try {
    const redis = getRedis();
    await redis.set(`${JOB_KEY_PREFIX}${jobId}`, JSON.stringify(state), { ex: JOB_CACHE_TTL_SECONDS });
  } catch {}

  return state;
}

/**
 * Marks job as completed.
 */
export async function completeImportJob(
  jobId: string,
  leaseId: string | null,
  summary: {
    completedItems?: number;
    approximateRows?: number;
    results?: BatchImportJobResult[];
  }
): Promise<BatchImportJobState | null> {
  const now = new Date();
  const where: any = { id: jobId };
  if (leaseId) where.leaseId = leaseId;

  const job = await prisma.warehouseImportJob.findFirst({ where });
  if (!job) return null;

  const updated = await prisma.warehouseImportJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      completedItems: summary.completedItems ?? job.totalItems,
      approximateRows: summary.approximateRows ?? job.approximateRows,
      results: (summary.results as any) ?? job.results,
      finishedAt: now,
      leaseId: null,
      leaseExpiresAt: null,
    },
  });

  const state = toState(updated);
  try {
    const redis = getRedis();
    await redis.set(`${JOB_KEY_PREFIX}${jobId}`, JSON.stringify(state), { ex: JOB_CACHE_TTL_SECONDS });
  } catch {}

  return state;
}

/**
 * Handles job failure with bounded exponential backoff retries.
 */
export async function failImportJob(
  jobId: string,
  leaseId: string | null,
  errorMsg: string,
  shouldRetry = true
): Promise<BatchImportJobState | null> {
  const now = new Date();
  const where: any = { id: jobId };
  if (leaseId) where.leaseId = leaseId;

  const job = await prisma.warehouseImportJob.findFirst({ where });
  if (!job) return null;

  const canRetry = shouldRetry && job.retryCount < job.maxRetries;

  if (canRetry) {
    // Exponential backoff: 5s, 20s, 60s
    const backoffSeconds = Math.min(60, 5 * Math.pow(2, job.retryCount * 2));
    const nextSchedule = new Date(now.getTime() + backoffSeconds * 1000);

    const updated = await prisma.warehouseImportJob.update({
      where: { id: jobId },
      data: {
        status: "queued",
        retryCount: { increment: 1 },
        scheduledAt: nextSchedule,
        errorMsg: `Attempt ${job.retryCount + 1} failed: ${errorMsg}`,
        leaseId: null,
        leaseExpiresAt: null,
      },
    });

    const state = toState(updated);
    try {
      const redis = getRedis();
      await redis.set(`${JOB_KEY_PREFIX}${jobId}`, JSON.stringify(state), { ex: JOB_CACHE_TTL_SECONDS });
    } catch {}

    logger.warn(`[failImportJob] Job ${jobId} failed, scheduled retry #${job.retryCount + 1} in ${backoffSeconds}s`);
    return state;
  }

  // Max retries exceeded -> final failure
  const updated = await prisma.warehouseImportJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      errorMsg,
      finishedAt: now,
      leaseId: null,
      leaseExpiresAt: null,
    },
  });

  const state = toState(updated);
  try {
    const redis = getRedis();
    await redis.set(`${JOB_KEY_PREFIX}${jobId}`, JSON.stringify(state), { ex: JOB_CACHE_TTL_SECONDS });
  } catch {}

  logger.error(`[failImportJob] Job ${jobId} failed permanently: ${errorMsg}`);
  return state;
}

/**
 * Fetches an import job by ID with fallback from Redis cache to authoritative PostgreSQL.
 */
export async function getImportJob(
  jobId: string,
  workspaceId?: string
): Promise<BatchImportJobState | null> {
  // Try Redis first
  try {
    const redis = getRedis();
    const cached = await redis.get(`${JOB_KEY_PREFIX}${jobId}`);
    if (cached) {
      const state: BatchImportJobState = typeof cached === "string" ? JSON.parse(cached) : cached;
      if (!workspaceId || state.workspaceId === workspaceId) {
        return state;
      }
    }
  } catch {
    // Fall back to DB
  }

  const where: any = { id: jobId };
  if (workspaceId) where.workspaceId = workspaceId;

  const job = await prisma.warehouseImportJob.findFirst({ where });
  if (!job) return null;

  const state = toState(job);

  // Refresh cache
  try {
    const redis = getRedis();
    await redis.set(`${JOB_KEY_PREFIX}${jobId}`, JSON.stringify(state), { ex: JOB_CACHE_TTL_SECONDS });
  } catch {}

  return state;
}

/**
 * Backward compatibility: updateImportJob
 */
export async function updateImportJob(
  jobId: string,
  patch: Partial<BatchImportJobState>
): Promise<BatchImportJobState | null> {
  const data: any = { updatedAt: new Date() };
  if (patch.status) data.status = patch.status;
  if (typeof patch.completedItems === "number") data.completedItems = patch.completedItems;
  if (typeof patch.approximateRows === "number") data.approximateRows = patch.approximateRows;
  if (patch.results) data.results = patch.results as any;
  if (patch.error) data.errorMsg = patch.error;

  try {
    const updated = await prisma.warehouseImportJob.update({
      where: { id: jobId },
      data,
    });
    const state = toState(updated);
    try {
      const redis = getRedis();
      await redis.set(`${JOB_KEY_PREFIX}${jobId}`, JSON.stringify(state), { ex: JOB_CACHE_TTL_SECONDS });
    } catch {}
    return state;
  } catch (err) {
    logger.error(`[updateImportJob] Error updating job ${jobId}`, err);
    return null;
  }
}

/**
 * Claims the next available queued or expired job from the PostgreSQL queue.
 * Orders by priority DESC, scheduledAt ASC.
 */
export async function claimNextImportJob(
  leaseDurationMs = 60000
): Promise<{ claimed: boolean; leaseId?: string; job?: BatchImportJobState }> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
  const leaseId = randomUUID();

  // Find next eligible job
  const candidate = await prisma.warehouseImportJob.findFirst({
    where: {
      OR: [
        { status: "queued", scheduledAt: { lte: now } },
        { status: "running", leaseExpiresAt: { lt: now } },
      ],
    },
    orderBy: [{ priority: "desc" }, { scheduledAt: "asc" }],
  });

  if (!candidate) return { claimed: false };

  const updated = await prisma.warehouseImportJob.updateMany({
    where: {
      id: candidate.id,
      OR: [
        { status: "queued", scheduledAt: { lte: now } },
        { status: "running", leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      status: "running",
      leaseId,
      leaseExpiresAt,
      heartbeatAt: now,
      startedAt: candidate.startedAt ?? now,
    },
  });

  if (updated.count === 0) {
    return { claimed: false };
  }

  const job = await prisma.warehouseImportJob.findUnique({ where: { id: candidate.id } });
  if (!job) return { claimed: false };

  const state = toState(job);
  try {
    const redis = getRedis();
    await redis.set(`${JOB_KEY_PREFIX}${job.id}`, JSON.stringify(state), { ex: JOB_CACHE_TTL_SECONDS });
  } catch {}

  return { claimed: true, leaseId, job: state };
}
