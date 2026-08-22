/**
 * Route-class rate-limit policy for the edge proxy (src/proxy.ts).
 *
 * Design goals:
 * - No ad-hoc lists hidden in middleware: route classes, limits, identity
 *   tiers, and failure policies are declared here, documented, and testable.
 * - Identity tiers: use the strongest stable identity available per surface —
 *   a SHA-256 fingerprint of the bearer credential for external data routes,
 *   provider/IP as the coarse fallback elsewhere. Raw tokens are never logged
 *   or stored; only the hash prefix is used as the limiter key.
 * - Failure policy is explicit per class so an Upstash outage never becomes a
 *   total-site outage and never silently disables protection on sensitive
 *   surfaces:
 *
 *   | class            | limiter available        | Upstash error / not configured                     |
 *   |------------------|--------------------------|----------------------------------------------------|
 *   | internal-api     | 429 on limit exceeded    | fail open + warn log (availability first)          |
 *   | credential       | 429                      | fail open + warn log (handlers enforce per-account)|
 *   | webhook          | 429                      | bounded in-process fallback window (never unlim.)  |
 *   | external-sheets  | 429                      | production: fail closed 503 · dev/test: fallback   |
 *   | external-addon   | 429                      | same as external-sheets                            |
 *   | external-looker  | 429                      | same as external-sheets                            |
 *
 * All responses are structured JSON with `Retry-After` and `X-RateLimit-*`
 * metadata. Browser page authentication does NOT go through this module at
 * all (session JWT verification has no Upstash dependency).
 */

import { Ratelimit } from "@upstash/ratelimit";
// Edge runtime: force the fetch-based Redis client so Next.js does not bundle
// the Node.js entrypoint (mirrors src/lib/ratelimit.ts).
import { Redis } from "@upstash/redis/cloudflare";

export type RateLimitRouteClass =
  | "internal-api"
  | "credential"
  | "webhook"
  | "external-sheets"
  | "external-addon"
  | "external-looker";

export type RateLimitDecision = {
  success: boolean;
  limit?: number;
  remaining?: number;
  reset?: number;
};

/** Minimal interface so tests can inject fake limiters without network access. */
export type SharedLimiter = {
  limit(key: string): Promise<RateLimitDecision>;
};

type ClassPolicy = {
  /** Requests allowed per identity per windowSeconds. */
  limit: number;
  windowSeconds: number;
  /** Distinct Redis key prefix per class. */
  prefix: string;
  /** Behavior when the shared limiter cannot be reached or is not configured. */
  onFailure: "fail-open" | "fail-closed-in-production" | "bounded-fallback";
};

export const ROUTE_CLASS_POLICIES: Record<RateLimitRouteClass, ClassPolicy> = {
  // Session/API-key app traffic. Preserves today's global 60/min per-IP behavior.
  "internal-api": { limit: 60, windowSeconds: 60, prefix: "monstera:ratelimit:api", onFailure: "fail-open" },
  // Password reset / registration / OTP outer guard. Handlers additionally
  // enforce stricter per-account limits via allowAuthAttempt().
  credential: { limit: 20, windowSeconds: 60, prefix: "monstera:ratelimit:credential", onFailure: "fail-open" },
  // Signed provider webhooks. Generous (providers burst from few IPs) but the
  // in-process bounded fallback guarantees there is NEVER an unlimited path.
  webhook: { limit: 600, windowSeconds: 60, prefix: "monstera:ratelimit:webhook", onFailure: "bounded-fallback" },
  // Sheets add-on JSON API (Google ID-token authenticated warehouse reads).
  "external-sheets": { limit: 120, windowSeconds: 60, prefix: "monstera:ratelimit:sheets", onFailure: "fail-closed-in-production" },
  // Add-on auth/accounts routes (same client surface as sheets).
  "external-addon": { limit: 120, windowSeconds: 60, prefix: "monstera:ratelimit:addon", onFailure: "fail-closed-in-production" },
  // Looker Studio connector (API-key / Google ID-token authenticated reads).
  "external-looker": { limit: 60, windowSeconds: 60, prefix: "monstera:ratelimit:looker", onFailure: "fail-closed-in-production" },
};

