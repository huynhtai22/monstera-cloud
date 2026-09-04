import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectMarketingAnomalies } from "./marketing-anomalies";
import type { MetricRowExport } from "./client-export";

describe("marketing-anomalies watchdog", () => {
  it("detects critical zero-conversion spend burn when pixel fails", () => {
    const rows: MetricRowExport[] = [
      // Baseline 5 days with healthy conversions
      { platform: "meta_ads", campaignName: "Acme Retargeting", date: "2026-08-20", spend: 40, impressions: 1000, clicks: 50, conversions: 4, revenue: 160, currency: "USD" },
      { platform: "meta_ads", campaignName: "Acme Retargeting", date: "2026-08-21", spend: 40, impressions: 1000, clicks: 50, conversions: 5, revenue: 200, currency: "USD" },
      { platform: "meta_ads", campaignName: "Acme Retargeting", date: "2026-08-22", spend: 40, impressions: 1000, clicks: 50, conversions: 4, revenue: 150, currency: "USD" },
      // Recent 2 days with normal spend but 0 conversions
      { platform: "meta_ads", campaignName: "Acme Retargeting", date: "2026-08-23", spend: 45, impressions: 1100, clicks: 55, conversions: 0, revenue: 0, currency: "USD" },
      { platform: "meta_ads", campaignName: "Acme Retargeting", date: "2026-08-24", spend: 45, impressions: 1100, clicks: 55, conversions: 0, revenue: 0, currency: "USD" },
    ];

    const anomalies = detectMarketingAnomalies(rows, { zeroConversionSpendThresholdUsd: 50 });
    assert.equal(anomalies.length, 1);
    assert.equal(anomalies[0].type, "zero_conversion_burn");
    assert.equal(anomalies[0].severity, "critical");
    assert.equal(anomalies[0].currentSpend, 90);
    assert.equal(anomalies[0].currentConversions, 0);
    assert.match(anomalies[0].message, /Zero conversions recorded/);
    assert.match(anomalies[0].actionHint, /Check Meta Pixel/);
  });

  it("detects CPA surge when cost per acquisition doubles compared to baseline", () => {
    const rows: MetricRowExport[] = [
      // Baseline: $100 spend, 10 conversions -> $10 CPA
      { platform: "google_ads", campaignName: "Search Brand", date: "2026-08-20", spend: 50, impressions: 500, clicks: 25, conversions: 5, revenue: 250, currency: "USD" },
      { platform: "google_ads", campaignName: "Search Brand", date: "2026-08-21", spend: 50, impressions: 500, clicks: 25, conversions: 5, revenue: 250, currency: "USD" },
      // Recent: $100 spend, 2 conversions -> $50 CPA (5x spike)
      { platform: "google_ads", campaignName: "Search Brand", date: "2026-08-22", spend: 50, impressions: 500, clicks: 25, conversions: 1, revenue: 50, currency: "USD" },
      { platform: "google_ads", campaignName: "Search Brand", date: "2026-08-23", spend: 50, impressions: 500, clicks: 25, conversions: 1, revenue: 50, currency: "USD" },
    ];

    const anomalies = detectMarketingAnomalies(rows, { cpaSpikeMultiplier: 2.0 });
    const cpaAnomaly = anomalies.find((a) => a.type === "cpa_surge");
    assert.ok(cpaAnomaly);
    assert.equal(cpaAnomaly.severity, "warning");
    assert.equal(cpaAnomaly.currentCpa, 50);
    assert.equal(cpaAnomaly.baselineCpa, 10);
    assert.match(cpaAnomaly.message, /CPA spiked by \+400%/);
  });

  it("detects budget runaway when daily spend spikes significantly", () => {
    const rows: MetricRowExport[] = [
      // Baseline: 4 days at $50/day
      { platform: "tiktok_business", campaignName: "TopView Push", date: "2026-08-18", spend: 50, impressions: 10000, clicks: 200, conversions: 5, revenue: 200, currency: "USD" },
      { platform: "tiktok_business", campaignName: "TopView Push", date: "2026-08-19", spend: 50, impressions: 10000, clicks: 200, conversions: 5, revenue: 200, currency: "USD" },
      { platform: "tiktok_business", campaignName: "TopView Push", date: "2026-08-20", spend: 50, impressions: 10000, clicks: 200, conversions: 5, revenue: 200, currency: "USD" },
      { platform: "tiktok_business", campaignName: "TopView Push", date: "2026-08-21", spend: 50, impressions: 10000, clicks: 200, conversions: 5, revenue: 200, currency: "USD" },
      // Recent: 2 days at $150/day (3x surge)
      { platform: "tiktok_business", campaignName: "TopView Push", date: "2026-08-22", spend: 150, impressions: 30000, clicks: 600, conversions: 12, revenue: 500, currency: "USD" },
      { platform: "tiktok_business", campaignName: "TopView Push", date: "2026-08-23", spend: 150, impressions: 30000, clicks: 600, conversions: 12, revenue: 500, currency: "USD" },
    ];

    const anomalies = detectMarketingAnomalies(rows, { budgetRunawayMultiplier: 1.75 });
    const runawayAnomaly = anomalies.find((a) => a.type === "budget_runaway");
    assert.ok(runawayAnomaly);
    assert.equal(runawayAnomaly.severity, "warning");
    assert.match(runawayAnomaly.message, /Daily spend accelerated/);
  });

  it("returns empty array when campaign behaves normally", () => {
    const rows: MetricRowExport[] = [
      { platform: "meta_ads", campaignName: "Normal Campaign", date: "2026-08-20", spend: 100, impressions: 2000, clicks: 100, conversions: 10, revenue: 400, currency: "USD" },
      { platform: "meta_ads", campaignName: "Normal Campaign", date: "2026-08-21", spend: 100, impressions: 2000, clicks: 100, conversions: 10, revenue: 400, currency: "USD" },
      { platform: "meta_ads", campaignName: "Normal Campaign", date: "2026-08-22", spend: 105, impressions: 2100, clicks: 105, conversions: 10, revenue: 410, currency: "USD" },
    ];

    const anomalies = detectMarketingAnomalies(rows);
    assert.equal(anomalies.length, 0);
  });

  it("preserves connectionId on detected anomalies", () => {
    const rows: MetricRowExport[] = [
      { platform: "meta_ads", campaignName: "Conn Test", connectionId: "conn-xyz-123", date: "2026-08-20", spend: 40, impressions: 1000, clicks: 50, conversions: 5, revenue: 150, currency: "USD" },
      { platform: "meta_ads", campaignName: "Conn Test", connectionId: "conn-xyz-123", date: "2026-08-21", spend: 40, impressions: 1000, clicks: 50, conversions: 5, revenue: 150, currency: "USD" },
      { platform: "meta_ads", campaignName: "Conn Test", connectionId: "conn-xyz-123", date: "2026-08-22", spend: 55, impressions: 1000, clicks: 50, conversions: 0, revenue: 0, currency: "USD" },
      { platform: "meta_ads", campaignName: "Conn Test", connectionId: "conn-xyz-123", date: "2026-08-23", spend: 55, impressions: 1000, clicks: 50, conversions: 0, revenue: 0, currency: "USD" },
    ];

    const anomalies = detectMarketingAnomalies(rows, { zeroConversionSpendThresholdUsd: 50 });
    assert.equal(anomalies.length, 1);
    assert.equal(anomalies[0].connectionId, "conn-xyz-123");
  });

  it("suppresses anomaly detection when data is older than maxStaleDays from referenceDate", () => {
    const rows: MetricRowExport[] = [
      // Old data from 2 weeks ago
      { platform: "meta_ads", campaignName: "Stale Camp", date: "2026-08-10", spend: 50, impressions: 1000, clicks: 50, conversions: 5, revenue: 200, currency: "USD" },
      { platform: "meta_ads", campaignName: "Stale Camp", date: "2026-08-11", spend: 50, impressions: 1000, clicks: 50, conversions: 5, revenue: 200, currency: "USD" },
      { platform: "meta_ads", campaignName: "Stale Camp", date: "2026-08-12", spend: 60, impressions: 1000, clicks: 50, conversions: 0, revenue: 0, currency: "USD" },
      { platform: "meta_ads", campaignName: "Stale Camp", date: "2026-08-13", spend: 60, impressions: 1000, clicks: 50, conversions: 0, revenue: 0, currency: "USD" },
    ];

    // Reference date is 2026-08-25 (12 days after latest data) -> should suppress
    const anomaliesStale = detectMarketingAnomalies(rows, {
      referenceDate: "2026-08-25",
      maxStaleDays: 4,
    });
    assert.equal(anomaliesStale.length, 0);

    // Reference date is 2026-08-14 (1 day after latest data) -> should detect
    const anomaliesFresh = detectMarketingAnomalies(rows, {
      referenceDate: "2026-08-14",
      maxStaleDays: 4,
    });
    assert.equal(anomaliesFresh.length, 1);
  });
});
