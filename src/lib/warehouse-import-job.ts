import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

export interface BatchImportItem {
  connectionId: string;
  adAccountId?: string;
}

export interface BatchImportJobResult {
  connectionId: string;
  provider: string;
  adAccountId?: string;
  ok: boolean;
  rowsIngested?: number;
  upserted?: number;
  error?: string;
}

export interface BatchImportJobState {
  id: string;
  workspaceId: string;
  userId: string;
  plan: string;
  since: string;
  until: string;
  items: BatchImportItem[];
  totalItems: number;
  completedItems: number;
  approximateRows: number;
  status: "queued" | "running" | "completed" | "failed";
  retryCount: number;
  maxRetries: number;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  leaseId: string | null;
  leaseExpiresAt: string | null;
  priority: number;
  idempotencyKey: string | null;
  results: BatchImportJobResult[];
  errorMsg: string | null;
  createdAt: string;
  updatedAt: string;
}

export class LeaseLostError extends Error {
  constructor(jobId: string, leaseId: string) {
    super(`Lease ${leaseId} for job ${jobId} was lost, expired, or claimed by another worker.`);
    this.name = "LeaseLostError";
  }
}

const JOB_KEY_PREFIX = "warehouse_job:";
const JOB_CACHE_TTL_SECONDS = 86400; // 24 hours

/**
 * Calculates exponential backoff delay in ms with bounded jitter.
 * Base 5s -> 20s -> 60s -> max 120s
 */
export function computeBackoffMs(retryCount: number): number {
  const delays = [5000, 20000, 60000, 120000];
  const idx = Math.min(retryCount, delays.length - 1);
  const baseDelay = delays[idx];
  const jitter = Math.floor(Math.random() * (baseDelay * 0.2));
  return baseDelay + jitter;
}

function toState(record: any): BatchImportJobState {
  const scheduledAt = record.scheduledAt ? new Date(record.scheduledAt).toISOString() : new Date().toISOString();
  const createdAt = record.createdAt ? new Date(record.createdAt).toISOString() : new Date().toISOString();
  const updatedAt = record.updatedAt ? new Date(record.updatedAt).toISOString() : new Date().toISOString();

  return {
    id: record.id,
    workspaceId: record.workspaceId,
    userId: record.userId,
    plan: record.plan,
    since: record.since,
    until: record.until,
    items: (record.items as unknown as BatchImportItem[]) || [],
    totalItems: record.totalItems ?? (record.items?.length || 0),
    completedItems: record.completedItems ?? 0,
    approximateRows: record.approximateRows ?? 0,
    status: record.status,
    retryCount: record.retryCount ?? 0,
    maxRetries: record.maxRetries ?? 3,
    scheduledAt,
    startedAt: record.startedAt ? new Date(record.startedAt).toISOString() : null,
    finishedAt: record.finishedAt ? new Date(record.finishedAt).toISOString() : null,
    heartbeatAt: record.heartbeatAt ? new Date(record.heartbeatAt).toISOString() : null,
    leaseId: record.leaseId ?? null,
    leaseExpiresAt: record.leaseExpiresAt ? new Date(record.leaseExpiresAt).toISOString() : null,
    priority: record.priority ?? 1,
    idempotencyKey: record.idempotencyKey ?? null,
    results: (record.results as unknown as BatchImportJobResult[]) || [],
    errorMsg: record.errorMsg ?? null,
    createdAt,
    updatedAt,
  };
}

/**
 * Creates and persists a new warehouse import job with scoped idempotency.
 */
export async function createImportJob(params: {
  workspaceId: string;
  userId: string;
  plan?: string;
  since: string;
  until: string;
  items: BatchImportItem[];
  idempotencyKey?: string;
  priority?: number;
  id?: string;
}): Promise<BatchImportJobState> {
  const jobId = params.id || `wjob_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date();

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
        scheduledAt: now,
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
 * Default lease duration is 60 seconds (60000ms).
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
 * Default lease duration is 60 seconds (60000ms).
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
 * Requires unexpired lease (leaseExpiresAt >= now).
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
 * Updates progress of an import job atomically under the active unexpired lease.
 * Throws LeaseLostError if the lease was lost or expired.
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
 * Marks an import job as completed under the active unexpired lease.
 * Throws LeaseLostError if the lease was lost or expired.
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
 * Atomically verifies active unexpired lease (leaseExpiresAt >= now) on both read and update.
 * Throws LeaseLostError if the lease was lost or expired.
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
      leaseExpiresAt: { gte: now },
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
        leaseExpiresAt: { gte: now },
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

    if (updated.count === 0) {
      throw new LeaseLostError(jobId, leaseId);
    }
  } else {
    logger.error(`[failImportJob] Job ${jobId} failed permanently: ${errorMsg}`);

    const updated = await prisma.warehouseImportJob.updateMany({
      where: {
        id: jobId,
        leaseId,
        status: "running",
        leaseExpiresAt: { gte: now },
      },
      data: {
        status: "failed",
        errorMsg,
        finishedAt: now,
        leaseId: null,
        leaseExpiresAt: null,
        heartbeatAt: now,
        updatedAt: now,
      },
    });

    if (updated.count === 0) {
      throw new LeaseLostError(jobId, leaseId);
    }
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
 * Retrieves the current state of an import job by ID and workspaceId.
 * Enforces workspace boundary.
 */
export async function getImportJob(
  jobId: string,
  workspaceId: string
): Promise<BatchImportJobState | null> {
  const job = await prisma.warehouseImportJob.findFirst({
    where: {
      id: jobId,
      workspaceId,
    },
  });

  if (!job) return null;
  return toState(job);
}