const CREDENTIAL_PATHS = new Set([
  "/api/auth/forgot-password",
  "/api/auth/register",
  "/api/auth/resend-otp",
  "/api/auth/reset-password",
  "/api/auth/verify",
]);

/** Classify an API pathname. Returns null for non-API paths. */
export function classifyApiRoute(pathname: string): RateLimitRouteClass | null {
  if (!pathname.startsWith("/api/")) return null;
  if (pathname.startsWith("/api/v1/sheets")) return "external-sheets";
  if (pathname === "/api/addon" || pathname.startsWith("/api/addon/")) return "external-addon";
  if (pathname.startsWith("/api/looker-studio")) return "external-looker";
  if (
    pathname.startsWith("/api/webhooks/") ||
    pathname === "/api/stripe/webhook" ||
    pathname === "/api/xendit/webhook"
  ) {
    return "webhook";
  }
  if (CREDENTIAL_PATHS.has(pathname)) return "credential";
  return "internal-api";
}

function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

/** SHA-256 hex prefix of a secret value. Never reversible, safe to log/store. */
async function shortFingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 12))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type LimiterIdentity = {
  key: string;
  kind: "token-fingerprint" | "ip";
};

/**
 * Strongest stable identity available per surface:
 * - External data surfaces: fingerprint of the presented bearer credential
 *   (API key or Google ID token), so one leaked key cannot exhaust everyone
 *   else's quota and one IP cannot rotate identities cheaply.
 * - Everything else: provider/IP coarse fallback.
 */
export async function resolveLimiterIdentity(
  request: Request,
  routeClass: RateLimitRouteClass,
): Promise<LimiterIdentity> {
  const bearer =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    request.headers.get("x-goog-api-client-token")?.trim() ||
    "";
  const usesTokenIdentity =
    routeClass === "external-sheets" ||
    routeClass === "external-addon" ||
    routeClass === "external-looker";

  if (usesTokenIdentity && bearer.length > 0) {
    return { key: await shortFingerprint(bearer), kind: "token-fingerprint" };
  }
  return { key: requestIp(request), kind: "ip" };
}

/* ------------------------------------------------------------------ */
/* Shared limiter construction (Upstash)                               */
/* ------------------------------------------------------------------ */

type GlobalLimiterCache = typeof globalThis & {
  __monsteraProxyLimiters?: Partial<Record<RateLimitRouteClass, SharedLimiter>>;
};
const globalCache = globalThis as GlobalLimiterCache;

function upstashConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/** Build (once per runtime instance) one Upstash limiter per route class. */
export function buildSharedLimiters(): Partial<Record<RateLimitRouteClass, SharedLimiter>> {
  if (globalCache.__monsteraProxyLimiters) return globalCache.__monsteraProxyLimiters;
  const built: Partial<Record<RateLimitRouteClass, SharedLimiter>> = {};
  if (upstashConfigured()) {
    for (const [routeClass, policy] of Object.entries(ROUTE_CLASS_POLICIES) as [
      RateLimitRouteClass,
      ClassPolicy,
    ][]) {
      built[routeClass] = new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(policy.limit, `${policy.windowSeconds} s`),
        analytics: false,
        prefix: policy.prefix,
      });
    }
  }
  globalCache.__monsteraProxyLimiters = built;
  return built;
}

/* ------------------------------------------------------------------ */
/* Bounded in-process fallback window                                  */
/* --------------------------------------------------------------------*/

type LocalBucket = { count: number; resetsAt: number };
type GlobalBucketStore = typeof globalThis & {
  __monsteraLocalRateBuckets?: Map<string, LocalBucket>;
};
const bucketGlobal = globalThis as GlobalBucketStore;
const localBuckets = bucketGlobal.__monsteraLocalRateBuckets ?? new Map<string, LocalBucket>();
bucketGlobal.__monsteraLocalRateBuckets = localBuckets;

/** Upper bound on tracked keys so memory stays finite under address spoofing. */
export const MAX_LOCAL_BUCKETS = 5000;

