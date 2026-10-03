import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REPORTING_METRIC_CATALOG } from "./reporting-contracts";

describe("Shopee Advertising vs Marketplace Order Semantics", () => {
  it("strictly separates marketplace orders from ad platform conversions in catalog", () => {
    const mo = REPORTING_METRIC_CATALOG.marketplace_orders;
    const conv = REPORTING_METRIC_CATALOG.conversions;
    const mr = REPORTING_METRIC_CATALOG.marketplace_revenue;
    const roas = REPORTING_METRIC_CATALOG.roas;

    assert.ok(mo.semanticLimitations.some((s) => s.includes("separate from ad-platform conversions")));
    assert.ok(mr.semanticLimitations.some((s) => s.includes("separate from ad-attributed conversion value")));
    assert.ok(conv.semanticLimitations.some((s) => s.includes("NOT be claimed as unique buyers")));
    assert.ok(roas.semanticLimitations.some((s) => s.includes("identical currency scope")));
  });

  it("discriminates Shopee daily order rollups from Shopee v2.ads performance rows", () => {
    // Fixtures representing actual warehouse ingestion
    const marketplaceOrderRollupRow = {
      platform: "shopee",
      accountId: "shop_12345",
      level: "campaign",
      entityId: "shopee-orders-daily",
      campaignId: "shopee-orders-daily",
      campaignName: "Shopee orders (daily rollup)",
      breakdownHash: "day_orders",
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 45, // 45 shop orders
      revenue: 12500000, // 12.5M VND shop GMV
      currency: "VND",
    };

    const shopeeAdsPerformanceRow = {
      platform: "shopee",
      accountId: "shop_12345",
      level: "campaign",
      entityId: "camp_987654",
      campaignId: "camp_987654",
      campaignName: "Shopee Discovery Ads Campaign",
      breakdownHash: "none",
      spend: 1500000, // 1.5M VND ad expense
      impressions: 25000,
      clicks: 800,
      conversions: 12, // 12 ad-attributed orders (broad_order)
      revenue: 3600000, // 3.6M VND ad-attributed GMV (broad_gmv)
      currency: "VND",
    };

    // Helper implementing the strict discrimination rule
    function classifyRow(row: typeof marketplaceOrderRollupRow) {
      const isRollup =
        (row.platform === "shopee" || row.platform === "lazada") &&
        (row.campaignId === `${row.platform}-orders-daily` ||
          row.entityId === `${row.platform}-orders-daily` ||
          row.breakdownHash === "day_orders");

      const isAd =
        row.platform !== "shopee" && row.platform !== "lazada"
          ? true
          : !isRollup && (row.spend > 0 || row.impressions > 0 || row.clicks > 0);

      const isAmbiguous =
        !isRollup && !isAd && (row.platform === "shopee" || row.platform === "lazada") &&
        (row.revenue > 0 || row.conversions > 0);

      return { isRollup, isAd, isAmbiguous };
    }

    const cRollup = classifyRow(marketplaceOrderRollupRow);
    assert.equal(cRollup.isRollup, true);
    assert.equal(cRollup.isAd, false);
    assert.equal(cRollup.isAmbiguous, false);

    const cAd = classifyRow(shopeeAdsPerformanceRow);
    assert.equal(cAd.isRollup, false);
    assert.equal(cAd.isAd, true);
    assert.equal(cAd.isAmbiguous, false);

    // Test ambiguous row (missing ads indicators and missing rollup tags)
    const ambiguousRow = {
      platform: "shopee",
      accountId: "shop_12345",
      level: "campaign",
      entityId: "unknown_entity",
      campaignId: "unknown_campaign",
      campaignName: "Unlabeled Shopee Stream",
      breakdownHash: "none",
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 5,
      revenue: 2000000,
      currency: "VND",
    };

    const cAmbiguous = classifyRow(ambiguousRow);
    assert.equal(cAmbiguous.isRollup, false);
    assert.equal(cAmbiguous.isAd, false);
    assert.equal(cAmbiguous.isAmbiguous, true);
  });
});
