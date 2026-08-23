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
import { createEdgeRedis, type EdgeRedisClient } from "./edge-redis";

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
  /**
   * Coarse outer IP gate applied BEFORE the primary identity check for
   * external data surfaces. Without it an attacker could rotate arbitrary
   * bearer values from one address and evade the fingerprint-only limit,
   * because fingerprints are computed before authentication. The ceiling is
   * deliberately several times the per-token limit so legitimate shared-NAT
   * teams are not blocked, while total requests per address stay bounded.
   * Both tiers must pass for the request to proceed.
   */
  outerIp?: { limit: number; windowSeconds: number; prefix: string };
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
  // 120/min per token fingerprint, plus a coarse 600/min per-IP outer gate.
  "external-sheets": {
    limit: 120,
    windowSeconds: 60,
    prefix: "monstera:ratelimit:sheets",
    onFailure: "fail-closed-in-production",
    outerIp: { limit: 600, windowSeconds: 60, prefix: "monstera:ratelimit:sheets-ip" },
  },
  // Add-on auth/accounts routes (same client surface as sheets).
  "external-addon": {
    limit: 120,
    windowSeconds: 60,
    prefix: "monstera:ratelimit:addon",
    onFailure: "fail-closed-in-production",
    outerIp: { limit: 600, windowSeconds: 60, prefix: "monstera:ratelimit:addon-ip" },
  },
  // Looker Studio connector (API-key / Google ID-token authenticated reads).
  // 60/min per key fingerprint, plus a coarse 300/min per-IP outer gate.
  "external-looker": {
    limit: 60,
    windowSeconds: 60,
    prefix: "monstera:ratelimit:looker",
    onFailure: "fail-closed-in-production",
    outerIp: { limit: 300, windowSeconds: 60, prefix: "monstera:ratelimit:looker-ip" },
  },
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

/** Registry slot: a route class (primary tier) or its `:ip` outer gate. */
export type LimiterSlotKey = RateLimitRouteClass | `${RateLimitRouteClass}:ip`;
export type LimiterRegistry = Partial<Record<LimiterSlotKey, SharedLimiter | undefined>>;

type GlobalLimiterCache = typeof globalThis & {
  __monsteraProxyLimiters?: LimiterRegistry;
};
const globalCache = globalThis as GlobalLimiterCache;

function makeUpstashLimiter(
  redis: EdgeRedisClient,
  limit: number,
  windowSeconds: number,
  prefix: string,
): SharedLimiter {
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    analytics: false,
    prefix,
  });
}

/**
 * Build (once per runtime instance) Upstash limiters for every class plus the
 * coarse outer-IP gates of the external data surfaces.
 */
export function buildSharedLimiters(): LimiterRegistry {
  if (globalCache.__monsteraProxyLimiters) return globalCache.__monsteraProxyLimiters;
  const built: LimiterRegistry = {};
  const redis = createEdgeRedis();
  if (redis) {
    for (const [routeClass, policy] of Object.entries(ROUTE_CLASS_POLICIES) as [
      RateLimitRouteClass,
      ClassPolicy,
    ][]) {
      built[routeClass] = makeUpstashLimiter(redis, policy.limit, policy.windowSeconds, policy.prefix);
      if (policy.outerIp) {
        built[`${routeClass}:ip` as LimiterSlotKey] = makeUpstashLimiter(
          redis,
          policy.outerIp.limit,
          policy.outerIp.windowSeconds,
          policy.outerIp.prefix,
        );
      }
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

export type ExternalLimiterFailureCategory =
  | "missing_runtime_env"
  | "timeout"
  | "network"
  | "http_401"
  | "http_403"
  | "http_429"
  | "http_5xx"
  | "unknown";

type RuntimeLimiterEnvShape = {
  runtimeUrlPresent: boolean;
  runtimeTokenPresent: boolean;
};

function runtimeLimiterEnvShape(): RuntimeLimiterEnvShape {
  return {
    runtimeUrlPresent: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    runtimeTokenPresent: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
  };
}

function errorClassificationText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "").toLowerCase();
  const value = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    cause?: { name?: unknown; message?: unknown; code?: unknown };
  };
  return [
    value.name,
    value.message,
    value.code,
    value.cause?.name,
    value.cause?.message,
    value.cause?.code,
  ].map((part) => String(part ?? "")).join(" ").toLowerCase();
}

