/**
 * Enterprise Queue Management Service
 * Supports High-Priority (Webhooks) and Low-Priority (Batch Syncs) queues,
 * retry mechanisms with exponential backoff, and Dead Letter Queue (DLQ) offloading.
 */

import { getRedis } from "./redis";
import { logger } from "@/lib/logger";

const QUEUE_PREFIX = "mq:";
const ACTIVE_PREFIX = "mq_active:";
const DLQ_KEY = "mq_dlq:failed_jobs";

export interface QueueJob {
  id: string;
  type: string;
  data: any;
  priority: "high" | "low";
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  lastError?: string;
}

/**
 * Enqueue a job into the high-priority or low-priority queue
 */
export async function enqueueJob(
  type: string,
  data: any,
  priority: "high" | "low" = "low",
  maxRetries: number = 5
): Promise<string> {
  const redis = getRedis();
  const queueName = priority === "high" ? "high-priority-webhook-queue" : "low-priority-sync-queue";
  const queueKey = `${QUEUE_PREFIX}${queueName}`;

  const job: QueueJob = {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    data,
    priority,
    retryCount: 0,
    maxRetries,
    createdAt: Date.now(),
  };

  // Push to left of the queue (LPUSH)
  await redis.lpush(queueKey, JSON.stringify(job));
  logger.info(`[QueueService] [${priority.toUpperCase()}] Enqueued job ${job.id} for type: ${type}`);

  return job.id;
}

/**
 * Dequeue a job from the high-priority queue first, falling back to low-priority
 */
export async function dequeueJob(): Promise<QueueJob | null> {
  const redis = getRedis();
  const highPriorityKey = `${QUEUE_PREFIX}high-priority-webhook-queue`;
  const lowPriorityKey = `${QUEUE_PREFIX}low-priority-sync-queue`;

  // 1. Drain High Priority (Webhooks) first
  let rawJob = await redis.rpop(highPriorityKey);
  let selectedPriority: "high" | "low" = "high";

  // 2. Fall back to Low Priority (Syncs)
  if (!rawJob) {
    rawJob = await redis.rpop(lowPriorityKey);
    selectedPriority = "low";
  }

  if (!rawJob) {
    return null;
  }

  try {
    const job: QueueJob = typeof rawJob === "string" ? JSON.parse(rawJob) : rawJob;

    // Track active processing
    const activeKey = `${ACTIVE_PREFIX}${selectedPriority}`;
    await redis.sadd(activeKey, JSON.stringify(job));

    return job;
  } catch (err) {
    logger.error(`[QueueService] Error parsing job payload`, err);
    return null;
  }
}

/**
 * Acknowledge a job as successfully completed
 */
export async function completeJob(job: QueueJob): Promise<void> {
  const redis = getRedis();
  const activeKey = `${ACTIVE_PREFIX}${job.priority}`;

  await redis.srem(activeKey, JSON.stringify(job));
  logger.info(`[QueueService] Successfully acknowledged job ${job.id}`);
}

/**
 * Handle a job execution failure: retry with backoff or move to DLQ
 */
export async function handleJobFailure(job: QueueJob, error: any): Promise<void> {
  const redis = getRedis();
  
  // Remove from active list
  const activeKey = `${ACTIVE_PREFIX}${job.priority}`;
  await redis.srem(activeKey, JSON.stringify(job));

  const errorMessage = error instanceof Error ? error.message : String(error);
  job.lastError = errorMessage;
  job.retryCount += 1;

  if (job.retryCount >= job.maxRetries) {
    // Retries exhausted -> Move to Dead Letter Queue (DLQ)
    logger.error(`[QueueService] Job ${job.id} exhausted all ${job.maxRetries} retries. Moving to DLQ. Error: ${errorMessage}`);
    await redis.lpush(DLQ_KEY, JSON.stringify({
      ...job,
      failedAt: Date.now()
    }));
    return;
  }

  // Calculate exponential backoff duration (2^retryCount * 1000ms) with jitter
  const baseDelay = Math.pow(2, job.retryCount) * 1000;
  const jitter = Math.random() * 1000;
  const delayMs = Math.round(baseDelay + jitter);

  logger.warn(`[QueueService] Job ${job.id} failed (${job.retryCount}/${job.maxRetries}). Retrying in ${delayMs}ms. Error: ${errorMessage}`);

  // Re-enqueue after delay. In standard serverless, we schedule the re-enqueue.
  // For Redis fallback, we re-enqueue back to the queue.
  setTimeout(async () => {
    try {
      const queueKey = `${QUEUE_PREFIX}${job.priority === "high" ? "high-priority-webhook-queue" : "low-priority-sync-queue"}`;
      await redis.lpush(queueKey, JSON.stringify(job));
    } catch (err) {
      logger.error(`[QueueService] Failed to re-enqueue job ${job.id} during retry backoff:`, err);
    }
  }, delayMs);
}

/**
 * Run a processing loop for the queue handlers
 */
export async function processNextJob(
  handlers: Record<string, (data: any) => Promise<void>>
): Promise<boolean> {
  const job = await dequeueJob();
  if (!job) return false;

  const handler = handlers[job.type];
  if (!handler) {
    const error = new Error(`No registered handler for job type: ${job.type}`);
    await handleJobFailure(job, error);
    return true;
  }

  try {
    await handler(job.data);
    await completeJob(job);
  } catch (err) {
    await handleJobFailure(job, err);
  }

  return true;
}
