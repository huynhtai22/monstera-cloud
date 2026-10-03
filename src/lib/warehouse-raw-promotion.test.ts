import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { normalizeMetaAdName } from "./meta-sync-lock";
import { resolveWarehouseAdName } from "./warehouse-query";
import {
  mapShopeeProductDailyToCampaignMetricPayload,
  mapShopeeRowToCampaignMetricPayload,
} from "./shopee-ads-mapper";
import { resolveShopeeRowPerformance } from "./shopee-performance-fields";
import { ADS_FIELDS_BY_ID } from "./ads-field-registry";
import { measureCampaignMetricRawRetention } from "./warehouse-raw-retention";

const PRODUCT_METRIC = {
  date: "2026-02-01",
  campaign_id: 99901,
  campaign_name: "Ao Thun Nam Basic",
  item_id: 1234567,
  item_name: "Ao Thun Cotton 100%",
  ad_type: "SEARCH",
  impression: 5000,
  clicks: 120,
  ctr: 0.024,
  expense: 240000,
  broad_order: 10,
  broad_order_amount: 15,
  broad_gmv: 1800000,
  broad_roas: 7.5,
  broad_cir: 0.133,
  broad_cr: 0.083,
  broad_cost_per_conversion: 24000,
  direct_order: 8,
  direct_order_amount: 12,
  direct_gmv: 1500000,
  direct_roas: 6.25,
  direct_cir: 0.16,
  direct_cr: 0.067,
  direct_cost_per_conversion: 30000,
} as any;

const BASE_PARAMS = {
  workspaceId: "ws_vn",
  connectionId: "conn_vn",
  accountId: "888888",
  accountName: "Shopee VN Shop 888888",
} as const;

describe("Meta adName promotion (unit)", () => {
  it("normalizes ad names exactly like the legacy rawData reader", () => {
    assert.equal(normalizeMetaAdName("Summer Sale"), "Summer Sale");
    assert.equal(normalizeMetaAdName("  Padded  "), "  Padded  ", "legacy output preserves the original string");
    assert.equal(normalizeMetaAdName(""), null);
    assert.equal(normalizeMetaAdName("   "), null);
    assert.equal(normalizeMetaAdName(undefined), null);
    assert.equal(normalizeMetaAdName(null), null);
    assert.equal(normalizeMetaAdName(42), null);
  });

  it("prefers the promoted column, then legacy rawData, then null", () => {
    assert.equal(resolveWarehouseAdName("Promoted", '{"ad_name":"Legacy"}'), "Promoted");
    assert.equal(resolveWarehouseAdName(null, '{"ad_name":"Legacy"}'), "Legacy");
    assert.equal(resolveWarehouseAdName(null, null), null);
    assert.equal(resolveWarehouseAdName(null, "{ malformed"), null, "malformed JSON cannot crash fallback");
    assert.equal(resolveWarehouseAdName(null, '{"ad_name":"  "}'), null);
    assert.equal(resolveWarehouseAdName(null, '{"other":1}'), null);
  });
});

