import crypto from "crypto";
import { createNodeRedis, type NodeRedisClient } from "./node-redis";

function cacheHmacKey(): string {
  return process.env.ENCRYPTION_KEY?.trim()
    || process.env.NEXTAUTH_SECRET?.trim()
    || "local-dev-cache-key";
}

function cacheFingerprint(serialized: string): string {
  // Opaque Redis namespace fingerprint; authentication is enforced before cache access.
  return crypto.createHmac("sha256", cacheHmacKey()).update(serialized).digest("hex"); // lgtm[js/insufficient-password-hash]
}

/** Generate a deterministic keyed cache fingerprint. */
export function generateCacheKey(prefix: string, params: Record<string, any>): string {
  const serialized = JSON.stringify(params, Object.keys(params).sort());
  const hash = cacheFingerprint(serialized);
  return `${prefix}:${hash}`;
}

/**
 * Fetch a cached query result from Redis.
 */
export async function getCachedQuery<T>(
  key: string,
  redis: NodeRedisClient | null = createNodeRedis(),
): Promise<T | null> {
  if (!redis) return null;
  try {
    const data = await redis.get(key);
    if (!data) return null;
    return (typeof data === "string" ? JSON.parse(data) : data) as T;
  } catch (error) {
    console.error(`[Redis Cache Error] getCachedQuery failed for key ${key}:`, error);
    return null;
  }
}

/**
 * Store a query result in Redis with a TTL (in seconds).
 */
export async function setCachedQuery(
  key: string,
  data: any,
  ttlSeconds: number,
  redis: NodeRedisClient | null = createNodeRedis(),
): Promise<void> {
  if (!redis) return;
  try {
    const serialized = typeof data === "string" ? data : JSON.stringify(data);
    await redis.set(key, serialized, { ex: ttlSeconds });
  } catch (error) {
    console.error(`[Redis Cache Error] setCachedQuery failed for key ${key}:`, error);
  }
}

/**
 * Remove a cached query key from Redis.
 */
export async function invalidateCachedQuery(
  key: string,
  redis: NodeRedisClient | null = createNodeRedis(),
): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(key);
  } catch (error) {
    console.error(`[Redis Cache Error] invalidateCachedQuery failed for key ${key}:`, error);
  }
}

/**
 * Metrics-specific query cache key generator with workspace scoping and generation versioning.
 * Key format: metrics:query:${workspaceId}:v${generation}:${hash}
 */
export function generateMetricsQueryCacheKey(
  workspaceId: string,
  generation: number,
  params: Record<string, any>,
): string {
  const serialized = JSON.stringify(params, Object.keys(params).sort());
  const hash = cacheFingerprint(serialized);
  return `metrics:query:${workspaceId}:v${generation}:${hash}`;
}

/**
 * Fetch the current cache generation for a workspace. Defaults to 1 if unset or Redis fails.
 */
export async function getWorkspaceMetricsGeneration(
  workspaceId: string,
  redis: NodeRedisClient | null = createNodeRedis(),
): Promise<number> {
  if (!redis) return 1;
  try {
    const raw = await redis.get<number | string>(`metrics:gen:${workspaceId}`);
    if (raw === null || raw === undefined) return 1;
    const val = Number(raw);
    return Number.isFinite(val) && val > 0 ? val : 1;
  } catch (error) {
    console.error(`[Redis Cache Error] getWorkspaceMetricsGeneration failed for ${workspaceId}:`, error);
    return 1;
  }
}

/**
 * Invalidate query cache for a single workspace in O(1) by atomically incrementing its generation.
 * This avoids blocking KEYS scans, leaves other workspaces untouched, and allows prior keys
 * to expire via normal TTL cleanup.
 */
export async function invalidateWorkspaceMetricsCache(
  workspaceId: string,
  redis: NodeRedisClient | null = createNodeRedis(),
): Promise<void> {
  if (!redis) return;
  try {
    if (typeof (redis as any).incr === "function") {
      const next = await (redis as any).incr(`metrics:gen:${workspaceId}`);
      if (next === 1) {
        await (redis as any).incr(`metrics:gen:${workspaceId}`);
      }
    } else {
      const current = await getWorkspaceMetricsGeneration(workspaceId, redis);
      await redis.set(`metrics:gen:${workspaceId}`, current + 1);
    }
  } catch (error) {
    console.error(`[Redis Cache Error] invalidateWorkspaceMetricsCache failed for ${workspaceId}:`, error);
  }
}
