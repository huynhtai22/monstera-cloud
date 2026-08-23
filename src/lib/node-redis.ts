import { Redis as NodeRedis } from "@upstash/redis";
import { resolveRedisConfig, type RedisRuntimeEnv } from "./redis-config";

/** Construct the standard Node-runtime Upstash client from validated config. */
export function createNodeRedis(
  env: RedisRuntimeEnv = process.env as RedisRuntimeEnv,
): NodeRedis | null {
  const config = resolveRedisConfig(env);
  return config ? new NodeRedis(config) : null;
}

export type NodeRedisClient = NodeRedis;
