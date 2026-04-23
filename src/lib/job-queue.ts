/**
 * Background Job Queue Abstraction
 * Uses Redis Lists/Sets to durably queue and process ETL and background jobs
 */

import { getRedis } from "./redis";

const QUEUE_PREFIX = "queue:";
const ACTIVE_PREFIX = "queue_active:";

export interface JobPayload {
  id: string;
  type: string;
  data: any;
  createdAt: number;
}

/**
 * Enqueue a new background job
 */
export async function enqueueJob(type: string, data: any): Promise<string> {
  const redis = getRedis();
  const queueKey = `${QUEUE_PREFIX}${type}`;
  
  const job: JobPayload = {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    data,
    createdAt: Date.now()
  };

  // Push to left of the list (LPUSH)
  await redis.lpush(queueKey, JSON.stringify(job));
  console.log(`[JobQueue] Enqueued job ${job.id} for type: ${type}`);
  
  return job.id;
}

/**
 * Pop a job from the queue (for workers to call)
 * Non-blocking in serverless functions, normally workers would use BRPOP 
 * but standard RPOP is used here to match Vercel KV capabilities.
 */
export async function dequeueJob(type: string): Promise<JobPayload | null> {
  const redis = getRedis();
  const queueKey = `${QUEUE_PREFIX}${type}`;
  
  // Right pop from the queue
  const result = await redis.rpop(queueKey);
  
  if (!result) {
    return null;
  }
  
  try {
    const job: JobPayload = typeof result === 'string' ? JSON.parse(result) : result;
    
    // Add to active set so we could theoretically recover it if worker crashes
    const activeKey = `${ACTIVE_PREFIX}${type}`;
    await redis.sadd(activeKey, JSON.stringify(job));
    
    return job;
  } catch (err) {
    console.error(`[JobQueue] Error parsing job payload for ${type}`, err);
    return null;
  }
}

/**
 * Acknowledge a job as completed
 */
export async function completeJob(job: JobPayload): Promise<void> {
  const redis = getRedis();
  const activeKey = `${ACTIVE_PREFIX}${job.type}`;
  
  await redis.srem(activeKey, JSON.stringify(job));
  console.log(`[JobQueue] Completed job ${job.id}`);
}

/**
 * Process all items currently in a queue (useful for cron jobs picking up queues)
 */
export async function processQueue(
  type: string, 
  handler: (job: JobPayload) => Promise<void>,
  batchSize: number = 50
): Promise<{ processed: number, failed: number }> {
  let processed = 0;
  let failed = 0;
  
  for (let i = 0; i < batchSize; i++) {
    const job = await dequeueJob(type);
    if (!job) break; // Queue is empty
    
    try {
      await handler(job);
      await completeJob(job);
      processed++;
    } catch (err) {
      console.error(`[JobQueue] Failed processing job ${job.id}:`, err);
      failed++;
      // A full implementation would move this to a DLQ (Dead Letter Queue)
    }
  }
  
  if (processed > 0 || failed > 0) {
    console.log(`[JobQueue] Processed ${processed} jobs, ${failed} failed for type: ${type}`);
  }
  
  return { processed, failed };
}
