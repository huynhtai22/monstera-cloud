import { Ratelimit } from "@upstash/ratelimit";
// IMPORTANT: `middleware.ts` runs in the Edge Runtime. Force the fetch-based Redis client
// so Next.js does not bundle the Node.js entrypoint (`process.version` / `process.features`).
import { Redis } from "@upstash/redis/cloudflare";

/**
 * Global API rate limit (per-IP).
 *
 * Configure with:
 *  - UPSTASH_REDIS_REST_URL
 *  - UPSTASH_REDIS_REST_TOKEN
 */
export const apiRatelimit =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(60, "1 m"),
        analytics: true,
        prefix: "monstera:ratelimit:api",
      })
    : null;

