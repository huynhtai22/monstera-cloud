import crypto from "crypto";
import { createNodeRedis, type NodeRedisClient } from "./node-redis";

/**
 * Generate a deterministic SHA-256 cache key from a prefix and any serializable parameters.
 */
export function generateCacheKey(prefix: string, params: Record<string, any>): string {
  const serialized = JSON.stringify(params, Object.keys(params).sort());
  const hash = crypto.createHash("sha256").update(serialized).digest("hex");
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