describe("Shopee promoted columns (unit)", () => {
  it("writes every broad/direct/keyword output field to promoted columns", () => {
    const payload = mapShopeeProductDailyToCampaignMetricPayload({ ...BASE_PARAMS, metric: PRODUCT_METRIC })!;
    assert.equal(payload.shopeeBroadOrders, 10);
    assert.equal(payload.shopeeBroadUnits, 15);
    assert.equal(payload.shopeeBroadGmv, 1800000);
    assert.equal(payload.shopeeDirectOrders, 8);
    assert.equal(payload.shopeeDirectUnits, 12);
    assert.equal(payload.shopeeDirectGmv, 1500000);
    assert.equal(payload.shopeeKeywordSettingsCount, 0);
    assert.ok(payload.rawData, "rawData is preserved alongside promoted columns");
  });

  it("treats numeric zero as a valid promoted value, missing as null", () => {
    const zeroed = mapShopeeProductDailyToCampaignMetricPayload({
      ...BASE_PARAMS,
      metric: { ...PRODUCT_METRIC, broad_order: 0, broad_order_amount: 0, broad_gmv: 0, direct_order: 0, direct_gmv: 0 },
    })!;
    assert.equal(zeroed.shopeeBroadOrders, 0, "zero must survive nullish fallback");
    assert.equal(zeroed.shopeeBroadUnits, 0);
    assert.equal(zeroed.shopeeBroadGmv, 0);
    assert.equal(zeroed.shopeeDirectOrders, 0);

    const missing = mapShopeeProductDailyToCampaignMetricPayload({
      ...BASE_PARAMS,
      metric: { ...PRODUCT_METRIC, broad_order: undefined, broad_gmv: undefined, direct_order: undefined },
    })!;
    assert.equal(missing.shopeeBroadOrders, null, "absent source falls back instead of manufacturing zero");
    assert.equal(missing.shopeeBroadGmv, null);
    assert.equal(missing.shopeeDirectOrders, null);
  });

  it("never swaps broad and direct metrics", () => {
    const payload = mapShopeeProductDailyToCampaignMetricPayload({
      ...BASE_PARAMS,
      metric: { ...PRODUCT_METRIC, broad_order: 111, direct_order: 222, broad_gmv: 333, direct_gmv: 444 },
    })!;
    assert.equal(payload.shopeeBroadOrders, 111);
    assert.equal(payload.shopeeDirectOrders, 222);
    assert.equal(payload.shopeeBroadGmv, 333);
    assert.equal(payload.shopeeDirectGmv, 444);
  });

  it("preserves keyword count zero versus unknown", () => {
    const withKeywords = mapShopeeProductDailyToCampaignMetricPayload({
      ...BASE_PARAMS,
      metric: PRODUCT_METRIC,
      setting: { campaign_id: 99901, campaign_name: "x", campaign_status: "ongoing", ad_type: "SEARCH", keyword_list: [{ keyword: "a", match_type: "broad", status: "normal", bid_price: 1 }] },
    })!;
    assert.equal(withKeywords.shopeeKeywordSettingsCount, 1);
    const v2 = mapShopeeRowToCampaignMetricPayload({
      ...BASE_PARAMS,
      row: { date: "2026-02-01", campaign_id: 42, impression: 5, click: 1, expense: 2 },
    })!;
    assert.equal(v2.shopeeKeywordSettingsCount, null, "v2 CPC rows carry no keyword signal");
  });

  it("resolves performance fields promoted-first with legacy fallbacks", () => {
    const promotedRow = {
      conversions: 1, revenue: 2, spend: 100, clicks: 10,
      shopeeBroadOrders: 10, shopeeBroadUnits: 15, shopeeBroadGmv: 1800000,
      shopeeDirectOrders: 8, shopeeDirectUnits: 12, shopeeDirectGmv: 1500000,
      shopeeKeywordSettingsCount: 2,
    };
    const resolved = resolveShopeeRowPerformance(promotedRow, {
      broad_metrics: { orders: 999, units_sold: 999, gmv: 999 },
      direct_metrics: { orders: 999, units_sold: 999, gmv: 999 },
      keyword_settings_count: 999,
    });
    assert.deepEqual(resolved, {
      broadOrders: 10, broadUnits: 15, broadGmv: 1800000,
      directOrders: 8, directUnits: 12, directGmv: 1500000,
      keywordSettingsCount: 2,
    });

    const legacy = resolveShopeeRowPerformance(
      { conversions: 4, revenue: 50, spend: 100, clicks: 10 },
      { broad_metrics: { orders: 4, units_sold: 6, gmv: 50 }, direct_metrics: { orders: 1, units_sold: 2, gmv: 20 }, keyword_settings_count: 3 },
    );
    assert.deepEqual(legacy, {
      broadOrders: 4, broadUnits: 6, broadGmv: 50,
      directOrders: 1, directUnits: 2, directGmv: 20,
      keywordSettingsCount: 3,
    });
  });

  it("falls back field-by-field on partial promotion without mixing values", () => {
    const resolved = resolveShopeeRowPerformance(
      { conversions: 4, revenue: 50, spend: 100, clicks: 10, shopeeBroadOrders: 7, shopeeDirectGmv: 21 },
      { broad_metrics: { orders: 4, units_sold: 6, gmv: 50 }, direct_metrics: { orders: 1, units_sold: 2, gmv: 20 }, keyword_settings_count: 3 },
    );
    assert.equal(resolved.broadOrders, 7, "promoted field wins");
    assert.equal(resolved.broadUnits, 6, "missing promoted field falls back to raw");
    assert.equal(resolved.broadGmv, 50);
    assert.equal(resolved.directGmv, 21, "promoted field wins");
    assert.equal(resolved.directOrders, 1, "missing promoted field falls back to raw");
  });

  it("sanitizes v2 display values like the normalized fields", () => {
    const negative = mapShopeeRowToCampaignMetricPayload({
      ...BASE_PARAMS,
      row: { date: "2026-02-01", campaign_id: 42, impression: 5, click: 1, expense: 2, broad_order: -4, broad_gmv: -9 },
    })!;
    assert.equal(negative.shopeeBroadOrders, 0, "negative v2 orders match sanitized normalized fallback");
    assert.equal(negative.shopeeBroadUnits, 0);
    assert.equal(negative.shopeeBroadGmv, 0);
    assert.equal(negative.conversions, -4, "normalized value is sanitized later at upsert; promoted is sanitized at the mapper");

    const nonFinite = mapShopeeRowToCampaignMetricPayload({
      ...BASE_PARAMS,
      row: { date: "2026-02-01", campaign_id: 42, impression: 5, click: 1, expense: 2, broad_order: Infinity, broad_gmv: Infinity },
    })!;
    assert.equal(nonFinite.shopeeBroadOrders, 0, "non-finite v2 orders match sanitized normalized fallback");
    assert.equal(nonFinite.shopeeBroadGmv, 0);
  });

  it("counts partial Shopee promotion as raw-dependent per field", async () => {
    const { classifyRawDependencyReadiness } = await import("./warehouse-raw-retention");
    const seen: any[] = [];
    const fakeDb = {
      campaignMetric: {
        count: async ({ where }: any) => {
          seen.push(where);
          return 0;
        },
      },
    } as any;
    await classifyRawDependencyReadiness("ws_test", fakeDb);
    const shopeeDependent = seen[2];
    const dump = JSON.stringify(shopeeDependent);
    for (const column of ["shopeeBroadUnits", "shopeeBroadGmv", "shopeeDirectUnits", "shopeeDirectGmv"]) {
      assert.ok(dump.includes(column), `${column} must gate readiness, not just the order column`);
    }
  });

  it("keeps zero valid and null raw working with rawData absent", () => {
    const resolved = resolveShopeeRowPerformance(
      {
        conversions: 0, revenue: 0, spend: 0, clicks: 0,
        shopeeBroadOrders: 0, shopeeBroadUnits: 0, shopeeBroadGmv: 0,
        shopeeDirectOrders: 0, shopeeDirectUnits: 0, shopeeDirectGmv: 0,
        shopeeKeywordSettingsCount: 0,
      },
      {},
    );
    assert.deepEqual(resolved, {
      broadOrders: 0, broadUnits: 0, broadGmv: 0,
      directOrders: 0, directUnits: 0, directGmv: 0,
      keywordSettingsCount: 0,
    });
  });
});

