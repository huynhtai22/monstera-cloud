import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRedisConfig } from "./redis-config";

describe("Upstash Redis configuration", () => {
  it("returns trimmed HTTPS configuration", () => {
    assert.deepEqual(
      resolveRedisConfig({
        UPSTASH_REDIS_REST_URL: "  https://example.invalid  ",
        UPSTASH_REDIS_REST_TOKEN: "  test-token  ",
      }),
      { url: "https://example.invalid", token: "test-token" },
    );
  });

  it("rejects missing, placeholder, malformed, HTTP, and blank-token values", () => {
    for (const env of [
      {},
      { UPSTASH_REDIS_REST_URL: "https://example.invalid" },
      { UPSTASH_REDIS_REST_TOKEN: "test-token" },
      {
        UPSTASH_REDIS_REST_URL: "[SENSITIVE]",
        UPSTASH_REDIS_REST_TOKEN: "test-token",
      },
      {
        UPSTASH_REDIS_REST_URL: "https://example.invalid",
        UPSTASH_REDIS_REST_TOKEN: "[SENSITIVE]",
      },
      {
        UPSTASH_REDIS_REST_URL: "not a URL",
        UPSTASH_REDIS_REST_TOKEN: "test-token",
      },
      {
        UPSTASH_REDIS_REST_URL: "http://example.invalid",
        UPSTASH_REDIS_REST_TOKEN: "test-token",
      },
      {
        UPSTASH_REDIS_REST_URL: "https://example.invalid",
        UPSTASH_REDIS_REST_TOKEN: "   ",
      },
    ]) {
      assert.equal(resolveRedisConfig(env), null, JSON.stringify(env));
    }
  });
});
