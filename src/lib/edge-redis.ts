import { Redis } from "@upstash/redis/cloudflare";

export type EdgeRedisRuntimeEnv = {
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
};

/**
 * Build the fetch-based Redis client from Vercel's runtime environment.
 *
 * The Cloudflare entrypoint's `Redis.fromEnv()` reads a Cloudflare env object
 * or Cloudflare globals; it does not read Vercel's `process.env`. Passing the
 * validated values explicitly keeps the Edge client portable and fail-safe.
 */
export function createEdgeRedis(
  env: EdgeRedisRuntimeEnv = process.env as EdgeRedisRuntimeEnv,
): Redis | null {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  return new Redis({ url, token });
}

export type EdgeRedisClient = Redis;