function localFallbackLimit(key: string, limit: number, windowSeconds: number): RateLimitDecision {
  const now = Date.now();
  if (localBuckets.size >= MAX_LOCAL_BUCKETS) {
    for (const [k, bucket] of localBuckets) {
      if (bucket.resetsAt <= now) localBuckets.delete(k);
      else break;
    }
    if (localBuckets.size >= MAX_LOCAL_BUCKETS && !localBuckets.has(key)) {
      // Refuse to grow further: treat as blocked rather than unbounded.
      return { success: false, limit, remaining: 0, reset: Math.ceil(now / 1000) + windowSeconds };
    }
  }
  const current = localBuckets.get(key);
  if (!current || current.resetsAt <= now) {
    localBuckets.set(key, { count: 1, resetsAt: now + windowSeconds * 1000 });
    return { success: true, limit, remaining: limit - 1, reset: Math.ceil((now + windowSeconds * 1000) / 1000) };
  }
  current.count += 1;
  return {
    success: current.count <= limit,
    limit,
    remaining: Math.max(0, limit - current.count),
    reset: Math.ceil(current.resetsAt / 1000),
  };
}

/* ------------------------------------------------------------------ */
/* Structured responses & events                                       */
/* --------------------------------------------------------------------*/

export type EnforcementOutcome =
  | { outcome: "allowed"; decision?: RateLimitDecision }
  | { outcome: "blocked"; response: Response }
  | { outcome: "failed-open" }
  | { outcome: "failed-closed"; response: Response }
  | { outcome: "fallback-blocked"; response: Response };

function emitRateLimitEvent(fields: Record<string, unknown>): void {
  // Single-line JSON keeps edge logs parseable without adding infrastructure.
  console.warn(JSON.stringify({ scope: "ratelimit", ts: new Date().toISOString(), ...fields }));
}