describe("promotion cross-cutting guards (unit)", () => {
  it("keeps promoted columns out of the reporting metric allowlist", () => {
    for (const field of [
      "adName", "shopeeBroadOrders", "shopeeBroadUnits", "shopeeBroadGmv",
      "shopeeDirectOrders", "shopeeDirectUnits", "shopeeDirectGmv", "shopeeKeywordSettingsCount",
    ]) {
      assert.equal((ADS_FIELDS_BY_ID as Record<string, unknown>)[field], undefined, `${field} must not leak into reports/exports`);
    }
  });

  it("keeps retention execution unavailable", async () => {
    const result = await measureCampaignMetricRawRetention(
      { workspaceId: "ws_a", retentionDays: 30, now: new Date("2026-09-18T12:00:00.000Z") },
      { $transaction: async (fn: any) => fn({ $queryRaw: async () => [] }) } as any,
    ).catch(() => null);
    assert.ok(result === null || (result as any).executionAvailable === false, "no retention execution may be enabled");
  });

  it("ships exactly one additive migration with nullable columns and no data statements", () => {
    const dir = join(__dirname, "..", "..", "prisma", "migrations");
    const names = readdirSync(dir).filter((name) => name.includes("raw_promotion"));
    assert.equal(names.length, 1, "exactly one promotion migration");
    const sql = readFileSync(join(dir, names[0], "migration.sql"), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    for (const column of [
      '"adName" TEXT', '"shopeeBroadOrders" DOUBLE PRECISION', '"shopeeBroadUnits" DOUBLE PRECISION',
      '"shopeeBroadGmv" DOUBLE PRECISION', '"shopeeDirectOrders" DOUBLE PRECISION',
      '"shopeeDirectUnits" DOUBLE PRECISION', '"shopeeDirectGmv" DOUBLE PRECISION',
      '"shopeeKeywordSettingsCount" INTEGER',
    ]) {
      assert.ok(sql.includes(`ADD COLUMN ${column}`), `migration adds nullable ${column}`);
    }
    for (const forbidden of ["UPDATE ", "DELETE ", "DROP ", "NOT NULL", "DEFAULT ", "CREATE INDEX", "BACKFILL"]) {
      assert.equal(sql.toUpperCase().includes(forbidden), false, `migration must not contain ${forbidden.trim()}`);
    }
  });
});
