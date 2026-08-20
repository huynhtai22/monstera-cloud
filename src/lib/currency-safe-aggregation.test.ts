import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateCurrencySafe,
  aggregationNeedsCurrencyDimension,
  formatMoneyAmount,
} from "./currency-safe-aggregation";

describe("currency-safe aggregation", () => {
  it("aggregates USD-only spend and ROAS", () => {
    const totals = aggregateCurrencySafe([
      { currency: "USD", spend: 1000, revenue: 2500, impressions: 100, clicks: 10, conversions: 2 },
      { currency: "usd", spend: 200, revenue: 100, impressions: 50, clicks: 5, conversions: 1 },
    ]);
    assert.equal(totals.mixedCurrency, false);
    assert.deepEqual(totals.currencies, ["USD"]);
    assert.equal(totals.byCurrency[0]?.spend, 1200);
    assert.equal(totals.byCurrency[0]?.revenue, 2600);
    assert.equal(totals.byCurrency[0]?.roas, 2600 / 1200);
    assert.equal(totals.impressions, 150);
    assert.equal(totals.clicks, 15);
    assert.equal(totals.conversions, 3);
  });

  it("aggregates VND-only spend", () => {
    const totals = aggregateCurrencySafe([
      { currency: "VND", spend: 20_000_000, revenue: 40_000_000, impressions: 9, clicks: 3, conversions: 1 },
    ]);
    assert.equal(totals.mixedCurrency, false);
    assert.equal(totals.byCurrency[0]?.currency, "VND");
    assert.equal(totals.byCurrency[0]?.spend, 20_000_000);
  });

  it("keeps USD + VND spend separated and never blends 1200 + 35000000", () => {
    const totals = aggregateCurrencySafe([
      { currency: "USD", spend: 1200, revenue: 2400, impressions: 100, clicks: 20, conversions: 4 },
      { currency: "VND", spend: 35_000_000, revenue: 70_000_000, impressions: 80, clicks: 10, conversions: 2 },
    ]);
    assert.equal(totals.mixedCurrency, true);
    const spendByCurrency = Object.fromEntries(totals.byCurrency.map((b) => [b.currency, b.spend]));
    assert.equal(spendByCurrency.USD, 1200);
    assert.equal(spendByCurrency.VND, 35_000_000);
    const blended = totals.byCurrency.reduce((s, b) => s + b.spend, 0);
    assert.equal(blended, 35_001_200);
    assert.ok(!totals.byCurrency.some((b) => b.spend === 35_001_200));
    assert.equal(totals.impressions, 180);
    assert.equal(totals.clicks, 30);
    assert.equal(totals.conversions, 6);
    const usd = totals.byCurrency.find((b) => b.currency === "USD");
    const vnd = totals.byCurrency.find((b) => b.currency === "VND");
    assert.equal(usd?.roas, 2);
    assert.equal(vnd?.roas, 2);
  });

  it("computes ROAS only within each currency group", () => {
    const totals = aggregateCurrencySafe([
      { currency: "USD", spend: 100, revenue: 400 },
      { currency: "VND", spend: 1_000_000, revenue: 500_000 },
    ]);
    const blendedRoas = (400 + 500_000) / (100 + 1_000_000);
    assert.notEqual(totals.byCurrency[0]?.roas, blendedRoas);
    assert.notEqual(totals.byCurrency[1]?.roas, blendedRoas);
    assert.equal(totals.byCurrency.find((b) => b.currency === "USD")?.roas, 4);
    assert.equal(totals.byCurrency.find((b) => b.currency === "VND")?.roas, 0.5);
  });

  it("requires a currency dimension when aggregating monetary metrics", () => {
    assert.equal(aggregationNeedsCurrencyDimension(["date", "platform"], ["spend"]), true);
    assert.equal(aggregationNeedsCurrencyDimension(["date", "currency"], ["spend"]), false);
    assert.equal(aggregationNeedsCurrencyDimension(["date"], ["impressions", "clicks"]), false);
    assert.equal(aggregationNeedsCurrencyDimension(["campaign_id"], ["roas"]), true);
  });

  it("formats money without mixing currency symbols", () => {
    assert.match(formatMoneyAmount(1200, "USD"), /1,200/);
    assert.match(formatMoneyAmount(35_000_000, "VND"), /35/);
  });
});
