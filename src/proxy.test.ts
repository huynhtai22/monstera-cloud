import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { __createProxyForTests, config } from "./proxy";
import type { SharedLimiter } from "@/lib/request-rate-limit-policy";

const UPSTASH_ENV_VARS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const;

type MinimalInit = { headers?: Record<string, string>; method?: string; body?: string };

function okLimiter(): SharedLimiter {
  return {
    limit: async () => ({
      success: true,
      limit: 60,
      remaining: 59,
      reset: Math.ceil(Date.now() / 1000) + 60,
    }),
  };
}

function denyLimiter(): SharedLimiter {
  return {
    limit: async () => ({
      success: false,
      limit: 60,
      remaining: 0,
      reset: Math.ceil(Date.now() / 1000) + 30,
    }),
  };
}

function throwingLimiter(): SharedLimiter {
  return {
    limit: async () => {
      throw new Error("upstash unavailable");
    },
  };
}

describe("proxy page authentication (deny-by-default)", () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = {};
    for (const key of [...UPSTASH_ENV_VARS, "AGENCY_HOST_ROUTING_ENABLED", "AGENCY_DEV_SLUG"]) {
      savedEnv[key] = process.env[key];
    }
    for (const key of UPSTASH_ENV_VARS) delete process.env[key];
    delete process.env.AGENCY_HOST_ROUTING_ENABLED;
    delete process.env.AGENCY_DEV_SLUG;
    delete (globalThis as { __monsteraProxyLimiters?: unknown }).__monsteraProxyLimiters;
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function pageRequest(path: string, extra: MinimalInit = {}): NextRequest {
    return new NextRequest(`https://app.example.test${path}`, extra);
  }

  it("redirects unauthenticated users from protected app routes to login", async () => {
    const proxy = __createProxyForTests({ getSessionToken: async () => null });
    for (const path of [
      "/console",
      "/sources/setup",
      "/explorer?tab=warehouse",
      "/admin/signal",
      "/pilot-admin",
    ]) {
      const res = await proxy(pageRequest(path));
      assert.equal(res.status, 307, `${path} should redirect`);
      const location = res.headers.get("location") ?? "";
      const loginUrl = new URL(location);
      assert.equal(loginUrl.pathname, "/login");
      assert.ok(
        loginUrl.searchParams.get("callbackUrl")?.startsWith(path.split("?")[0]),
        `callbackUrl should preserve ${path}`,
      );
    }
  });

  it("allows authenticated sessions through protected app routes", async () => {
    const proxy = __createProxyForTests({ getSessionToken: async () => ({ sub: "user_1" }) });
    const res = await proxy(pageRequest("/console"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("location"), null);
  });

  it("keeps required public routes reachable without any session lookup", async () => {
    let getTokenCalls = 0;
    const proxy = __createProxyForTests({
      // Any invocation would inflate the counter and fail the assertion below.
      getSessionToken: async () => {
        getTokenCalls += 1;
        return null;
      },
    });
    const publicPaths = [
      "/",
      "/pricing",
      "/about",
      "/changelog",
      "/docs",
      "/legal/terms-of-service",
      "/legal/privacy-policy",
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
      "/verify",
      "/success",
      "/pixel-test",
      "/demo/ui",
      "/auth/continue",
      "/invite/tok_123",
      "/integrations/meta-ads",
      "/solutions/agencies",
    ];
    for (const path of publicPaths) {
      const res = await proxy(pageRequest(path));
      assert.notEqual(res.status, 307, `${path} must stay public`);
      assert.notEqual(res.status, 404, `${path} must not be blocked`);
    }
    assert.equal(getTokenCalls, 0, "public routes must not consult session tokens at all");
  });

  it("REGRESSION: a newly added application route cannot accidentally become public", async () => {
    const proxy = __createProxyForTests({ getSessionToken: async () => null });
    const res = await proxy(pageRequest("/brand-new-app-page"));
    assert.equal(res.status, 307, "unknown app-style routes must require authentication by default");
  });

  it("passes static assets through without session lookups", async () => {
    let getTokenCalls = 0;
    const proxy = __createProxyForTests({
      getSessionToken: async () => {
        getTokenCalls += 1;
        return null;
      },
    });
    for (const path of ["/og.png", "/logo.svg", "/fonts/inter.woff2"]) {
      const res = await proxy(pageRequest(path));
      assert.equal(res.status, 200, `${path} should pass through`);
    }
    assert.equal(getTokenCalls, 0);
  });

  it("preserves agency-host rewrites after authentication succeeds", async () => {
    process.env.AGENCY_HOST_ROUTING_ENABLED = "1";
    process.env.AGENCY_DEV_SLUG = "acme";
    const proxy = __createProxyForTests({ getSessionToken: async () => ({ sub: "user_1" }) });
    const req = new NextRequest("http://localhost:3000/", { headers: { host: "localhost" } });
    const res = await proxy(req);
    assert.equal(res.headers.get("x-monstera-agency-slug"), "acme");

    const anon = await __createProxyForTests({ getSessionToken: async () => null })(
      new NextRequest("http://localhost:3000/", { headers: { host: "localhost" } }),
    );
    assert.equal(anon.headers.get("x-monstera-agency-slug"), "acme", "public paths still rewrite");
  });
});

