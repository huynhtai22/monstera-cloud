import assert from "node:assert";
import { describe, it } from "node:test";
import { extractShopeeAdsPerformanceRows, chunkDateRangeIntoMonths } from "@/lib/shopee";
import {
  generateShopeeBreakdownHash,
  mapShopeeRowToCampaignMetricPayload,
  mapShopeeProductDailyToCampaignMetricPayload,
  parseShopeeAdsRowDate,
  resolveShopeeAdsRowLevel,
} from "@/lib/shopee-ads-mapper";
import { mockShopeeAdsCpcDailyResponse } from "@/lib/mocks/shopee-ads-cpc-daily.mock";

describe("shopee-ads-mapper", () => {
  it("parseShopeeAdsRowDate supports DD-MM-YYYY and YYYY-MM-DD", () => {
    const dmy = parseShopeeAdsRowDate({ date: "15-01-2026" });
    assert.ok(dmy);
    assert.equal(dmy!.toISOString().slice(0, 10), "2026-01-15");

    const ymd = parseShopeeAdsRowDate({ date: "2026-01-15" });
    assert.equal(ymd!.toISOString().slice(0, 10), "2026-01-15");
  });

  it("generateShopeeBreakdownHash returns none when no extra dims", () => {
    assert.equal(generateShopeeBreakdownHash({}), "none");
  });

  it("resolveShopeeAdsRowLevel prefers ad when ad_id present", () => {
    assert.equal(
      resolveShopeeAdsRowLevel({ campaign_id: 1, ad_id: 99 }),
      "ad"
    );
    assert.equal(resolveShopeeAdsRowLevel({ campaign_id: 1 }), "campaign");
    assert.equal(resolveShopeeAdsRowLevel({}), null);
  });

  it("maps mock rows to distinct campaign entities", () => {
    const { response } = mockShopeeAdsCpcDailyResponse({
      daysYmd: ["2026-01-10"],
    });
    const rows = extractShopeeAdsPerformanceRows({ response });
    assert.ok(rows.length >= 2);

    const payloads = rows
      .map((raw) =>
        mapShopeeRowToCampaignMetricPayload({
          workspaceId: "ws_test",
          connectionId: "conn_test",
          accountId: "123",
          accountName: "Shop 123",
          row: raw as Record<string, unknown>,
        })
      )
      .filter(Boolean);

    const entityIds = new Set(payloads.map((p) => p!.entityId));
    assert.ok(entityIds.size >= 2);
    assert.ok(
      payloads.some((p) => p!.level === "campaign" && p!.entityId === "100001")
    );
    assert.ok(payloads.some((p) => p!.level === "ad" && p!.entityId === "50001"));
  });

  it("reads the documented ads_performance_list response without fabricating empty metrics", () => {
    const rows = extractShopeeAdsPerformanceRows({
      response: {
        ads_performance_list: [{ date: "10-01-2026", campaign_id: 210343, impression: 19, click: 2, expense: 3.5 }],
      },
    });
    assert.equal(rows.length, 1);
    const mapped = mapShopeeRowToCampaignMetricPayload({
      workspaceId: "ws", connectionId: "conn", accountId: "227420569", accountName: "Shopee shop 227420569",
      row: rows[0] as Record<string, unknown>,
    });
    assert.ok(mapped);
    assert.equal(mapped!.impressions, 19);
    assert.equal(mapped!.clicks, 2);
    assert.equal(mapped!.spend, 3.5);
  });

  it("preserves a valid empty Ads response as zero source rows", () => {
    assert.deepEqual(extractShopeeAdsPerformanceRows({ response: { ads_performance_list: [] } }), []);
  });

  it("computes cpc/ctr/roas when API omits ratios", () => {
    const payload = mapShopeeRowToCampaignMetricPayload({
      workspaceId: "ws",
      connectionId: "c",
      accountId: "1",
      accountName: "S",
      row: {
        date: "10-01-2026",
        campaign_id: 42,
        campaign_name: "Test",
        impression: 1000,
        clicks: 50,
        expense: 25,
        broad_gmv: 100,
        broad_order: 3,
      },
    });
    assert.ok(payload);
    assert.equal(payload!.cpc, 0.5);
    assert.equal(payload!.ctr, 0.05);
    assert.equal(payload!.roas, 4);
    assert.equal(payload!.currency, "VND");
    assert.equal(payload!.breakdownHash, "none");
  });

  it("maps product daily metrics with broad/direct breakdowns and keyword settings disclosure", () => {
    const payload = mapShopeeProductDailyToCampaignMetricPayload({
      workspaceId: "ws_vn",
      connectionId: "conn_vn",
      accountId: "888888",
      accountName: "Shopee VN Shop 888888",
      metric: {
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
      },
      setting: {
        campaign_id: 99901,
        campaign_name: "Ao Thun Nam Basic",
        campaign_status: "ongoing",
        ad_type: "SEARCH",
        item_id: 1234567,
        item_name: "Ao Thun Cotton 100%",
        budget: 500000,
        bidding_method: "manual",
        keyword_list: [
          { keyword: "ao thun", match_type: "broad", status: "normal", bid_price: 1500 },
          { keyword: "ao thun nam", match_type: "exact", status: "normal", bid_price: 2000 },
        ],
      },
      syncJobId: "job-shopee-vn-1",
    });

    assert.ok(payload);
    assert.equal(payload!.platform, "shopee");
    assert.equal(payload!.level, "ad");
    assert.equal(payload!.entityId, "1234567");
    assert.equal(payload!.campaignId, "99901");
    assert.equal(payload!.campaignName, "Ao Thun Nam Basic");
    assert.equal(payload!.adsetName, "Ao Thun Cotton 100%");
    assert.equal(payload!.spend, 240000);
    assert.equal(payload!.impressions, 5000);
    assert.equal(payload!.clicks, 120);
    assert.equal(payload!.conversions, 10);
    assert.equal(payload!.revenue, 1800000);
    assert.equal(payload!.roas, 7.5);
    assert.equal(payload!.currency, "VND");

    const raw = payload!.rawData as any;
    assert.equal(raw.source, "shopee_product_campaign_daily");
    assert.equal(raw.region, "VN");
    assert.equal(raw.broad_metrics.orders, 10);
    assert.equal(raw.broad_metrics.units_sold, 15);
    assert.equal(raw.broad_metrics.gmv, 1800000);
    assert.equal(raw.direct_metrics.orders, 8);
    assert.equal(raw.direct_metrics.units_sold, 12);
    assert.equal(raw.keyword_settings_count, 2);
    assert.equal(raw.keyword_settings[0].keyword, "ao thun");
    assert.ok(raw.keyword_performance_note.includes("Shopee API exposes keyword configuration only"));
  });

  it("chunkDateRangeIntoMonths correctly splits ranges exceeding 30 days", () => {
    const chunks = chunkDateRangeIntoMonths("2026-01-01", "2026-03-15", 30);
    assert.ok(chunks.length >= 3);
    assert.equal(chunks[0].since, "2026-01-01");
    assert.equal(chunks[0].until, "2026-01-30");
    assert.equal(chunks[chunks.length - 1].until, "2026-03-15");
  });
});
