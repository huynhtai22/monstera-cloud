import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  classifyExternalLimiterFailure,
  classifyApiRoute,
  enforceRequestLimit,
  resolveLimiterIdentity,
  ROUTE_CLASS_POLICIES,
  type RateLimitDecision,
  type SharedLimiter,
} from "./request-rate-limit-policy";

const UPSTASH_ENV_VARS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const;

function okDecision(): RateLimitDecision {
  return { success: true, limit: 60, remaining: 59, reset: Math.ceil(Date.now() / 1000) + 60 };
}

function denyDecision(): RateLimitDecision {
  return { success: false, limit: 60, remaining: 0, reset: Math.ceil(Date.now() / 1000) + 30 };
}

function limiterFrom(impl: () => Promise<RateLimitDecision>): SharedLimiter {
  return { limit: impl };
}

/** Shared limiter with per-key counters — deterministic multi-call behavior. */
function countingSharedLimiter(limit: number): SharedLimiter & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return Object.assign(
    {
      limit: async (key: string) => {
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        return {
          success: n <= limit,
          limit,
          remaining: Math.max(0, limit - n),
          reset: Math.ceil(Date.now() / 1000) + 60,
        };
      },
    },
    { counts },
  );
}

const OK_LIMITER = limiterFrom(async () => okDecision());
const DENY_LIMITER = limiterFrom(async () => denyDecision());
const THROWING_LIMITER = limiterFrom(async () => {
  throw new Error("upstash connection refused");
});
const HANGING_LIMITER = limiterFrom(() => new Promise<RateLimitDecision>(() => {}));

const RUNTIME_ENV_PRESENT = {
  runtimeUrlPresent: true,
  runtimeTokenPresent: true,
};

function apiRequest(pathname: string, headers: Record<string, string> = {}, method = "GET"): Request {
  return new Request(`https://app.example.test${pathname}`, { method, headers });
}

describe("API route classification", () => {
  it("classifies webhook ingestion routes (including stripe/xendit outside /webhooks/)", () => {
    for (const pathname of [
      "/api/webhooks/paddle",
      "/api/webhooks/shopee",
      "/api/webhooks/meta-ads",
      "/api/stripe/webhook",
      "/api/xendit/webhook",
    ]) {
      assert.equal(classifyApiRoute(pathname), "webhook", pathname);
    }
  });

  it("classifies Sheets add-on and Looker Studio surfaces as external", () => {
    for (const pathname of [
      "/api/v1/sheets/auth",
      "/api/v1/sheets/query",
      "/api/v1/sheets/schema",
    ]) {
      assert.equal(classifyApiRoute(pathname), "external-sheets", pathname);
    }
    for (const pathname of ["/api/addon/auth", "/api/addon/accounts"]) {
      assert.equal(classifyApiRoute(pathname), "external-addon", pathname);
    }
    for (const pathname of [
      "/api/looker-studio",
      "/api/looker-studio/jobs",
      "/api/looker-studio/accounts",
      "/api/looker-studio/meta",
    ]) {
      assert.equal(classifyApiRoute(pathname), "external-looker", pathname);
    }
  });

  it("classifies credential endpoints without touching NextAuth internals", () => {
    for (const pathname of [
      "/api/auth/forgot-password",
      "/api/auth/register",
      "/api/auth/resend-otp",
      "/api/auth/reset-password",
      "/api/auth/verify",
    ]) {
      assert.equal(classifyApiRoute(pathname), "credential", pathname);
    }
    // NextAuth internals are excluded from the proxy matcher; classification
    // is defensive only.
    assert.equal(classifyApiRoute("/api/auth/callback/google"), "internal-api");
  });

  it("classifies everything else under /api as internal and ignores pages", () => {
    assert.equal(classifyApiRoute("/api/cron/master"), "internal-api");
    assert.equal(classifyApiRoute("/api/workspaces"), "internal-api");
    assert.equal(classifyApiRoute("/api/export/rows"), "internal-api");
    assert.equal(classifyApiRoute("/api/payments/vietqr/create"), "internal-api");
    assert.equal(classifyApiRoute("/console"), null);
    assert.equal(classifyApiRoute("/pricing"), null);
  });
});

