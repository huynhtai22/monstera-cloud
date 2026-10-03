import { Ratelimit } from "@upstash/ratelimit";
import { shouldSuppressIntegrationsForIsolatedE2e, type EnvMap } from "./e2e-env-guard";
import { createNodeRedis } from "./node-redis";

type LocalBucket = { count: number; resetsAt: number };
const globalBuckets = globalThis as typeof globalThis & { __monsteraAuthBuckets?: Map<string, LocalBucket> };
const localBuckets = globalBuckets.__monsteraAuthBuckets ?? new Map<string, LocalBucket>();
globalBuckets.__monsteraAuthBuckets = localBuckets;

export function resetAuthRateLimitBucketsForTest(): void {
  localBuckets.clear();
}

function isIsolatedE2eEnvironment(env: EnvMap): boolean {
  try {
    return shouldSuppressIntegrationsForIsolatedE2e(env);
  } catch {
    return false;
  }
}

function resolveAttemptLimit(inputLimit: number, env: EnvMap): number {
  if (isIsolatedE2eEnvironment(env)) {
    // In isolated E2E suites, multiple test journeys execute against the single
    // Next.js server instance. Rate limiting remains strictly active and bounded,
    // but elevated to accommodate the multi-spec test matrix.
    return Math.max(inputLimit, 250);
  }
  return inputLimit;
}

function requestIp(request: Request): string {
  const headers = request.headers as Headers & Record<string, string | string[] | undefined>;
  const forwarded = typeof headers.get === "function"
    ? headers.get("x-forwarded-for")
    : headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(",")[0]?.trim() || "unknown";
}

export async function allowAuthAttempt(
  input: {
    request: Request;
    action: string;
    identity?: string;
    limit: number;
    windowSeconds: number;
  },
  env: EnvMap = process.env,
): Promise<boolean> {
  const limit = resolveAttemptLimit(input.limit, env);
  const key = `${input.action}:${requestIp(input.request)}:${input.identity?.trim().toLowerCase() || "anonymous"}`;
  const redis = createNodeRedis();
  if (redis) {
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${input.windowSeconds} s`),
      prefix: "monstera:auth",
      analytics: false,
    });
    return (await limiter.limit(key)).success;
  }

  const now = Date.now();
  const current = localBuckets.get(key);
  if (!current || current.resetsAt <= now) {
    localBuckets.set(key, { count: 1, resetsAt: now + input.windowSeconds * 1000 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}
