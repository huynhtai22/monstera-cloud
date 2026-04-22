/**
 * Distributed Mutex Locking - Flux Architecture Compliance (Section 3.2)
 *
 * Requirements:
 * - Acquire lock before token refresh
 * - 10-second lock timeout
 * - Worker B waits if Worker A is refreshing
 * - Redis-based distributed lock
 */

import { getRedis } from "./redis";

const LOCK_PREFIX = "mutex:";
const DEFAULT_LOCK_TTL = 10; // 10 seconds as per Flux spec
const LOCK_RETRY_DELAY = 100; // 100ms between retries
const MAX_RETRY_ATTEMPTS = 50; // 5 seconds total wait (50 * 100ms)

interface LockResult {
  release: () => Promise<void>;
}

/**
 * Acquire a distributed lock
 *
 * Flux: "Before initiating a Refresh Token flow, the worker MUST acquire a distributed lock"
 */
export async function acquireLock(
  lockKey: string,
  lockValue: string = generateLockValue(),
  ttlSeconds: number = DEFAULT_LOCK_TTL
): Promise<LockResult | null> {
  const redis = getRedis();
  const fullKey = `${LOCK_PREFIX}${lockKey}`;

  // Try to set key with NX (only if not exists) and EX (expiry)
  const acquired = await redis.set(fullKey, lockValue, "EX", ttlSeconds, "NX");

  if (acquired === "OK") {
    console.log(`[Mutex] Lock acquired: ${lockKey} (TTL: ${ttlSeconds}s)`);

    return {
      release: async () => {
        // Use Lua script to ensure we only delete if we own the lock
        const script = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        await redis.eval(script, 1, fullKey, lockValue);
        console.log(`[Mutex] Lock released: ${lockKey}`);
      },
    };
  }

  return null;
}

/**
 * Wait for and acquire lock with retry
 *
 * Flux: "Worker B fails to acquire the lock and enters a retry loop"
 */
export async function waitForLock(
  lockKey: string,
  lockValue: string = generateLockValue(),
  ttlSeconds: number = DEFAULT_LOCK_TTL,
  maxRetries: number = MAX_RETRY_ATTEMPTS
): Promise<LockResult> {
  let attempts = 0;

  while (attempts < maxRetries) {
    const lock = await acquireLock(lockKey, lockValue, ttlSeconds);

    if (lock) {
      return lock;
    }

    // Lock is held by another worker, wait and retry
    attempts++;
    console.log(`[Mutex] Lock busy: ${lockKey}, retry ${attempts}/${maxRetries}`);

    // Exponential backoff: 100ms, 200ms, 400ms, max 500ms
    const delay = Math.min(LOCK_RETRY_DELAY * Math.pow(2, attempts - 1), 500);
    await sleep(delay);
  }

  // Max retries reached, force acquire (stale lock scenario)
  console.warn(`[Mutex] Max retries reached, force acquiring: ${lockKey}`);
  const redis = getRedis();
  const fullKey = `${LOCK_PREFIX}${lockKey}`;

  // Delete potentially stale lock and acquire
  await redis.del(fullKey);
  const lock = await acquireLock(lockKey, lockValue, ttlSeconds);

  if (!lock) {
    throw new Error(`Failed to acquire lock after max retries: ${lockKey}`);
  }

  return lock;
}

/**
 * Execute function with mutex protection
 *
 * Usage: withMutex(`token:${connectionId}`, async () => { ... refresh token ... })
 */
export async function withMutex<T>(
  lockKey: string,
  fn: () => Promise<T>,
  options?: {
    ttlSeconds?: number;
    timeoutMs?: number;
  }
): Promise<T> {
  const lockValue = generateLockValue();
  const ttl = options?.ttlSeconds || DEFAULT_LOCK_TTL;

  // Wait for lock
  const lock = await waitForLock(lockKey, lockValue, ttl);

  try {
    // Execute protected function
    const result = await fn();
    return result;
  } finally {
    // Always release lock
    await lock.release();
  }
}

/**
 * Check if lock is currently held
 */
export async function isLocked(lockKey: string): Promise<boolean> {
  const redis = getRedis();
  const fullKey = `${LOCK_PREFIX}${lockKey}`;
  const ttl = await redis.ttl(fullKey);
  return ttl > 0;
}

/**
 * Get lock owner value (for debugging)
 */
export async function getLockOwner(lockKey: string): Promise<string | null> {
  const redis = getRedis();
  const fullKey = `${LOCK_PREFIX}${lockKey}`;
  return redis.get(fullKey);
}

/**
 * Force release a lock (emergency use only)
 */
export async function forceReleaseLock(lockKey: string): Promise<void> {
  const redis = getRedis();
  const fullKey = `${LOCK_PREFIX}${lockKey}`;
  await redis.del(fullKey);
  console.warn(`[Mutex] Force released: ${lockKey}`);
}

/**
 * Generate unique lock value (worker identifier)
 */
function generateLockValue(): string {
  return `${process.pid || "worker"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