function errorHttpStatus(error: unknown, text: string): number | undefined {
  if (error && typeof error === "object") {
    const value = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
    for (const candidate of [value.status, value.statusCode, value.response?.status]) {
      if (typeof candidate === "number" && Number.isInteger(candidate)) return candidate;
    }
  }
  if (/\b401\b|unauthori[sz]ed/.test(text)) return 401;
  if (/\b403\b|forbidden/.test(text)) return 403;
  if (/\b429\b|too many requests/.test(text)) return 429;
  const serverStatus = /\b(5\d{2})\b/.exec(text);
  return serverStatus ? Number(serverStatus[1]) : undefined;
}

/** Classifies an external limiter failure without returning or logging error data. */
export function classifyExternalLimiterFailure(
  error: unknown,
  runtimeEnv: RuntimeLimiterEnvShape,
): ExternalLimiterFailureCategory {
  if (!runtimeEnv.runtimeUrlPresent || !runtimeEnv.runtimeTokenPresent) {
    return "missing_runtime_env";
  }

  const text = errorClassificationText(error);
  if (/timeout|timed out|aborterror|aborted/.test(text)) return "timeout";

  const status = errorHttpStatus(error, text);
  if (status === 401) return "http_401";
  if (status === 403) return "http_403";
  if (status === 429) return "http_429";
  if (status !== undefined && status >= 500 && status <= 599) return "http_5xx";

  if (
    /enotfound|eai_again|econnrefused|econnreset|enetunreach|ehostunreach|fetch failed|networkerror|network error|socket hang up/.test(text)
  ) {
    return "network";
  }
  return "unknown";
}

function isExternalRouteClass(routeClass: RateLimitRouteClass): boolean {
  return routeClass === "external-sheets" || routeClass === "external-addon" || routeClass === "external-looker";
}

function emitExternalLimiterFailure(
  routeClass: RateLimitRouteClass,
  limiterTier: TierCheck["identityKind"],
  error: unknown,
): void {
  const runtimeEnv = runtimeLimiterEnvShape();
  // Deliberately allowlisted payload: never add error objects, messages,
  // headers, request identifiers, credentials, or network locations here.
  console.warn(JSON.stringify({
    routeClass,
    limiterTier,
    ...runtimeEnv,
    failureCategory: classifyExternalLimiterFailure(error, runtimeEnv),
  }));
}