function rateLimitedResponse(input: {
  routeClass: RateLimitRouteClass;
  retryAfterSeconds: number;
  decision?: RateLimitDecision;
  status?: 429 | 503;
}): Response {
  const status = input.status ?? 429;
  const body = {
    error:
      status === 429 ? "Too Many Requests" : "Rate limiter temporarily unavailable, retry shortly",
    code: status === 429 ? "rate_limited" : "limiter_unavailable",
    routeClass: input.routeClass,
    retryAfterSeconds: input.retryAfterSeconds,
  };
  const res = new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
  res.headers.set("retry-after", String(input.retryAfterSeconds));
  if (input.decision?.limit !== undefined) {
    res.headers.set("x-ratelimit-limit", String(input.decision.limit));
    res.headers.set("x-ratelimit-remaining", String(input.decision.remaining ?? 0));
  }
  if (input.decision?.reset !== undefined) {
    res.headers.set("x-ratelimit-reset", String(input.decision.reset));
  } else {
    res.headers.set(
      "x-ratelimit-reset",
      String(Math.ceil(Date.now() / 1000) + input.retryAfterSeconds),
    );
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* Enforcement                                                         */
/* --------------------------------------------------------------------*/

export type EnforceOptions = {
  /** Overrides classification (used by tests / callers that already classified). */
  routeClass?: RateLimitRouteClass;
  /** Injectable limiter registry; defaults to Upstash-backed shared limiters. */
  limiters?: Partial<Record<RateLimitRouteClass, SharedLimiter | undefined>>;
  /** Injectable production flag; defaults to NODE_ENV === "production". */
  isProduction?: boolean;
  /** Limiter call timeout in ms. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 3000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("ratelimit timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Enforce the policy for one request. Purely decisional: callers turn the
 * returned outcome into control flow. Never throws.
 */
export async function enforceRequestLimit(
  request: Request,
  pathname: string,
  options: EnforceOptions = {},
): Promise<EnforcementOutcome> {
  const routeClass = options.routeClass ?? classifyApiRoute(pathname);
  if (!routeClass) return { outcome: "allowed" };

  const policy = ROUTE_CLASS_POLICIES[routeClass];
  const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";
  const registry = options.limiters ?? buildSharedLimiters();
  const sharedLimiter = registry[routeClass];

  if (!sharedLimiter) {
    // No shared limiter configured (Upstash env absent) — never unlimited.
    if (policy.onFailure === "fail-closed-in-production") {
      if (isProduction) {
        emitRateLimitEvent({ event: "limiter_missing_fail_closed", routeClass, env: "production" });
        return {
          outcome: "failed-closed",
          response: rateLimitedResponse({ routeClass, retryAfterSeconds: 30, status: 503 }),
        };
      }
      const identity = await resolveLimiterIdentity(request, routeClass);
      const decision = localFallbackLimit(`${policy.prefix}:${identity.key}`, policy.limit, policy.windowSeconds);
      if (!decision.success) {
        emitRateLimitEvent({ event: "blocked", routeClass, identityKind: identity.kind, mode: "local-dev" });
        return {
          outcome: "fallback-blocked",
          response: rateLimitedResponse({ routeClass, retryAfterSeconds: policy.windowSeconds, decision }),
        };
      }
      return { outcome: "allowed" }; // dev/test stay usable without Upstash
    }
    if (policy.onFailure === "bounded-fallback") {
      const identity = await resolveLimiterIdentity(request, routeClass);
      const decision = localFallbackLimit(`${policy.prefix}:${identity.key}`, policy.limit, policy.windowSeconds);
      if (!decision.success) {
        emitRateLimitEvent({ event: "blocked", routeClass, identityKind: identity.kind, mode: "local-fallback" });
        return {
          outcome: "fallback-blocked",
          response: rateLimitedResponse({ routeClass, retryAfterSeconds: policy.windowSeconds, decision }),
        };
      }
      return { outcome: "allowed" };
    }
    // internal-api / credential without Upstash: preserve legacy no-op behavior.
    return { outcome: "allowed" };
  }

  const identity = await resolveLimiterIdentity(request, routeClass);
  try {
    const decision = await withTimeout(sharedLimiter.limit(identity.key), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (!decision.success) {
      emitRateLimitEvent({ event: "blocked", routeClass, identityKind: identity.kind });
      return {
        outcome: "blocked",
        response: rateLimitedResponse({
          routeClass,
          retryAfterSeconds:
            decision.reset !== undefined
              ? Math.max(1, decision.reset - Math.ceil(Date.now() / 1000))
              : policy.windowSeconds,
          decision,
        }),
      };
    }
    return { outcome: "allowed", decision };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    switch (policy.onFailure) {
      case "fail-open": {
        emitRateLimitEvent({ event: "limiter_error_fail_open", routeClass, message });
        return { outcome: "failed-open" };
      }
      case "fail-closed-in-production": {
        if (isProduction) {
          emitRateLimitEvent({ event: "limiter_error_fail_closed", routeClass, env: "production", message });
          return {
            outcome: "failed-closed",
            response: rateLimitedResponse({ routeClass, retryAfterSeconds: 30, status: 503 }),
          };
        }
        emitRateLimitEvent({ event: "limiter_error_fallback_local", routeClass, env: "development", message });
        const decision = localFallbackLimit(`${policy.prefix}:${identity.key}`, policy.limit, policy.windowSeconds);
        if (!decision.success) {
          return {
            outcome: "fallback-blocked",
            response: rateLimitedResponse({ routeClass, retryAfterSeconds: policy.windowSeconds, decision }),
          };
        }
        return { outcome: "allowed" };
      }
      case "bounded-fallback":
      default: {
        emitRateLimitEvent({ event: "limiter_error_fallback_bounded", routeClass, message });
        const decision = localFallbackLimit(`${policy.prefix}:${identity.key}`, policy.limit, policy.windowSeconds);
        if (!decision.success) {
          emitRateLimitEvent({ event: "blocked", routeClass, identityKind: identity.kind, mode: "bounded-fallback" });
          return {
            outcome: "fallback-blocked",
            response: rateLimitedResponse({ routeClass, retryAfterSeconds: policy.windowSeconds, decision }),
          };
        }
        return { outcome: "allowed" };
      }
    }
  }
}
