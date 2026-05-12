import { Redis } from "@upstash/redis/cloudflare";
import crypto from "crypto";

// Use edge-friendly import for Redis, falling back to null if disabled
export const redisCacheClient =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

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
export async function getCachedQuery<T>(key: string): Promise<T | null> {
  if (!redisCacheClient) return null;
  try {
    const data = await redisCacheClient.get(key);
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
export async function setCachedQuery(key: string, data: any, ttlSeconds: number): Promise<void> {
  if (!redisCacheClient) return;
  try {
    const serialized = typeof data === "string" ? data : JSON.stringify(data);
    await redisCacheClient.set(key, serialized, { ex: ttlSeconds });
  } catch (error) {
    console.error(`[Redis Cache Error] setCachedQuery failed for key ${key}:`, error);
  }
}
