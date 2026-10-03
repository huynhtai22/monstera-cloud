import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { allowAuthAttempt } from "./auth-rate-limit";

const ENV_NAMES = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const;
let previousEnv: Record<(typeof ENV_NAMES)[number], string | undefined>;

describe("auth rate-limit fallback", () => {
  beforeEach(() => {
    previousEnv = {
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    };
    process.env.UPSTASH_REDIS_REST_URL = "[SENSITIVE]";
    process.env.UPSTASH_REDIS_REST_TOKEN = "[SENSITIVE]";
  });

  afterEach(() => {
    for (const name of ENV_NAMES) {
      const value = previousEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("keeps the in-memory fallback bounded when Redis config is unavailable", async () => {
    const request = new Request("https://app.example.test/api/auth/test", {
      headers: { "x-forwarded-for": "192.0.2.44" },
    });
    const input = {
      request,
      action: "placeholder_fallback_regression",
      identity: "user@example.test",
      limit: 2,
      windowSeconds: 60,
    };

    assert.equal(await allowAuthAttempt(input), true);
    assert.equal(await allowAuthAttempt(input), true);
    assert.equal(await allowAuthAttempt(input), false);
  });

  it("strictly preserves input limit in production or unconfigured environments", async () => {
    const request = new Request("https://app.example.test/api/auth/test");
    const input = {
      request,
      action: "login_standard",
      identity: "standard@example.test",
      limit: 10,
      windowSeconds: 60,
    };
    const prodEnv = { NODE_ENV: "production" };

    for (let i = 0; i < 10; i++) {
      assert.equal(await allowAuthAttempt(input, prodEnv), true);
    }
    assert.equal(await allowAuthAttempt(input, prodEnv), false);
  });

  it("fails closed when an isolation flag is set alongside production markers", async () => {
    const request = new Request("https://app.example.test/api/auth/test");
    const input = {
      request,
      action: "login_tampered",
      identity: "tampered@example.test",
      limit: 3,
      windowSeconds: 60,
    };
    const tamperedEnv = {
      MONSTERA_E2E_ISOLATED: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/monstera_e2e",
    };

    for (let i = 0; i < 3; i++) {
      assert.equal(await allowAuthAttempt(input, tamperedEnv), true);
    }
    assert.equal(await allowAuthAttempt(input, tamperedEnv), false);
  });

  it("elevates the limit in verified isolated E2E while remaining bounded", async () => {
    const request = new Request("https://app.example.test/api/auth/test");
    const input = {
      request,
      action: "login_e2e",
      identity: "e2e-user@example.test",
      limit: 10,
      windowSeconds: 60,
    };
    const validE2eEnv = {
      MONSTERA_E2E_ISOLATED: "1",
      CLIENT_ASSIGNMENT_TEST_DB: "1",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/monstera_e2e",
      GIT_COMMIT_SHA: "154ca55b2afe27345d170fccfc4e773df3939310",
      NEXTAUTH_URL: "http://127.0.0.1:3000",
      NODE_ENV: "test",
    };

    // Valid isolated E2E permits more than 10 attempts
    for (let i = 0; i < 15; i++) {
      assert.equal(await allowAuthAttempt(input, validE2eEnv), true);
    }
  });
});