function rateLimitedResponse(input: {
  routeClass: RateLimitRouteClass;
  retryAfterSeconds: number;
  decision?: RateLimitDecision;
  status?: 429 | 503;
  tier?: string;
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
  if (input.tier) res.headers.set("x-ratelimit-tier", input.tier);
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
  /**
   * Injectable limiter registry; defaults to Upstash-backed shared limiters.
   * Slots are keyed by route class for the primary (identity) tier and by
   * `${routeClass}:ip` for the coarse outer-IP tier of external data classes.
   */
  limiters?: LimiterRegistry;
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

type TierCheck = {
  slotKey: LimiterSlotKey;
  limiter: SharedLimiter | undefined;
  bucketPrefix: string;
  identityKey: string;
  identityKind: LimiterIdentity["kind"] | "outer-ip";
  limit: number;
  windowSeconds: number;
};

/**
 * Enforce one tier of a class policy.
 *
 * Returns `{ outcome: "allowed" }` (with the limiter decision when one was
 * made) when the request may proceed to the next tier, or a terminal outcome
 * (`blocked` / `failed-closed` / `failed-open` / `fallback-blocked`) that the
 * caller must surface immediately. Failure behavior follows the class policy
 * so an Upstash outage never becomes unlimited access on guarded surfaces.
 */
async function enforceTier(
  routeClass: RateLimitRouteClass,
  policy: ClassPolicy,
  tier: TierCheck,
  isProduction: boolean,
  timeoutMs: number,
): Promise<EnforcementOutcome> {
  const blockedResponse = (decision: RateLimitDecision): EnforcementOutcome => ({
    outcome: "blocked",
    response: rateLimitedResponse({
      routeClass,
      retryAfterSeconds:
        decision.reset !== undefined
          ? Math.max(1, decision.reset - Math.ceil(Date.now() / 1000))
          : tier.windowSeconds,
      decision,
      tier: tier.identityKind,
    }),
  });

  const localFallback = (mode: string): EnforcementOutcome => {
    const decision = localFallbackLimit(`${tier.bucketPrefix}:${tier.identityKey}`, tier.limit, tier.windowSeconds);
    if (!decision.success) {
      emitRateLimitEvent({ event: "blocked", routeClass, identityKind: tier.identityKind, mode });
      return {
        outcome: "fallback-blocked",
        response: rateLimitedResponse({ routeClass, retryAfterSeconds: tier.windowSeconds, decision, tier: tier.identityKind }),
      };
    }
    return { outcome: "allowed" };
  };

  const limiter = tier.limiter;
  if (!limiter) {
    // No shared limiter configured — never unlimited on guarded surfaces.
    switch (policy.onFailure) {
      case "fail-closed-in-production":
        if (isProduction) {
          if (isExternalRouteClass(routeClass)) {
            emitExternalLimiterFailure(routeClass, tier.identityKind, undefined);
          } else {
            emitRateLimitEvent({ event: "limiter_missing_fail_closed", routeClass, env: "production", tier: tier.identityKind });
          }
          return {
            outcome: "failed-closed",
            response: rateLimitedResponse({ routeClass, retryAfterSeconds: 30, status: 503 }),
          };
        }
        return localFallback("local-dev");
      case "bounded-fallback":
        return localFallback("local-fallback");
      default:
        // internal-api / credential without Upstash: legacy no-op.
        return { outcome: "allowed" };
    }
  }

  try {
    const decision = await withTimeout(limiter.limit(tier.identityKey), timeoutMs);
    if (!decision.success) {
      emitRateLimitEvent({ event: "blocked", routeClass, identityKind: tier.identityKind });
      return blockedResponse(decision);
    }
    return { outcome: "allowed", decision };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const externalFailure = isExternalRouteClass(routeClass);
    if (externalFailure) emitExternalLimiterFailure(routeClass, tier.identityKind, err);
    switch (policy.onFailure) {
      case "fail-open": {
        emitRateLimitEvent({ event: "limiter_error_fail_open", routeClass, message, tier: tier.identityKind });
        return { outcome: "failed-open" };
      }
      case "fail-closed-in-production": {
        if (isProduction) {
          if (!externalFailure) {
            emitRateLimitEvent({ event: "limiter_error_fail_closed", routeClass, env: "production", message, tier: tier.identityKind });
          }
          return {
            outcome: "failed-closed",
            response: rateLimitedResponse({ routeClass, retryAfterSeconds: 30, status: 503 }),
          };
        }
        if (!externalFailure) {
          emitRateLimitEvent({ event: "limiter_error_fallback_local", routeClass, env: "development", message, tier: tier.identityKind });
        }
        return localFallback("error-fallback");
      }
      case "bounded-fallback":
      default: {
        emitRateLimitEvent({ event: "limiter_error_fallback_bounded", routeClass, message, tier: tier.identityKind });
        return localFallback("bounded-fallback");
      }
    }
  }
}

/**
 * Enforce the full policy for one request. Purely decisional: callers turn the
 * returned outcome into control flow. Never throws.
 *
 * External data classes run TWO gates and both must pass:
 * 1. the coarse outer-IP gate (bounds bearer/API-key rotation from one address)
 * 2. the per-credential fingerprint gate
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (policy.outerIp) {
    const ipIdentity: LimiterIdentity = { key: requestIp(request), kind: "ip" };
    const outerResult = await enforceTier(
      routeClass,
      policy,
      {
        slotKey: `${routeClass}:ip`,
        limiter: registry[`${routeClass}:ip`],
        bucketPrefix: policy.outerIp.prefix,
        identityKey: ipIdentity.key,
        identityKind: "outer-ip",
        limit: policy.outerIp.limit,
        windowSeconds: policy.outerIp.windowSeconds,
      },
      isProduction,
      timeoutMs,
    );
    if (outerResult.outcome !== "allowed") return outerResult;
  }

  const identity = await resolveLimiterIdentity(request, routeClass);
  const primaryResult = await enforceTier(
    routeClass,
    policy,
    {
      slotKey: routeClass,
      limiter: registry[routeClass],
      bucketPrefix: policy.prefix,
      identityKey: identity.key,
      identityKind: identity.kind,
      limit: policy.limit,
      windowSeconds: policy.windowSeconds,
    },
    isProduction,
    timeoutMs,
  );
  return primaryResult;
}
