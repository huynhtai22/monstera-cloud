import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { NodeRedisClient } from "./node-redis";
import { getCachedQuery, setCachedQuery } from "./redis-cache";

const ENV_NAMES = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const;
let previousEnv: Record<(typeof ENV_NAMES)[number], string | undefined>;

describe("optional Node Redis cache", () => {
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

  it("bypasses reads and writes when production build config is unavailable", async () => {
    assert.equal(await getCachedQuery("looker:test"), null);
    await assert.doesNotReject(setCachedQuery("looker:test", { ok: true }, 60));
  });

  it("keeps cache transport failures non-fatal", async () => {
    const redis = {
      get: async () => {
        throw new Error("cache unavailable");
      },
      set: async () => {
        throw new Error("cache unavailable");
      },
    } as unknown as NodeRedisClient;
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.equal(await getCachedQuery("looker:test", redis), null);
      await assert.doesNotReject(setCachedQuery("looker:test", { ok: true }, 60, redis));
    } finally {
      console.error = originalError;
    }
  });
});
