import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { createNodeRedis } from "./node-redis";

type InspectableRedis = {
  client: {
    baseUrl: string;
    headers: Record<string, string>;
    hasCredentials: boolean;
  };
};

describe("Node Redis construction", () => {
  it("passes validated URL and token to the standard Node constructor", () => {
    const url = "https://example.invalid";
    const token = "test-token";
    const client = createNodeRedis({
      UPSTASH_REDIS_REST_URL: url,
      UPSTASH_REDIS_REST_TOKEN: token,
    }) as (ReturnType<typeof createNodeRedis> & InspectableRedis) | null;

    assert.ok(client);
    assert.equal(client.client.baseUrl, url);
    assert.equal(client.client.headers.authorization, `Bearer ${token}`);
    assert.equal(client.client.hasCredentials, true);
  });

  it("returns null for build placeholders", () => {
    assert.equal(
      createNodeRedis({
        UPSTASH_REDIS_REST_URL: "[SENSITIVE]",
        UPSTASH_REDIS_REST_TOKEN: "[SENSITIVE]",
      }),
      null,
    );
  });

  it("removes every executable zero-argument Redis.fromEnv call", async () => {
    for (const relativePath of [
      "./auth-rate-limit.ts",
      "./edge-redis.ts",
      "./node-redis.ts",
      "./ratelimit.ts",
      "./redis-cache.ts",
      "./request-rate-limit-policy.ts",
      "../app/api/looker-studio/route.ts",
      "../app/api/looker-studio/meta/route.ts",
    ]) {
      const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
      assert.doesNotMatch(source, /\b(?:EdgeRedis|NodeRedis|Redis)\.fromEnv\s*\(\s*\)/, relativePath);
    }
  });

  it("keeps Looker meta cache resolution inside the request path", async () => {
    const source = await readFile(
      new URL("../app/api/looker-studio/meta/route.ts", import.meta.url),
      "utf8",
    );
    const handlerStart = source.indexOf("export async function GET");
    const cacheRead = source.indexOf("await getCachedQuery", handlerStart);

    assert.ok(handlerStart >= 0);
    assert.ok(cacheRead > handlerStart);
    assert.doesNotMatch(source.slice(0, handlerStart), /createNodeRedis|getCachedQuery\s*\(/);
  });
});
