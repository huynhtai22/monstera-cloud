/**
 * Distributed Mutex Locking - Flux Architecture Compliance (Section 3.2)
 * 
 * Requirements:
 * - Acquire lock before token refresh
 * - 10-second lock timeout
 * - Workers that fail to acquire lock wait for lock release
 * - Prevents multiple workers refreshing same token simultaneously
 */

import { getRedis } from "./redis";

const LOCK_PREFIX = "lock:";
const DEFAULT_LOCK_TTL_SECONDS = 10; // 10 seconds as per Flux spec
const RETRY_DELAY_MS = 500; // 500ms between retry attempts
const MAX_RETRY_ATTEMPTS = 20; // 10 seconds total (20 * 500ms)

interface LockResult {
  release: () => Promise<void>;
  expiresAt: number;
}

/**
 * Generate lock key for a resource
 */
function buildLockKey(resourceId: string): string {
  return `${LOCK_PREFIX}${resourceId}`;
}

/**
 * Try to acquire a distributed lock
 * 
 * Returns null if lock is already held by another worker
 * Returns lock result with release function if acquired
 */
export async function tryAcquireLock(
  resourceId: string,
  ttlSeconds: number = DEFAULT_LOCK_TTL_SECONDS,
  workerId: string = generateWorkerId()
): Promise<LockResult | null> {
  const redis = getRedis();
  const lockKey = buildLockKey(resourceId);
  const lockValue = `${workerId}:${Date.now()}`;

  // Use SET NX (Not eXists) - atomic operation
  const acquired = await redis.setnx(lockKey, lockValue);

  if (acquired === 1) {
    // Lock acquired, set TTL
    await redis.expire(lockKey, ttlSeconds);
    const expiresAt = Date.now() + ttlSeconds * 1000;

    console.log(`[Lock] Acquired lock for ${resourceId} (worker: ${workerId})`);

    return {
      release: async () => {
        // Only delete if we still own the lock (check value matches)
        const current = await redis.get(lockKey);
        if (current === lockValue) {
          await redis.del(lockKey);
          console.log(`[Lock] Released lock for ${resourceId}`);
        }
      },
      expiresAt,
    };
  }

  // Lock already held
  const currentHolder = await redis.get(lockKey);
  console.log(`[Lock] Lock held by another worker for ${resourceId}: ${currentHolder}`);
  return null;
}

/**
 * Acquire lock with retry (blocking wait)
 * 
 * Flux requirement: Worker B fails to acquire lock and enters retry loop
 */
export async function acquireLockWithRetry(
  resourceId: string,
  ttlSeconds: number = DEFAULT_LOCK_TTL_SECONDS,
  maxRetries: number = MAX_RETRY_ATTEMPTS,
  workerId: string = generateWorkerId()
): Promise<LockResult> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const lock = await tryAcquireLock(resourceId, ttlSeconds, workerId);

    if (lock) {
      return lock;
    }

    // Wait before retry
    console.log(`[Lock] Retry ${attempt + 1}/${maxRetries} for ${resourceId}...`);
    await sleep(RETRY_DELAY_MS);
  }

  throw new Error(`[Lock] Failed to acquire lock for ${resourceId} after ${maxRetries} retries`);
}

/**
 * Execute function with distributed lock
 * 
 * Automatically acquires lock, runs function, releases lock
 */
export async function withLock<T>(
  resourceId: string,
  fn: () => Promise<T>,
  options?: {
    ttlSeconds?: number;
    maxRetries?: number;
    onLockFail?: () => void;
  }
): Promise<T | null> {
  const lock = await acquireLockWithRetry(
    resourceId,
    options?.ttlSeconds,
    options?.maxRetries
  );

  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

/**
 * Check if a lock is currently held (for monitoring/debugging)
 */
export async function isLocked(resourceId: string): Promise<boolean> {
  const redis = getRedis();
  const lockKey = buildLockKey(resourceId);
  const value = await redis.get(lockKey);
  return value !== null;
}

/**
 * Get lock holder info
 */
export async function getLockHolder(resourceId: string): Promise<string | null> {
  const redis = getRedis();
  const lockKey = buildLockKey(resourceId);
  return await redis.get(lockKey);
}

/**
 * Force release a lock (emergency use only)
 */
export async function forceReleaseLock(resourceId: string): Promise<void> {
  const redis = getRedis();
  const lockKey = buildLockKey(resourceId);
  await redis.del(lockKey);
  console.warn(`[Lock] Force released lock for ${resourceId}`);
}

/**
 * Generate unique worker ID
 */
function generateWorkerId(): string {
  // Combine timestamp, random, and process info if available
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  const hostname = typeof process !== "undefined" && process.env.VERCEL_REGION
    ? process.env.VERCEL_REGION
    : "local";
  return `${hostname}:${timestamp}:${random}`;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Token refresh with distributed locking
 * 
 * This is the main use case - prevents multiple workers refreshing same token
 */
export async function refreshTokenWithLock(
  connectionId: string,
  refreshFn: () => Promise<{ accessToken: string; expiresAt: Date }>,
  onRefreshed?: (token: { accessToken: string; expiresAt: Date }) => Promise<void>
): Promise<{ accessToken: string; expiresAt: Date } | null> {
  const lockResourceId = `refresh:${connectionId}`;

  return await withLock(
    lockResourceId,
    async () => {
      console.log(`[TokenRefresh] Acquired lock for ${connectionId}, refreshing...`);

      // Perform the actual refresh
      const token = await refreshFn();

      // Update cache/storage
      if (onRefreshed) {
        await onRefreshed(token);
      }

      console.log(`[TokenRefresh] Successfully refreshed token for ${connectionId}`);

      return token;
    },
    {
      ttlSeconds: 15, // Token refresh should complete within 15 seconds
      maxRetries: 30, // Wait up to 15 seconds for lock
      onLockFail: () => {
        console.error(`[TokenRefresh] Could not acquire lock for ${connectionId}`);
      },
    }
  );
}

/**
 * Multiple workers pattern - read from cache if another worker refreshed
 */
export async function getOrRefreshToken(
  connectionId: string,
  getCachedFn: () => Promise<{ accessToken: string; expiresAt: Date } | null>,
  refreshFn: () => Promise<{ accessToken: string; expiresAt: Date }>,
  onRefreshed?: (token: { accessToken: string; expiresAt: Date }) => Promise<void>
): Promise<{ accessToken: string; expiresAt: Date } | null> {
  // 1. Check if already refreshed by another worker
  let token = await getCachedFn();

  if (token && new Date(token.expiresAt).getTime() > Date.now() + 60000) {
    // Token valid for more than 1 minute, use it
    return token;
  }

  // 2. Token expired or expiring - need refresh with lock
  const lock = await tryAcquireLock(`refresh:${connectionId}`);

  if (!lock) {
    // Another worker is refreshing, wait and read from cache
    console.log(`[TokenRefresh] Another worker refreshing ${connectionId}, waiting...`);

    // Wait for other worker to complete (max 10 seconds)
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      token = await getCachedFn();
      if (token && new Date(token.expiresAt).getTime() > Date.now() + 60000) {
        return token;
      }
    }

    throw new Error(`Timeout waiting for token refresh for ${connectionId}`);
  }

  // 3. We acquired the lock, perform refresh
  try {
    token = await refreshFn();
    await onRefreshed?.(token);
    return token;
  } finally {
    await lock.release();
  }
}