describe("limiter identity tiers", () => {
  it("uses a stable bearer-token fingerprint for external data surfaces", async () => {
    const req = apiRequest("/api/v1/sheets/query", { authorization: "Bearer sheet-token-abc" });
    const first = await resolveLimiterIdentity(req, "external-sheets");
    const second = await resolveLimiterIdentity(req, "external-sheets");
    assert.equal(first.kind, "token-fingerprint");
    assert.equal(first.key, second.key);
    assert.ok(first.key.length > 0 && !first.key.includes("sheet-token-abc"), "key must be a hash");

    const other = await resolveLimiterIdentity(
      apiRequest("/api/v1/sheets/query", { authorization: "Bearer sheet-token-xyz" }),
      "external-sheets",
    );
    assert.notEqual(other.key, first.key);
  });

  it("falls back to IP identity when no credential is presented", async () => {
    const req = apiRequest("/api/v1/sheets/schema", { "x-forwarded-for": "203.0.113.7, 70.41.3.1" });
    const identity = await resolveLimiterIdentity(req, "external-sheets");
    assert.equal(identity.kind, "ip");
    assert.equal(identity.key, "203.0.113.7");
  });

  it("keeps internal and webhook classes on the coarse IP tier even with bearers", async () => {
    const req = apiRequest("/api/workspaces", {
      authorization: "Bearer whatever",
      "x-forwarded-for": "198.51.100.9",
    });
    const internal = await resolveLimiterIdentity(req, "internal-api");
    const webhook = await resolveLimiterIdentity(req, "webhook");
    assert.equal(internal.kind, "ip");
    assert.equal(webhook.kind, "ip");
  });
});

