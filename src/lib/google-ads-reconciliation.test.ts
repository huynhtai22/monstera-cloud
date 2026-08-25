import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reconcileGoogleAdsTotals } from "./google-ads-reconciliation";

const context = {
  customerId: "1234567890",
  since: "2026-08-01",
  until: "2026-08-07",
  accountTimeZone: "Asia/Ho_Chi_Minh",
  currency: "VND",
  campaignScope: "non-removed campaigns",
  conversionSemantics: "Google Ads conversions",
};

const totals = {
  spend: 100,
  impressions: 1000,
  clicks: 50,
  conversions: 4,
  conversionValue: 200,
  campaignCount: 2,
};

describe("Google Ads reconciliation", () => {
  it("preserves a matched reporting context and reports metric variance", () => {
    const result = reconcileGoogleAdsTotals({
      providerContext: context,
      warehouseContext: context,
      providerTotals: totals,
      warehouseTotals: { ...totals, spend: 99, clicks: 55 },
    });
    assert.equal(result.contextMatches, true);
    assert.deepEqual(result.contextMismatches, []);
    assert.deepEqual(result.metrics.find((metric) => metric.metric === "spend"), {
      metric: "spend",
      provider: 100,
      warehouse: 99,
      absoluteVariance: 1,
      percentVariance: 1,
    });
  });

  it("fails comparison readiness when account, timezone, or semantics differ", () => {
    const result = reconcileGoogleAdsTotals({
      providerContext: context,
      warehouseContext: {
        ...context,
        customerId: "different",
        accountTimeZone: "UTC",
        conversionSemantics: "All conversions",
      },
      providerTotals: totals,
      warehouseTotals: totals,
    });
    assert.equal(result.contextMatches, false);
    assert.deepEqual(result.contextMismatches, [
      "customerId",
      "accountTimeZone",
      "conversionSemantics",
    ]);
  });
});
