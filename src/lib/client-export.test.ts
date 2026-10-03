import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateOverallKPIs,
  calculatePlatformRollups,
  calculateCampaignRollups,
  generateClientBriefMarkdown,
  formatCurrencyValue,
  type MetricRowExport,
} from "./client-export";

describe("client-export helpers", () => {
  const sampleRows: MetricRowExport[] = [
    {
      platform: "google_ads",
      campaignName: "Search Brand",
      date: "2026-08-30",
      spend: 1000,
      impressions: 20000,
      clicks: 1000,
      conversions: 50,
      revenue: 3500,
      currency: "USD",
    },
    {
      platform: "meta_ads",
      campaignName: "Prospecting Advantage+",
      date: "2026-08-30",
      spend: 2000,
      impressions: 80000,
      clicks: 2000,
      conversions: 80,
      revenue: 5000,
      currency: "USD",
    },
  ];

  describe("calculateOverallKPIs", () => {
    it("computes blended ROAS, CPA, CTR, and CPC accurately", () => {
      const kpi = calculateOverallKPIs(sampleRows);
      assert.equal(kpi.totalSpend, 3000);
      assert.equal(kpi.totalImpressions, 100000);
      assert.equal(kpi.totalClicks, 3000);
      assert.equal(kpi.totalConversions, 130);
      assert.equal(kpi.totalRevenue, 8500);
      // ROAS = 8500 / 3000 = 2.8333...
      assert.ok(Math.abs(kpi.blendedRoas - 2.833) < 0.01);
      // CPA = 3000 / 130 = 23.076...
      assert.ok(Math.abs(kpi.blendedCpa - 23.08) < 0.01);
      // CTR = (3000 / 100000) * 100 = 3.0%
      assert.equal(kpi.blendedCtr, 3.0);
      // CPC = 3000 / 3000 = 1.0
      assert.equal(kpi.averageCpc, 1.0);
      assert.equal(kpi.currency, "USD");
    });
    it("separates currencies cleanly and prevents nominal blending when multiple currencies exist", () => {
      const mixedRows: MetricRowExport[] = [
        {
          platform: "google_ads",
          campaignName: "Search US",
          date: "2026-08-30",
          spend: 100,
          impressions: 1000,
          clicks: 50,
          conversions: 5,
          revenue: 300,
          currency: "USD",
        },
        {
          platform: "meta_ads",
          campaignName: "VN Promo",
          date: "2026-08-30",
          spend: 25000000,
          impressions: 50000,
          clicks: 2000,
          conversions: 100,
          revenue: 75000000,
          currency: "VND",
        },
      ];

      const kpis = calculateOverallKPIs(mixedRows);
      assert.equal(kpis.isMixedCurrency, true);
      assert.equal(kpis.currency, "MIXED");
      assert.equal(kpis.currencyBreakdowns.length, 2);

      const vndBreakdown = kpis.currencyBreakdowns.find((c) => c.currency === "VND")!;
      assert.equal(vndBreakdown.spend, 25000000);
      assert.equal(vndBreakdown.revenue, 75000000);
      assert.equal(vndBreakdown.roas, 3.0);
      assert.equal(vndBreakdown.cpa, 250000);

      const usdBreakdown = kpis.currencyBreakdowns.find((c) => c.currency === "USD")!;
      assert.equal(usdBreakdown.spend, 100);
      assert.equal(usdBreakdown.revenue, 300);
      assert.equal(usdBreakdown.roas, 3.0);
      assert.equal(usdBreakdown.cpa, 20);

      // Conversions and clicks still aggregate accurately across currencies
      assert.equal(kpis.totalConversions, 105);
      assert.equal(kpis.totalClicks, 2050);
    });
  });

  describe("calculatePlatformRollups", () => {
    it("groups rows by platform and calculates share of spend", () => {
      const rollups = calculatePlatformRollups(sampleRows);
      assert.equal(rollups.length, 2);
      // Meta has $2000 spend, Google has $1000 spend -> Meta first
      assert.equal(rollups[0].platform, "meta_ads");
      assert.equal(rollups[0].platformLabel, "Meta Ads");
      assert.equal(rollups[0].spend, 2000);
      assert.ok(Math.abs(rollups[0].shareOfSpend - 66.67) < 0.1);
      assert.equal(rollups[0].roas, 2.5); // 5000 / 2000
      assert.equal(rollups[0].cpa, 25); // 2000 / 80

      assert.equal(rollups[1].platform, "google_ads");
      assert.equal(rollups[1].platformLabel, "Google Ads");
      assert.equal(rollups[1].spend, 1000);
      assert.ok(Math.abs(rollups[1].shareOfSpend - 33.33) < 0.1);
      assert.equal(rollups[1].roas, 3.5); // 3500 / 1000
      assert.equal(rollups[1].cpa, 20); // 1000 / 50
    });
  });

  describe("calculateCampaignRollups", () => {
    it("groups by campaign and sorts by spend", () => {
      const camps = calculateCampaignRollups(sampleRows);
      assert.equal(camps.length, 2);
      assert.equal(camps[0].campaignName, "Prospecting Advantage+");
      assert.equal(camps[0].platformLabel, "Meta Ads");
      assert.equal(camps[0].spend, 2000);
      assert.equal(camps[1].campaignName, "Search Brand");
      assert.equal(camps[1].spend, 1000);
    });

    it("uses stable identity across accounts with identical campaign names", () => {
      const collisionRows: MetricRowExport[] = [
        {
          platform: "google_ads",
          accountId: "acc_alpha",
          accountName: "Brand Alpha",
          campaignId: "camp_001",
          campaignName: "Black Friday Sale",
          date: "2026-08-30",
          spend: 1500,
          impressions: 10000,
          clicks: 500,
          conversions: 30,
          revenue: 4500,
          currency: "USD",
        },
        {
          platform: "google_ads",
          accountId: "acc_beta",
          accountName: "Brand Beta",
          campaignId: "camp_002",
          campaignName: "Black Friday Sale",
          date: "2026-08-30",
          spend: 800,
          impressions: 5000,
          clicks: 250,
          conversions: 20,
          revenue: 2400,
          currency: "USD",
        },
      ];

      const rollups = calculateCampaignRollups(collisionRows);
      assert.equal(rollups.length, 2, "Identical campaign names in different accounts should not be merged");
      assert.equal(rollups[0].accountName, "Brand Alpha");
      assert.equal(rollups[0].spend, 1500);
      assert.equal(rollups[1].accountName, "Brand Beta");
      assert.equal(rollups[1].spend, 800);
    });
  });

  describe("generateClientBriefMarkdown", () => {
    it("formats a complete markdown message ready for Slack/Telegram", () => {
      const overall = calculateOverallKPIs(sampleRows);
      const platforms = calculatePlatformRollups(sampleRows);
      const campaigns = calculateCampaignRollups(sampleRows);

      const text = generateClientBriefMarkdown({
        overall,
        platformRollups: platforms,
        campaignRollups: campaigns,
        dateRange: { start: "2026-08-25", end: "2026-08-31" },
        dataThrough: "2026-08-31",
        clientName: "Acme Store",
      });

      assert.match(text, /Performance Summary — Acme Store/);
      assert.match(text, /Data verified through 2026-08-31/);
      assert.match(text, /Total Ad Spend.*\$3,000\.00/);
      assert.match(text, /Blended CPA.*\$23\.08/);
      assert.match(text, /Blended ROAS.*2\.83x/);
      assert.match(text, /Meta Ads.*\$2,000\.00/);
      assert.match(text, /Google Ads.*\$1,000\.00/);
      assert.match(text, /Prospecting Advantage\+/);
      assert.match(text, /Search Brand/);
    });

    it("formats currency values properly for single and mixed currencies", () => {
      assert.equal(formatCurrencyValue(1234.56, "USD"), "$1,234.56");
      assert.equal(formatCurrencyValue(1234.56, "MIXED"), "1,234.56 MIXED");
      assert.equal(formatCurrencyValue(0, "USD"), "$0.00");
    });

    it("includes note for partial dataset when specified", () => {
      const overall = calculateOverallKPIs(sampleRows);
      const text = generateClientBriefMarkdown({
        overall,
        platformRollups: [],
        dateRange: { start: "2026-08-01", end: "2026-08-31" },
        isPartialData: true,
        totalRecordsLoaded: 500,
      });

      assert.match(text, /Note: Summary based on 500 loaded records/);
    });
  });
});