describe("external limiter failure diagnostics", () => {
  it("classifies every allowlisted failure category", () => {
    assert.equal(
      classifyExternalLimiterFailure(new Error("anything"), {
        runtimeUrlPresent: false,
        runtimeTokenPresent: true,
      }),
      "missing_runtime_env",
    );
    assert.equal(classifyExternalLimiterFailure(new Error("ratelimit timeout"), RUNTIME_ENV_PRESENT), "timeout");
    assert.equal(
      classifyExternalLimiterFailure(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }), RUNTIME_ENV_PRESENT),
      "network",
    );
    for (const [status, category] of [
      [401, "http_401"],
      [403, "http_403"],
      [429, "http_429"],
      [500, "http_5xx"],
      [503, "http_5xx"],
    ] as const) {
      assert.equal(classifyExternalLimiterFailure({ status }, RUNTIME_ENV_PRESENT), category);
    }
    assert.equal(classifyExternalLimiterFailure(new Error("unclassified failure"), RUNTIME_ENV_PRESENT), "unknown");
  });

  it("logs only the safe schema even when an error contains secret-shaped data", async () => {
    const secretUrl = "https://secret-host.upstash.io";
    const secretToken = "secret-token-that-must-never-appear";
    const secretIp = "203.0.113.99";
    const savedUrl = process.env.UPSTASH_REDIS_REST_URL;
    const savedToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.UPSTASH_REDIS_REST_URL = secretUrl;
    process.env.UPSTASH_REDIS_REST_TOKEN = secretToken;
    const messages: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { messages.push(args.map(String).join(" ")); };
    try {
      const limiter = limiterFrom(async () => {
        throw new Error(`401 ${secretUrl} Bearer ${secretToken} x-forwarded-for=${secretIp}`);
      });
      const result = await enforceRequestLimit(
        apiRequest("/api/v1/sheets/auth", { "x-forwarded-for": secretIp }),
        "/api/v1/sheets/auth",
        { limiters: { "external-sheets:ip": limiter }, isProduction: true },
      );
      assert.equal(result.outcome, "failed-closed");
    } finally {
      console.warn = originalWarn;
      if (savedUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
      else process.env.UPSTASH_REDIS_REST_URL = savedUrl;
      if (savedToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
      else process.env.UPSTASH_REDIS_REST_TOKEN = savedToken;
    }

    assert.equal(messages.length, 1);
    const serialized = messages[0];
    for (const forbidden of [secretUrl, secretToken, secretIp, "Bearer", "x-forwarded-for", "stack"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
    assert.deepEqual(JSON.parse(serialized), {
      routeClass: "external-sheets",
      limiterTier: "outer-ip",
      runtimeUrlPresent: true,
      runtimeTokenPresent: true,
      failureCategory: "http_401",
    });
  });
});

describe("enforcement failure policies", () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = {};
    for (const key of UPSTASH_ENV_VARS) savedEnv[key] = process.env[key];
    for (const key of UPSTASH_ENV_VARS) delete process.env[key];
    delete (globalThis as { __monsteraProxyLimiters?: unknown }).__monsteraProxyLimiters;
  });
  afterEach(() => {
    for (const key of UPSTASH_ENV_VARS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function uniqueIp(seed: string): Record<string, string> {
    return { "x-forwarded-for": `10.77.${seed.length}.${seed.charCodeAt(0) % 251}` };
  }

  it("allows requests under a healthy shared limiter", async () => {
    const decision = okDecision();
    const limiter = limiterFrom(async () => decision);
    const result = await enforceRequestLimit(
      apiRequest("/api/workspaces", uniqueIp("ok")),
      "/api/workspaces",
      { limiters: { "internal-api": limiter }, isProduction: true },
    );
    assert.deepEqual(result, { outcome: "allowed", decision });
  });

  it("returns structured 429 with Retry-After and rate-limit metadata when blocked", async () => {
    const res = await enforceRequestLimit(
      apiRequest("/api/looker-studio", uniqueIp("deny")),
      "/api/looker-studio",
      {
        limiters: { "external-looker": DENY_LIMITER, "external-looker:ip": OK_LIMITER },
        isProduction: true,
      },
    );
    assert.equal(res.outcome, "blocked");
    const response = (res as { response: Response }).response;
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get("retry-after")) >= 1);
    assert.equal(response.headers.get("x-ratelimit-limit"), "60");
    assert.equal(response.headers.get("x-ratelimit-remaining"), "0");
    const body = (await response.json()) as { code?: string; routeClass?: string };
    assert.equal(body.code, "rate_limited");
    assert.equal(body.routeClass, "external-looker");
  });

  it("fails open for internal APIs and credentials when Upstash errors (availability)", async () => {
    const internal = await enforceRequestLimit(
      apiRequest("/api/workspaces", uniqueIp("io")),
      "/api/workspaces",
      { limiters: { "internal-api": THROWING_LIMITER }, isProduction: true },
    );
    assert.equal(internal.outcome, "failed-open");

    const credential = await enforceRequestLimit(
      apiRequest("/api/auth/reset-password", {
        ...uniqueIp("cp"),
        "content-type": "application/json",
      }),
      "/api/auth/reset-password",
      { limiters: { credential: THROWING_LIMITER }, isProduction: true },
    );
    assert.equal(credential.outcome, "failed-open");
  });

  it("fails closed with retryable 503 for Sheets/Looker in production on limiter error", async () => {
    for (const [routeClass, pathname] of [
      ["external-sheets", "/api/v1/sheets/query"],
      ["external-looker", "/api/looker-studio"],
    ] as const) {
      const result = await enforceRequestLimit(
        apiRequest(pathname, { authorization: "Bearer fp-outage" }),
        pathname,
        { limiters: { [routeClass]: THROWING_LIMITER } as never, isProduction: true },
      );
      assert.equal(result.outcome, "failed-closed", routeClass);
      const response = (result as { response: Response }).response;
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("retry-after"), "30");
      assert.deepEqual(await response.json(), {
        error: "Rate limiter temporarily unavailable, retry shortly",
        code: "limiter_unavailable",
        routeClass,
        retryAfterSeconds: 30,
      });
    }
  });

  it("keeps development usable without Upstash via bounded local fallback", async () => {
    const limit = ROUTE_CLASS_POLICIES["external-sheets"].limit;
    const headers = { authorization: "Bearer dev-fallback-token", ...uniqueIp("devfb") };
    let sawAllowed = false;
    let blockedResponse: Response | undefined;
    for (let i = 0; i < limit + 5; i++) {
      const result = await enforceRequestLimit(
        apiRequest("/api/v1/sheets/query", headers),
        "/api/v1/sheets/query",
        { limiters: { "external-sheets": THROWING_LIMITER }, isProduction: false },
      );
      if (result.outcome === "allowed") sawAllowed = true;
      if (result.outcome === "fallback-blocked") {
        blockedResponse = (result as { response: Response }).response;
        break;
      }
      assert.ok(
        result.outcome === "allowed",
        `unexpected outcome ${result.outcome} at iteration ${i}`,
      );
    }
    assert.ok(sawAllowed, "dev fallback must allow initial traffic");
    assert.ok(blockedResponse, "dev fallback must still bound traffic at the class limit");
    assert.equal(blockedResponse!.status, 429);
  });

  it("webhooks use a bounded fallback instead of unlimited acceptance during outages", async () => {
    const policy = ROUTE_CLASS_POLICIES.webhook;
    const headers = uniqueIp("whfb");
    const request = apiRequest("/api/webhooks/shopee", { ...headers, "content-type": "application/json" }, "POST");
    let allowed = 0;
    let blockedAt = -1;
    for (let i = 0; i < policy.limit + 10; i++) {
      const result = await enforceRequestLimit(request, "/api/webhooks/shopee", {
        limiters: { webhook: THROWING_LIMITER },
        isProduction: true,
      });
      if (result.outcome === "allowed") allowed++;
      else {
        blockedAt = i;
        break;
      }
    }
    assert.equal(allowed, policy.limit, "fallback must allow exactly the class limit");
    assert.equal(blockedAt, policy.limit, "fallback must block beyond the class limit");
  });

  it("same valid token repeatedly hits the fingerprint limit while the IP gate still has headroom", async () => {
    const policy = ROUTE_CLASS_POLICIES["external-sheets"];
    const headers = {
      authorization: "Bearer steady-valid-token",
      ...uniqueIp("steady"),
    };
    let allowed = 0;
    let tierHeader = "";
    for (let i = 0; i < policy.limit + 5; i++) {
      const result = await enforceRequestLimit(
        apiRequest("/api/v1/sheets/query", headers),
        "/api/v1/sheets/query",
        { limiters: { "external-sheets": THROWING_LIMITER, "external-sheets:ip": OK_LIMITER }, isProduction: false },
      );
      if (result.outcome === "allowed") {
        allowed += 1;
        continue;
      }
      assert.equal(result.outcome, "fallback-blocked");
      tierHeader =
        (result as { response: Response }).response.headers.get("x-ratelimit-tier") ?? "";
      break;
    }
    assert.equal(allowed, policy.limit, "per-token fingerprint gate must bind at its own ceiling");
    assert.equal(tierHeader, "token-fingerprint");
  });

  it("hundreds of distinct fake bearer values from one IP hit the outer IP limit", async () => {
    const policy = ROUTE_CLASS_POLICIES["external-looker"];
    const primary = countingSharedLimiter(policy.limit);
    const outer = countingSharedLimiter(policy.outerIp!.limit);
    const ipHeaders = uniqueIp("rotation");
    let allowed = 0;
    let blockedResponse: Response | undefined;
    const totalAttempts = policy.outerIp!.limit + 25;
    for (let i = 0; i < totalAttempts; i++) {
      const result = await enforceRequestLimit(
        apiRequest("/api/looker-studio", {
          authorization: `Bearer rotated-fake-key-${i}`,
          ...ipHeaders,
        }),
        "/api/looker-studio",
        {
          limiters: { "external-looker": primary, "external-looker:ip": outer },
          isProduction: true,
        },
      );
      if (result.outcome === "allowed") {
        allowed += 1;
        continue;
      }
      blockedResponse = (result as { response: Response }).response;
      break;
    }
    assert.equal(allowed, policy.outerIp!.limit, "outer IP gate must allow exactly its ceiling under rotation");
    assert.ok(blockedResponse, "outer IP gate must eventually block token rotation");
    assert.equal(blockedResponse!.status, 429);
    assert.equal(blockedResponse!.headers.get("x-ratelimit-limit"), String(policy.outerIp!.limit));
    assert.equal(blockedResponse!.headers.get("x-ratelimit-tier"), "outer-ip");
    const body = (await blockedResponse!.json()) as { code?: string };
    assert.equal(body.code, "rate_limited");
  });

  it("different IPs remain independently limited", async () => {
    const policy = ROUTE_CLASS_POLICIES["external-looker"];
    const primary = countingSharedLimiter(policy.limit);
    const outer = countingSharedLimiter(policy.outerIp!.limit);
    const registry = {
      "external-looker": primary,
      "external-looker:ip": outer,
    };
    let tokenCounter = 0;
    const exhaustIp = async (ip: string): Promise<void> => {
      for (let i = 0; i < policy.outerIp!.limit + 3; i++) {
        await enforceRequestLimit(
          apiRequest("/api/looker-studio", {
            authorization: `Bearer key-${ip}-${i}`,
            "x-forwarded-for": ip,
          }),
          "/api/looker-studio",
          { limiters: registry, isProduction: true },
        );
      }
    };
    await exhaustIp("203.0.113.10");
    // A different address starts with a clean outer-IP budget.
    const freshResult = await enforceRequestLimit(
      apiRequest("/api/looker-studio", {
        authorization: `Bearer key-fresh-${tokenCounter++}`,
        "x-forwarded-for": "198.51.100.77",
      }),
      "/api/looker-studio",
      { limiters: registry, isProduction: true },
    );
    assert.equal(freshResult.outcome, "allowed");
    // And its own budget is enforced separately.
    let freshBlocked = false;
    for (let i = 0; i < policy.outerIp!.limit + 3; i++) {
      const result = await enforceRequestLimit(
        apiRequest("/api/looker-studio", {
          authorization: `Bearer key-second-${i}`,
          "x-forwarded-for": "198.51.100.77",
        }),
        "/api/looker-studio",
        { limiters: registry, isProduction: true },
      );
      if (result.outcome === "blocked") {
        freshBlocked = true;
        break;
      }
    }
    assert.ok(freshBlocked, "second IP must be bounded by its own budget");
  });

  it("without any configured limiter in production, external reads fail closed but internal stays open", async () => {
    const sheets = await enforceRequestLimit(
      apiRequest("/api/v1/sheets/query", { authorization: "Bearer no-limiter" }),
      "/api/v1/sheets/query",
      { limiters: {}, isProduction: true },
    );
    assert.equal(sheets.outcome, "failed-closed");

    const internal = await enforceRequestLimit(
      apiRequest("/api/workspaces", uniqueIp("nolim")),
      "/api/workspaces",
      { limiters: {}, isProduction: true },
    );
    assert.equal(internal.outcome, "allowed");
  });

  it("treats limiter timeouts like errors per class policy", async () => {
    const internal = await enforceRequestLimit(
      apiRequest("/api/workspaces", uniqueIp("to1")),
      "/api/workspaces",
      { limiters: { "internal-api": HANGING_LIMITER }, timeoutMs: 20, isProduction: true },
    );
    assert.equal(internal.outcome, "failed-open");

    const sheets = await enforceRequestLimit(
      apiRequest("/api/v1/sheets/query", { authorization: "Bearer slow-token" }),
      "/api/v1/sheets/query",
      { limiters: { "external-sheets": HANGING_LIMITER }, timeoutMs: 20, isProduction: true },
    );
    assert.equal(sheets.outcome, "failed-closed");
  });
});
