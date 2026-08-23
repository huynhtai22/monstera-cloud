import { Redis as EdgeRedis } from "@upstash/redis/cloudflare";
import { resolveRedisConfig, type RedisRuntimeEnv } from "./redis-config";

/**
 * Build the fetch-based Redis client from Vercel's runtime environment.
 *
 * The Cloudflare entrypoint's environment resolver reads a Cloudflare env object
 * or Cloudflare globals; it does not read Vercel's `process.env`. Passing the
 * validated values explicitly keeps the Edge client portable and fail-safe.
 */
export function createEdgeRedis(
  env: RedisRuntimeEnv = process.env as RedisRuntimeEnv,
): EdgeRedis | null {
  const config = resolveRedisConfig(env);
  return config ? new EdgeRedis(config) : null;
}

export type EdgeRedisClient = EdgeRedis;
