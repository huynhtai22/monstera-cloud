import assert from "node:assert";
import { describe, it } from "node:test";
import { extractShopeeAdsPerformanceRows } from "@/lib/shopee";
import {
  generateShopeeBreakdownHash,
  mapShopeeRowToCampaignMetricPayload,
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
    assert.equal(payload!.breakdownHash, "none");
  });
});
