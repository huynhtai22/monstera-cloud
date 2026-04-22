/**
 * Distributed Mutex Locking - Flux Architecture Compliance (Section 3.2)
 *
 * Requirements:
 * - Acquire Redis lock before token refresh
 * - 10-second lock timeout
 * - Worker B waits/retry if Worker A is refreshing
 * - Prevent race conditions on token refresh
 */

import { getRedis } from "./redis";

const LOCK_PREFIX = "mutex:";
const DEFAULT_LOCK_TTL = 10000; // 10 seconds (Flux requirement)
const RETRY_DELAY_MS = 500; // Wait 500ms between retry attempts
const MAX_RETRIES = 20; // Max 10 seconds of retrying (20 * 500ms)

interface LockResult {
  release: () => Promise<void>;
  extend: (ttl: number) => Promise<void>;
}

/**
 * Generate lock key for a resource
 */
function buildLockKey(resourceId: string): string {
  return `${LOCK_PREFIX}${resourceId}`;
}

/**
 * Acquire distributed lock with retry logic
 *
 * Flux pattern: Worker MUST acquire lock before refresh
 */
export async function acquireLock(
  resourceId: string,
  options?: {
    ttl?: number; // Lock TTL in milliseconds (default 10s)
    retry?: boolean; // Whether to retry if lock is busy (default true)
    maxRetries?: number; // Max retry attempts
  }
): Promise<LockResult | null> {
  const redis = getRedis();
  const lockKey = buildLockKey(resourceId);
  const lockValue = `${process.pid}-${Date.now()}`; // Unique identifier

  const ttl = options?.ttl || DEFAULT_LOCK_TTL;
  const shouldRetry = options?.retry !== false;
  const maxRetries = options?.maxRetries || MAX_RETRIES;

  // Lua script for atomic lock acquisition (SET if not exists)
  const acquireScript = `
    if redis.call("exists", KEYS[1]) == 0 then
      redis.call("set", KEYS[1], ARGV[1], "PX", ARGV[2])
      return ARGV[1]
    else
      return nil
    end
  `;

  let attempts = 0;

  while (attempts <= maxRetries) {
    try {
      // Try to acquire lock atomically
      const result = await redis.eval(
        acquireScript,
        [lockKey],
        [lockValue, ttl.toString()]
      );

      if (result === lockValue) {
        console.log(`[Mutex] Lock acquired for ${resourceId} (attempt ${attempts + 1})`);

        // Return lock controls
        return {
          release: async () => {
            await releaseLock(resourceId, lockValue);
          },
          extend: async (newTtl: number) => {
            await extendLock(resourceId, lockValue, newTtl);
          },
        };
      }

      // Lock is held by another worker
      if (!shouldRetry) {
        console.log(`[Mutex] Lock busy for ${resourceId}, no retry`);
        return null;
      }

      // Wait before retry
      attempts++;
      if (attempts <= maxRetries) {
        console.log(`[Mutex] Lock busy for ${resourceId}, retry ${attempts}/${maxRetries}...`);
        await sleep(RETRY_DELAY_MS);
      }
    } catch (err) {
      console.error(`[Mutex] Error acquiring lock for ${resourceId}:`, err);
      return null;
    }
  }

  console.warn(`[Mutex] Failed to acquire lock for ${resourceId} after ${maxRetries} attempts`);
  return null;
}

/**
 * Release distributed lock (only if we own it)
 */
async function releaseLock(resourceId: string, lockValue: string): Promise<void> {
  const redis = getRedis();
  const lockKey = buildLockKey(resourceId);

  // Lua script for safe lock release (only if value matches)
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
      console.log(`[Mutex] Lock released for ${resourceId}`);
    } else {
      console.warn(`[Mutex] Lock already expired or stolen for ${resourceId}`);
    }
  } catch (err) {
    console.error(`[Mutex] Error releasing lock for ${resourceId}:`, err);
  }
}

/**
 * Extend lock TTL (only if we own it)
 */
async function extendLock(
  resourceId: string,
  lockValue: string,
  ttl: number
): Promise<void> {
  const redis = getRedis();
  const lockKey = buildLockKey(resourceId);

  // Lua script for safe lock extension
  const extendScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("pexpire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  try {
    const result = await redis.eval(extendScript, [lockKey], [lockValue, ttl.toString()]);
    if (result === 1) {
      console.log(`[Mutex] Lock extended for ${resourceId}`);
    }
  } catch (err) {
    console.error(`[Mutex] Error extending lock for ${resourceId}:`, err);
  }
}

/**
 * Execute function with distributed lock protection
 *
 * This is the main API - wraps any operation with mutex protection
 */
export async function withLock<T>(
  resourceId: string,
  operation: () => Promise<T>,
  options?: {
    ttl?: number;
    retry?: boolean;
    maxRetries?: number;
    onLockBusy?: () => void;
  }
): Promise<T | null> {
  const lock = await acquireLock(resourceId, options);

  if (!lock) {
    // Could not acquire lock
    options?.onLockBusy?.();
    return null;
  }

  try {
    // Execute the protected operation
    const result = await operation();
    return result;
  } finally {
    // Always release lock, even if operation fails
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
  } catch (err) {
    console.error(`[Mutex] Error checking lock for ${resourceId}:`, err);
    return false;
  }
}

/**
 * Get lock TTL remaining (for debugging)
 */
export async function getLockTTL(resourceId: string): Promise<number> {
  const redis = getRedis();
  const lockKey = buildLockKey(resourceId);

  try {
    const ttl = await redis.pttl(lockKey);
    return ttl; // milliseconds, -1 if no expiry, -2 if doesn't exist
  } catch (err) {
    console.error(`[Mutex] Error getting TTL for ${resourceId}:`, err);
    return -2;
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
    console.log(`[Mutex] Force unlocked ${resourceId}`);
  } catch (err) {
    console.error(`[Mutex] Error force unlocking ${resourceId}:`, err);
  }
}

/**
 * Utility: Sleep for milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Specialized: Token refresh lock
 * Follows Flux pattern for token refresh race condition prevention
 */
export async function withTokenRefreshLock<T>(
  connectionId: string,
  refreshOperation: () => Promise<T>,
  options?: {
    ttl?: number;
    maxRetries?: number;
  }
): Promise<T | null> {
  const lockId = `token-refresh:${connectionId}`;

  console.log(`[TokenRefresh] Attempting lock for ${connectionId}`);

  return withLock(
    lockId,
    async () => {
      console.log(`[TokenRefresh] Lock acquired, proceeding with refresh for ${connectionId}`);

      // Extend lock if refresh takes longer than default TTL
      const result = await refreshOperation();

      console.log(`[TokenRefresh] Completed for ${connectionId}`);
      return result;
    },
    {
      ttl: options?.ttl || 15000, // 15 seconds for token refresh (longer than default)
      retry: true,
      maxRetries: options?.maxRetries || 30, // More retries for token refresh
      onLockBusy: () => {
        console.log(`[TokenRefresh] Another worker is refreshing token for ${connectionId}, waiting...`);
      },
    }
  );
}
