import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseStrictDateOnly,
  getCanonicalDateRange,
} from "./warehouse-date-range";
import {
  buildAccountFilterPredicate,
  appendWherePredicate,
} from "./warehouse-account-filter";
import {
  generateMetricsQueryCacheKey,
  getWorkspaceMetricsGeneration,
  invalidateWorkspaceMetricsCache,
} from "./redis-cache";
import { clampTimeRangeToPlanMaxDays, getPlanLimits } from "./plan-config";

describe("P2-1: Provider-Aware Account Normalization", () => {
  it("Meta query 12345 matches act_12345 and vice versa", () => {
    const pred1 = buildAccountFilterPredicate({
      accountIds: ["12345"],
      platform: "meta_ads",
    });
    assert.deepEqual(pred1, {
      accountId: { in: ["12345", "act_12345"] },
    });

    const pred2 = buildAccountFilterPredicate({
      accountIds: ["act_12345"],
      platform: "meta_ads",
    });
    assert.deepEqual(pred2, {
      accountId: { in: ["act_12345", "12345"] },
    });
  });

  it("Google query 12345 does NOT expand to act_12345", () => {
    const pred = buildAccountFilterPredicate({
      accountIds: ["12345"],
      platform: "google_ads",
    });
    assert.deepEqual(pred, {
      accountId: "12345",
    });
  });

  it("TikTok and Shopee receive no act_ expansion", () => {
    const predTikTok = buildAccountFilterPredicate({
      accountIds: ["tt_999", "12345"],
      platform: "tiktok_business",
    });
    assert.deepEqual(predTikTok, {
      accountId: { in: ["tt_999", "12345"] },
    });

    const predShopee = buildAccountFilterPredicate({
      accountIds: ["shop_777"],
      platform: "shopee",
    });
    assert.deepEqual(predShopee, {
      accountId: "shop_777",
    });
  });

  it("Mixed Meta + Google scope returns only properly qualified rows", () => {
    const pred = buildAccountFilterPredicate({
      accountIds: ["12345"],
      platforms: ["google_ads", "meta_ads"],
    });
    assert.deepEqual(pred, {
      OR: [
        { accountId: "12345" },
        { platform: "meta_ads", accountId: "act_12345" },
      ],
    });
  });

  it("No-platform query qualifies Meta variants so other providers are not broadened", () => {
    const pred = buildAccountFilterPredicate({
      accountIds: ["12345"],
    });
    assert.deepEqual(pred, {
      OR: [
        { accountId: "12345" },
        { platform: "meta_ads", accountId: "act_12345" },
      ],
    });
  });

  it("Preserves existing client assignment OR predicate without overwriting it", () => {
    const where: Record<string, any> = {
      workspaceId: "ws-1",
      OR: [
        { connectionId: "conn-1", platform: "meta_ads", accountId: "act_123" },
        { connectionId: "conn-2", platform: "google_ads", accountId: "456" },
      ],
    };
    const pred = buildAccountFilterPredicate({
      accountIds: ["12345"],
    });
    appendWherePredicate(where, pred);

    // Existing OR must be preserved
    assert.ok(Array.isArray(where.OR), "where.OR should still exist");
    assert.equal(where.OR.length, 2);
    // Compound predicate appended to AND
    assert.ok(Array.isArray(where.AND), "where.AND must be created");
    assert.equal(where.AND.length, 1);
    assert.deepEqual(where.AND[0], pred);
  });
});

describe("P2-2: Multi-Tenant Redis Cache Isolation & Generation", () => {
  it("Invalidating Workspace A does not evict or affect Workspace B", async () => {
    const store = new Map<string, any>();
    let keysCalled = false;

    const mockRedis: any = {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, val: any) => {
        store.set(key, val);
        return "OK";
      },
      incr: async (key: string) => {
        const cur = Number(store.get(key) ?? 0);
        const next = cur + 1;
        store.set(key, next);
        return next;
      },
      del: async (key: string) => {
        store.delete(key);
        return 1;
      },
      keys: async () => {
        keysCalled = true;
        return Array.from(store.keys());
      },
    };

    const wsA = "workspace-alpha";
    const wsB = "workspace-beta";

    // Initial generations
    const genA1 = await getWorkspaceMetricsGeneration(wsA, mockRedis);
    const genB1 = await getWorkspaceMetricsGeneration(wsB, mockRedis);
    assert.equal(genA1, 1);
    assert.equal(genB1, 1);

    // Store cached values for both workspaces
    const keyA1 = generateMetricsQueryCacheKey(wsA, genA1, { query: "A" });
    const keyB1 = generateMetricsQueryCacheKey(wsB, genB1, { query: "B" });
    store.set(keyA1, JSON.stringify({ data: "A-cached" }));
    store.set(keyB1, JSON.stringify({ data: "B-cached" }));

    // Invalidate Workspace A
    await invalidateWorkspaceMetricsCache(wsA, mockRedis);

    // Assert KEYS was NOT called (non-blocking)
    assert.equal(keysCalled, false, "Redis KEYS must never be invoked");

    // Workspace A generation advances; old key is unreachable
    const genA2 = await getWorkspaceMetricsGeneration(wsA, mockRedis);
    assert.equal(genA2, 2);
    const keyA2 = generateMetricsQueryCacheKey(wsA, genA2, { query: "A" });
    assert.notEqual(keyA1, keyA2);

    // Workspace B generation and cache entry remain intact
    const genB2 = await getWorkspaceMetricsGeneration(wsB, mockRedis);
    assert.equal(genB2, 1, "Workspace B generation must remain 1");
    const cachedB = store.get(keyB1);
    assert.ok(cachedB, "Workspace B cache entry must still exist");
    assert.deepEqual(JSON.parse(cachedB), { data: "B-cached" });
  });

  it("Degrades safely when Redis is unavailable without throwing", async () => {
    const brokenRedis: any = {
      get: async () => {
        throw new Error("Connection refused");
      },
      incr: async () => {
        throw new Error("Connection refused");
      },
    };

    const gen = await getWorkspaceMetricsGeneration("ws-err", brokenRedis);
    assert.equal(gen, 1, "Must default to generation 1 on Redis error");

    await assert.doesNotReject(async () => {
      await invalidateWorkspaceMetricsCache("ws-err", brokenRedis);
    }, "Must not throw when Redis fails");
  });
});

