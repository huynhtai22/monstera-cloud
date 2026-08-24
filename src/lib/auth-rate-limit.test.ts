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
});
