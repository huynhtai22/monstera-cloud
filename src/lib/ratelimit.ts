import { Ratelimit } from "@upstash/ratelimit";
import { createEdgeRedis } from "./edge-redis";

/**
 * Global API rate limit (per-IP).
 *
 * Configure with:
 *  - UPSTASH_REDIS_REST_URL
 *  - UPSTASH_REDIS_REST_TOKEN
 */
const redis = createEdgeRedis();

export const apiRatelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, "1 m"),
      analytics: true,
      prefix: "monstera:ratelimit:api",
    })
  : null;
