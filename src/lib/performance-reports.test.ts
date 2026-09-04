import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateDailyTrends, buildPerformanceReport } from "./performance-reports";
import type { MetricRowExport } from "./client-export";

describe("performance-reports engine", () => {
  const mockRows: MetricRowExport[] = [
    {
      platform: "meta_ads",
      accountName: "Meta Brand",
      campaignName: "Meta Prospecting",
      date: "2026-09-02",
      spend: 100,
      impressions: 2000,
      clicks: 100,
      conversions: 10,
      revenue: 400,
      currency: "USD",
    },
    {
      platform: "google_ads",
      accountName: "Google Brand",
      campaignName: "Search Brand",
      date: "2026-09-02",
      spend: 50,
      impressions: 1000,
      clicks: 50,
      conversions: 5,
      revenue: 200,
      currency: "USD",
    },
    {
      platform: "meta_ads",
      accountName: "Meta Brand",
      campaignName: "Meta Retargeting",
      date: "2026-09-01",
      spend: 80,
      impressions: 1500,
      clicks: 60,
      conversions: 8,
      revenue: 320,
      currency: "USD",
    },
  ];

  it("calculates daily trends and orders chronologically ascending", () => {
    const trends = calculateDailyTrends(mockRows);
    assert.equal(trends.length, 2);

    // Day 1: 2026-09-01
    assert.equal(trends[0].date, "2026-09-01");
    assert.equal(trends[0].spend, 80);
    assert.equal(trends[0].revenue, 320);
    assert.equal(trends[0].roas, 4.0);
    assert.equal(trends[0].conversions, 8);
    assert.equal(trends[0].cpa, 10);

    // Day 2: 2026-09-02 (Meta + Google aggregated)
    assert.equal(trends[1].date, "2026-09-02");
    assert.equal(trends[1].spend, 150);
    assert.equal(trends[1].revenue, 600);
    assert.equal(trends[1].roas, 4.0);
    assert.equal(trends[1].conversions, 15);
    assert.equal(trends[1].cpa, 10);
  });

  it("builds complete performance report with KPIs and platform rollups", () => {
    const report = buildPerformanceReport(mockRows);

    assert.equal(report.totalRecords, 3);
    assert.equal(report.primaryCurrency, "USD");
    assert.equal(report.overall.totalSpend, 230);
    assert.equal(report.overall.totalRevenue, 920);
    assert.equal(report.overall.blendedRoas, 4.0);
    assert.equal(report.overall.totalConversions, 23);
    assert.equal(report.overall.blendedCpa, 10);

    // Platforms
    assert.equal(report.platformBreakdown.length, 2);
    const metaRollup = report.platformBreakdown.find((p) => p.platform === "meta_ads");
    assert.ok(metaRollup);
    assert.equal(metaRollup.spend, 180);
    assert.equal(metaRollup.revenue, 720);

    // Top campaigns
    assert.equal(report.topCampaigns.length, 3);
    assert.equal(report.topCampaigns[0].campaignName, "Meta Prospecting");
    assert.equal(report.topCampaigns[0].spend, 100);
  });

  it("handles empty rows gracefully", () => {
    const report = buildPerformanceReport([]);
    assert.equal(report.totalRecords, 0);
    assert.equal(report.dailyTrends.length, 0);
    assert.equal(report.platformBreakdown.length, 0);
    assert.equal(report.topCampaigns.length, 0);
    assert.equal(report.overall.totalSpend, 0);
  });
});