describe("proxy API pipeline", () => {
  beforeEach(() => {
    delete (globalThis as { __monsteraProxyLimiters?: unknown }).__monsteraProxyLimiters;
  });

  function apiRequest(path: string, init: MinimalInit = {}): NextRequest {
    return new NextRequest(`https://app.example.test${path}`, init);
  }

  it("answers Sheets add-on CORS preflights before any rate limiting", async () => {
    const proxy = __createProxyForTests({
      enforceOptions: { limiters: { "external-sheets": denyLimiter() }, isProduction: true },
    });
    const res = await proxy(
      apiRequest("/api/v1/sheets/query", {
        method: "OPTIONS",
        headers: { origin: "https://script.google.com" },
      }),
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "https://script.google.com");
    assert.match(res.headers.get("access-control-allow-methods") ?? "", /POST/);
  });

  it("passes Sheets add-on requests through with scoped CORS headers", async () => {
    const proxy = __createProxyForTests({
      enforceOptions: { limiters: { "external-sheets": okLimiter() }, isProduction: true },
    });
    const allowed = await proxy(
      apiRequest("/api/v1/sheets/query", {
        headers: { origin: "https://script.google.com", authorization: "Bearer tok" },
      }),
    );
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://script.google.com");

    const disallowed = await proxy(
      apiRequest("/api/v1/sheets/query", {
        headers: { origin: "https://evil.example", authorization: "Bearer tok" },
      }),
    );
    assert.equal(disallowed.status, 200);
    assert.equal(
      disallowed.headers.get("access-control-allow-origin"),
      "https://monsteracloud.com",
      "disallowed origins fall back to the primary domain, never reflected",
    );
  });

  it("rate-limits internal APIs like cron endpoints and returns structured 429s", async () => {
    const passing = __createProxyForTests({
      enforceOptions: { limiters: { "internal-api": okLimiter() }, isProduction: true },
    });
    const okRes = await passing(apiRequest("/api/cron/master"));
    assert.equal(okRes.status, 200);

    const blocking = __createProxyForTests({
      enforceOptions: { limiters: { "internal-api": denyLimiter() }, isProduction: true },
    });
    const limited = await blocking(apiRequest("/api/cron/master"));
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    const body = (await limited.json()) as { code?: string };
    assert.equal(body.code, "rate_limited");
  });

  it("webhooks stay reachable during limiter outages via the bounded fallback", async () => {
    const proxy = __createProxyForTests({
      enforceOptions: { limiters: { webhook: throwingLimiter() }, isProduction: false },
    });
    const res = await proxy(
      apiRequest("/api/webhooks/shopee", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.11" },
        body: JSON.stringify({ probe: true }),
      }),
    );
    assert.equal(res.status, 200, "signed webhook handlers must receive traffic to verify signatures");
  });

  it("fails closed with retryable 503 when Looker hits a production limiter outage", async () => {
    const proxy = __createProxyForTests({
      enforceOptions: { limiters: { "external-looker": throwingLimiter() }, isProduction: true },
    });
    const res = await proxy(apiRequest("/api/looker-studio", {
      headers: { authorization: "Bearer key_123" },
    }));
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("retry-after"), "30");
  });

  it("applies the credential class to password/reset endpoints", async () => {
    const proxy = __createProxyForTests({
      enforceOptions: { limiters: { credential: denyLimiter() }, isProduction: true },
    });
    const res = await proxy(
      apiRequest("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.44" },
        body: JSON.stringify({}),
      }),
    );
    assert.equal(res.status, 429);
  });

  it("leaves NextAuth internals untouched", async () => {
    const proxy = __createProxyForTests({
      enforceOptions: { limiters: {}, isProduction: true },
    });
    const res = await proxy(apiRequest("/api/auth/callback/google"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("retry-after"), null);
  });
});

describe("matcher contract", () => {
  const asMatcherRegex = (pattern: string) => new RegExp(`^${pattern}$`);

  it("excludes NextAuth internals but includes credential endpoints", () => {
    const apiPattern = config.matcher[0];
    const rx = asMatcherRegex(apiPattern);
    assert.match("/api/cron/master", rx);
    assert.match("/api/workspaces", rx);
    assert.doesNotMatch("/api/auth/callback/google", rx);
    assert.doesNotMatch("/api/auth/session", rx);

    const credentialPatterns = config.matcher.slice(1, 6);
    for (const endpoint of [
      "/api/auth/forgot-password",
      "/api/auth/register",
      "/api/auth/resend-otp",
      "/api/auth/reset-password",
      "/api/auth/verify",
    ]) {
      assert.ok(
        credentialPatterns.some((pattern) => asMatcherRegex(pattern).test(endpoint)),
        `${endpoint} must be matched for credential limiting`,
      );
    }
  });

  it("uses a broad page catch-all so new app routes are covered by default", () => {
    const pagePattern = config.matcher[config.matcher.length - 1];
    const rx = asMatcherRegex(pagePattern);
    assert.match("/console", rx);
    assert.match("/brand-new-app-page", rx);
    assert.match("/agencies/acme/console", rx);
    assert.doesNotMatch("/api/workspaces", rx, "API routes have their own matcher");
    assert.doesNotMatch("/_next/static/chunk.js", rx);
    assert.match("/og.png", rx, "static files match but are short-circuited in code");
  });
});
