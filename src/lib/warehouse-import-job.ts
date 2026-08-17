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

export class LeaseLostError extends Error {
  constructor(jobId: string, leaseId: string) {
    super(`Lease ${leaseId} lost or superseded for job ${jobId}`);
    this.name = "LeaseLostError";
  }
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

export function computeBackoffMs(retryCount: number): number {
  if (retryCount <= 0) return 5000; // 5s
  if (retryCount === 1) return 20000; // 20s
  return 60000; // 60s max
}

/**
 * Creates a durable import job in PostgreSQL (and writes cache).
 * Handles race-safe idempotency scoped strictly to (workspaceId, idempotencyKey).
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

  // If idempotencyKey is provided, check if existing job exists for this workspace
  if (params.idempotencyKey) {
    const existing = await prisma.warehouseImportJob.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: params.workspaceId,
          idempotencyKey: params.idempotencyKey,
        },
      },
    });
    if (existing) {
      return toState(existing);
    }
  }

  try {
    const created = await prisma.warehouseImportJob.create({
      data: {
        id: jobId,
        workspaceId: params.workspaceId,
        userId: params.userId,
        plan: params.plan || "pilot",
        since: params.since,
        until: params.until,
        items: params.items as any,
        totalItems: params.items.length,
        status: "queued",
        priority: params.priority || 1,
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
  } catch (err: any) {
    // Handle concurrent creation race on (workspaceId, idempotencyKey)
    if (err?.code === "P2002" && params.idempotencyKey) {
      const existing = await prisma.warehouseImportJob.findUnique({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: params.workspaceId,
            idempotencyKey: params.idempotencyKey,
          },
        },
      });
      if (existing) {
        return toState(existing);
      }
    }
    throw err;
  }
}

/**
 * Claims a specific queued or expired running job atomically.
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
        { status: "queued", scheduledAt: { lte: now } },
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
 * Claims the next available queued or expired job from the PostgreSQL queue.
 * Orders by priority DESC, scheduledAt ASC.
 */
export async function claimNextImportJob(
  leaseDurationMs = 60000
): Promise<{ claimed: boolean; leaseId?: string; job?: BatchImportJobState }> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
  const leaseId = randomUUID();

  // Find next eligible candidate
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

/**
 * Extends the lease of an actively running job.
 * Throws LeaseLostError if the lease was lost or expired.
 */
export async function heartbeatImportJob(
  jobId: string,
  leaseId: string,
  extensionMs = 60000
): Promise<void> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + extensionMs);

  const updated = await prisma.warehouseImportJob.updateMany({
    where: {
      id: jobId,
      leaseId,
      status: "running",
      leaseExpiresAt: { gte: now },
    },
    data: {
      heartbeatAt: now,
      leaseExpiresAt,
    },
  });

  if (updated.count === 0) {
    throw new LeaseLostError(jobId, leaseId);
  }
}

/**
 * Updates progress of an import job atomically under the active lease.
 * Throws LeaseLostError if the lease was lost.
 */
export async function updateImportJobProgress(
  jobId: string,
  leaseId: string,
  progress: {
    completedItems: number;
    approximateRows?: number;
    results?: BatchImportJobResult[];
  }
): Promise<BatchImportJobState> {
  const now = new Date();
  const data: any = {
    completedItems: progress.completedItems,
    heartbeatAt: now,
    updatedAt: now,
  };

  if (typeof progress.approximateRows === "number") {
    data.approximateRows = progress.approximateRows;
  }
  if (progress.results) {
    data.results = progress.results as any;
  }

  const updated = await prisma.warehouseImportJob.updateMany({
    where: {
      id: jobId,
      leaseId,
      status: "running",
      leaseExpiresAt: { gte: now },
    },
    data,
  });

  if (updated.count === 0) {
    throw new LeaseLostError(jobId, leaseId);
  }

  const job = await prisma.warehouseImportJob.findUnique({ where: { id: jobId } });
  if (!job) throw new LeaseLostError(jobId, leaseId);

  const state = toState(job);
  try {
    const redis = getRedis();
    await redis.set(`${JOB_KEY_PREFIX}${jobId}`, JSON.stringify(state), { ex: JOB_CACHE_TTL_SECONDS });
  } catch {}

  return state;
}

