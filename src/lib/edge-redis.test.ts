import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { createEdgeRedis } from "./edge-redis";

type InspectableRedis = {
  client: {
    baseUrl: string;
    headers: Record<string, string>;
    hasCredentials: boolean;
  };
};

describe("Vercel Edge Redis construction", () => {
  it("passes the explicit runtime URL and token to the Redis constructor", () => {
    const url = "https://example.invalid";
    const token = "test-token";
    const client = createEdgeRedis({
      UPSTASH_REDIS_REST_URL: url,
      UPSTASH_REDIS_REST_TOKEN: token,
    }) as (ReturnType<typeof createEdgeRedis> & InspectableRedis) | null;

    assert.ok(client);
    assert.equal(client.client.baseUrl, url);
    assert.equal(client.client.headers.authorization, `Bearer ${token}`);
    assert.equal(client.client.hasCredentials, true);
  });

  it("returns null unless both runtime values are configured", () => {
    assert.equal(createEdgeRedis({}), null);
    assert.equal(createEdgeRedis({ UPSTASH_REDIS_REST_URL: "https://example.invalid" }), null);
    assert.equal(createEdgeRedis({ UPSTASH_REDIS_REST_TOKEN: "test-token" }), null);
  });

  it("keeps every Edge Redis consumer off zero-argument Cloudflare fromEnv", async () => {
    for (const relativePath of [
      "./request-rate-limit-policy.ts",
      "./ratelimit.ts",
      "./redis-cache.ts",
    ]) {
      const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
      assert.doesNotMatch(source, /Redis\.fromEnv\s*\(\s*\)/, relativePath);
      assert.match(source, /createEdgeRedis/, relativePath);
    }
  });
});
