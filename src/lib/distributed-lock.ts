/**
 * Distributed Mutex Locking - Flux Architecture Compliance (Section 3.2)
 * Unified Implementation with Pub/Sub Coordination
 * 
 * Requirements:
 * - Acquire Redis lock before token refresh
 * - 10-second lock timeout
 * - Worker B waits via Pub/Sub instead of polling if Worker A is refreshing
 * - Prevent race conditions on token refresh
 */

import { getRedis } from "./redis";
import { logger } from "@/lib/logger";

const LOCK_PREFIX = "mutex:";
const LOCK_RELEASE_CHANNEL = "lock_released";
const DEFAULT_LOCK_TTL = 10000; // 10 seconds
const MAX_WAIT_MS = 15000; // Maximum time a worker will wait for pub/sub before timeout

export interface LockResult {
  release: () => Promise<void>;
  extend: (ttl: number) => Promise<void>;
  expiresAt: number;
}

/**
 * Generate lock key for a resource
 */
function buildLockKey(resourceId: string): string {
  return `${LOCK_PREFIX}${resourceId}`;
}

/**
 * Try to acquire a lock atomically
 */
export async function tryAcquireLock(
  resourceId: string,
  ttlMs: number = DEFAULT_LOCK_TTL
): Promise<LockResult | null> {
  const redis = getRedis();
  const lockKey = buildLockKey(resourceId);
  const lockValue = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Lua script for atomic lock acquisition (SET if not exists)
  const acquireScript = `
    if redis.call("exists", KEYS[1]) == 0 then
      redis.call("set", KEYS[1], ARGV[1], "PX", ARGV[2])
      return ARGV[1]
    else
      return nil
    end
  `;

  try {
    const result = await redis.eval(
      acquireScript,
      [lockKey],
      [lockValue, ttlMs.toString()]
    );

    if (result === lockValue) {
      const expiresAt = Date.now() + ttlMs;
      logger.info(`[Lock] Acquired lock for ${resourceId}`);

      return {
        release: async () => {
          await releaseLock(resourceId, lockValue);
        },
        extend: async (newTtlMs: number) => {
          await extendLock(resourceId, lockValue, newTtlMs);
        },
        expiresAt,
      };
    }
  } catch (err) {
    logger.error(`[Lock] Error acquiring lock for ${resourceId}:`, err);
  }

  return null;
}

/**
 * Release distributed lock (only if we own it) and notify via Pub/Sub
 */
async function releaseLock(resourceId: string, lockValue: string): Promise<void> {
  const redis = getRedis();
  const lockKey = buildLockKey(resourceId);

  const releaseScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  try {
    const result = await redis.eval(releaseScript, [lockKey], [lockValue]);
    if (result === 1) {
      logger.info(`[Lock] Released lock for ${resourceId}`);
      // Notify waiting workers that this specific resource lock was released
      await redis.publish(LOCK_RELEASE_CHANNEL, resourceId);
    } else {
      logger.warn(`[Lock] Lock already expired or stolen for ${resourceId}`);
    }
  } catch (err) {
    logger.error(`[Lock] Error releasing lock for ${resourceId}:`, err);
  }
}

/**
 * Extend lock TTL (only if we own it)
 */
async function extendLock(resourceId: string, lockValue: string, ttlMs: number): Promise<void> {
  const redis = getRedis();
  const lockKey = buildLockKey(resourceId);

  const extendScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("pexpire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  try {
    const result = await redis.eval(extendScript, [lockKey], [lockValue, ttlMs.toString()]);
    if (result === 1) {
      logger.info(`[Lock] Extended lock for ${resourceId} by ${ttlMs}ms`);
    }
  } catch (err) {
    logger.error(`[Lock] Error extending lock for ${resourceId}:`, err);
  }
}

/**
 * Acquire distributed lock with Pub/Sub waiting mechanism
 */