describe("P2-3: Single Canonical Date-Only Range Helper", () => {
  it("Validates and normalizes 1–5 May 2026 into half-open interval", () => {
    const range = getCanonicalDateRange("2026-05-01", "2026-05-05");
    assert.equal(range.since, "2026-05-01");
    assert.equal(range.until, "2026-05-05");
    assert.equal(range.startUtc.toISOString(), "2026-05-01T00:00:00.000Z");
    assert.equal(range.endUtcExclusive.toISOString(), "2026-05-06T00:00:00.000Z");

    assert.deepEqual(range.dbWhereDate, {
      gte: new Date("2026-05-01T00:00:00.000Z"),
      lt: new Date("2026-05-06T00:00:00.000Z"),
    });
  });

  it("Includes 1 May, 5 May midnight and 5 May late-day; excludes 6 May", () => {
    const range = getCanonicalDateRange("2026-05-01", "2026-05-05");
    const { gte, lt } = range.dbWhereDate;

    const dMay1 = new Date("2026-05-01T00:00:00.000Z");
    const dMay5Midnight = new Date("2026-05-05T00:00:00.000Z");
    const dMay5LateDay = new Date("2026-05-05T23:59:59.999Z");
    const dMay6 = new Date("2026-05-06T00:00:00.000Z");
    const dApr30 = new Date("2026-04-30T23:59:59.999Z");

    assert.ok(dMay1 >= gte && dMay1 < lt, "1 May midnight must be included");
    assert.ok(dMay5Midnight >= gte && dMay5Midnight < lt, "5 May midnight must be included");
    assert.ok(dMay5LateDay >= gte && dMay5LateDay < lt, "5 May late day must be included");
    assert.ok(!(dMay6 < lt), "6 May must be excluded");
    assert.ok(!(dApr30 >= gte), "30 April must be excluded");
  });

  it("Rejects impossible dates like 2026-02-30", () => {
    assert.equal(parseStrictDateOnly("2026-02-30"), null);
    assert.throws(
      () => getCanonicalDateRange("2026-02-01", "2026-02-30"),
      /Invalid calendar date/
    );
  });

  it("Rejects timestamps where date-only values are expected", () => {
    assert.equal(parseStrictDateOnly("2026-05-01T00:00:00Z"), null);
    assert.throws(
      () => getCanonicalDateRange("2026-05-01T00:00:00Z", "2026-05-05"),
      /Invalid calendar date/
    );
  });

  it("Rejects reversed ranges where startDate > endDate", () => {
    assert.throws(
      () => getCanonicalDateRange("2026-05-10", "2026-05-05"),
      /startDate must be before or equal to endDate/
    );
  });
});

describe("Plan Limits and Clamping Contracts", () => {
  it("Professional plan leaves 5-day range unclamped", () => {
    const limits = getPlanLimits("professional");
    assert.equal(limits.maxHistoryDays, undefined, "Professional plan should have unlimited maxHistoryDays");

    const clamped = clampTimeRangeToPlanMaxDays("professional", {
      since: "2026-05-01",
      until: "2026-05-05",
    });
    assert.equal(clamped.clamped, false);
    assert.equal(clamped.since, "2026-05-01");
    assert.equal(clamped.until, "2026-05-05");
  });

  it("Free plan clamps 30-day range to 14 days", () => {
    const limits = getPlanLimits("free");
    assert.equal(limits.maxHistoryDays, 14, "Free plan maxHistoryDays is 14");

    const clamped = clampTimeRangeToPlanMaxDays("free", {
      since: "2026-04-01",
      until: "2026-05-05",
    });
    assert.equal(clamped.clamped, true);
    assert.equal(clamped.until, "2026-05-05");
    assert.equal(clamped.since, "2026-04-21");
  });
});