/**
 * Marks an import job as completed under the active lease.
 * Throws LeaseLostError if the lease was lost.
 */
export async function completeImportJob(
  jobId: string,
  leaseId: string,
  results: BatchImportJobResult[],
  approximateRows: number
): Promise<BatchImportJobState> {
  const now = new Date();

  const updated = await prisma.warehouseImportJob.updateMany({
    where: {
      id: jobId,
      leaseId,
      status: "running",
      leaseExpiresAt: { gte: now },
    },
    data: {
      status: "completed",
      results: results as any,
      completedItems: results.length,
      approximateRows,
      finishedAt: now,
      leaseId: null,
      leaseExpiresAt: null,
      updatedAt: now,
    },
  });

  if (updated.count === 0) {
    throw new LeaseLostError(jobId, leaseId);
  }

  const job = await prisma.warehouseImportJob.findUnique({ where: { id: jobId } });
  if (!job) throw new LeaseLostError(jobId, leaseId);

  const state = toState(job);
  try {
    const redis = getRedis();
    await redis.set(`${JOB_KEY_PREFIX}${jobId}`, JSON.stringify(state), { ex: JOB_CACHE_TTL_SECONDS });
  } catch {}

  return state;
}

/**
 * Fails a job with bounded exponential backoff or marks it permanently failed.
 * Throws LeaseLostError if the lease was lost.
 */
export async function failImportJob(
  jobId: string,
  leaseId: string,
  errorMsg: string
): Promise<BatchImportJobState> {
  const now = new Date();

  const current = await prisma.warehouseImportJob.findFirst({
    where: {
      id: jobId,
      leaseId,
      status: "running",
    },
    select: {
      retryCount: true,
      maxRetries: true,
    },
  });

  if (!current) {
    throw new LeaseLostError(jobId, leaseId);
  }

  const retryCount = current.retryCount;
  const maxRetries = current.maxRetries;

  if (retryCount < maxRetries) {
    const nextRetry = retryCount + 1;
    const delayMs = computeBackoffMs(retryCount);
    const scheduledAt = new Date(Date.now() + delayMs);

    logger.warn(`[failImportJob] Job ${jobId} failed, scheduled retry #${nextRetry} in ${Math.round(delayMs / 1000)}s`);

    const updated = await prisma.warehouseImportJob.updateMany({
      where: {
        id: jobId,
        leaseId,
        status: "running",
      },
      data: {
        status: "queued",
        retryCount: nextRetry,
        scheduledAt,
        startedAt: null,
        errorMsg,
        leaseId: null,
        leaseExpiresAt: null,
        heartbeatAt: now,
        updatedAt: now,
      },
    });

    if (updated.count === 0) throw new LeaseLostError(jobId, leaseId);
  } else {
    logger.error(`[failImportJob] Job ${jobId} failed permanently: ${errorMsg}`);

    const updated = await prisma.warehouseImportJob.updateMany({
      where: {
        id: jobId,
        leaseId,
        status: "running",
      },
      data: {
        status: "failed",
        finishedAt: now,
        errorMsg,
        leaseId: null,
        leaseExpiresAt: null,
        heartbeatAt: now,
        updatedAt: now,
      },
    });

    if (updated.count === 0) throw new LeaseLostError(jobId, leaseId);
  }

  const job = await prisma.warehouseImportJob.findUnique({ where: { id: jobId } });
  if (!job) throw new LeaseLostError(jobId, leaseId);

  const state = toState(job);
  try {
    const redis = getRedis();
    await redis.set(`${JOB_KEY_PREFIX}${jobId}`, JSON.stringify(state), { ex: JOB_CACHE_TTL_SECONDS });
  } catch {}

  return state;
}

/**
 * Retrieves a job state, strictly validating workspace access.
 */
export async function getImportJob(
  jobId: string,
  workspaceId: string
): Promise<BatchImportJobState | null> {
  const job = await prisma.warehouseImportJob.findUnique({
    where: { id: jobId },
  });

  if (!job || job.workspaceId !== workspaceId) {
    return null;
  }

  const state = toState(job);
  try {
    const redis = getRedis();
    await redis.set(`${JOB_KEY_PREFIX}${jobId}`, JSON.stringify(state), { ex: JOB_CACHE_TTL_SECONDS });
  } catch {}

  return state;
}