export async function acquireLock(
  resourceId: string,
  options?: {
    ttl?: number;
    retry?: boolean;
    maxWaitMs?: number;
  }
): Promise<LockResult | null> {
  const redis = getRedis();
  const ttl = options?.ttl || DEFAULT_LOCK_TTL;
  const shouldRetry = options?.retry !== false;
  const maxWait = options?.maxWaitMs || MAX_WAIT_MS;

  // Try immediately first
  let lock = await tryAcquireLock(resourceId, ttl);
  if (lock) return lock;

  if (!shouldRetry) {
    logger.info(`[Lock] Lock busy for ${resourceId}, no retry`);
    return null;
  }

  logger.info(`[Lock] Lock busy for ${resourceId}, waiting via Pub/Sub...`);

  // Wait via Pub/Sub
  return new Promise(async (resolve) => {
    let handled = false;
    let fallbackTimer: NodeJS.Timeout;

    // Upstash/VercelKV doesn't strictly support open connections for SUBSCRIBE in serverless
    // but we use the provided client. If the environment supports it (like a long running worker
    // or properly mocked client), this avoids polling.
    const messageHandler = async (channel: string, message: string) => {
      // Redis subscribe callbacks sometimes have different signatures based on the client,
      // handled flexibly below.
      const msg = typeof message === 'string' ? message : channel;
      
      if (msg === resourceId && !handled) {
        logger.info(`[Lock] Pub/Sub notified release for ${resourceId}, retrying...`);
        // Try to acquire again
        const retryLock = await tryAcquireLock(resourceId, ttl);
        if (retryLock) {
          cleanup();
          resolve(retryLock);
        }
      }
    };

    const cleanup = () => {
      if (handled) return;
      handled = true;
      clearTimeout(fallbackTimer);
      try {
        // Standard unsubscribe if available
        if (typeof redis.unsubscribe === 'function') {
           redis.unsubscribe(LOCK_RELEASE_CHANNEL, messageHandler).catch(() => {});
        }
      } catch {
        // ignore unsubscribe errors
      }
    };

    // Set a maximum wait time timeout, after which we give up or force a final check
    fallbackTimer = setTimeout(async () => {
      if (!handled) {
        logger.info(`[Lock] Wait timeout for ${resourceId}, giving up.`);
        cleanup();
        resolve(null);
      }
    }, maxWait);

    try {
      if (typeof redis.subscribe === 'function') {
        await redis.subscribe(LOCK_RELEASE_CHANNEL, messageHandler);
      } else {
         // Fallback to polling if client does not support subscribe
         logger.warn("[Lock] Redis client does not support subscribe: falling back to polling");
         fallbackPoll();
      }
    } catch (err) {
      logger.error("[Lock] Pub/sub failed, falling back to polling", err);
      fallbackPoll();
    }

    // Polling fallback just in case pub/sub fails conceptually in this environment
    async function fallbackPoll() {
      const start = Date.now();
      while (!handled && (Date.now() - start < maxWait)) {
         await new Promise(r => setTimeout(r, 1000));
         if (handled) break;
         const retryLock = await tryAcquireLock(resourceId, ttl);
         if (retryLock) {
            cleanup();
            resolve(retryLock);
            break;
         }
      }
    }
  });
}

/**
 * Execute function with distributed lock protection
 */
export async function withLock<T>(
  resourceId: string,
  operation: () => Promise<T>,
  options?: {
    ttl?: number;
    retry?: boolean;
    maxWaitMs?: number;
    onLockBusy?: () => void;
  }
): Promise<T | null> {
  const lock = await acquireLock(resourceId, options);

  if (!lock) {
    options?.onLockBusy?.();
    return null;
  }

  try {
    return await operation();
  } finally {
    await lock.release();
  }
}

/**
 * Check if a lock is currently held (for monitoring)
 */
export async function isLocked(resourceId: string): Promise<boolean> {
  const redis = getRedis();
  const lockKey = buildLockKey(resourceId);

  try {
    const exists = await redis.exists(lockKey);
    return exists === 1;
  } catch {
    return false;
  }
}

/**
 * Force unlock (use with caution - only for admin/debug)
 */
export async function forceUnlock(resourceId: string): Promise<void> {
  const redis = getRedis();
  const lockKey = buildLockKey(resourceId);

  try {
    await redis.del(lockKey);
    await redis.publish(LOCK_RELEASE_CHANNEL, resourceId);
    logger.info(`[Lock] Force unlocked ${resourceId}`);
  } catch (err) {
    logger.warn(`[Lock] Failed to force unlock ${resourceId}`, err);
  }
}

/**
 * Specialized: Token refresh lock
 * Prevents multiple workers refreshing same token simultaneously
 */
export async function withTokenRefreshLock<T>(
  connectionId: string,
  refreshOperation: () => Promise<T>,
  options?: {
    ttl?: number;
    maxWaitMs?: number;
  }
): Promise<T | null> {
  const lockId = `token-refresh:${connectionId}`;

  return withLock(
    lockId,
    async () => {
      logger.info(`[TokenRefresh] Proceeding with refresh for ${connectionId}`);
      const result = await refreshOperation();
      logger.info(`[TokenRefresh] Completed for ${connectionId}`);
      return result;
    },
    {
      ttl: options?.ttl || 15000,
      retry: true,
      maxWaitMs: options?.maxWaitMs || 20000, 
      onLockBusy: () => {
        logger.warn(`[TokenRefresh] Could not acquire lock or wait failed for ${connectionId}`);
      },
    }
  );
}
