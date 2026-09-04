/**
 * Marketing Anomaly & Budget Burn Watchdog
 * Evaluates performance metrics across ad channels (Meta, Google Ads, TikTok Ads, Shopee)
 * and detects critical failures: broken tracking pixels (zero-conversion spend),
 * sudden CPA spikes (+100%+), and runaway budget pacing.
 */

import { formatCurrencyValue, getPlatformLabel, type MetricRowExport } from "@/lib/client-export";

export type AnomalyType = "zero_conversion_burn" | "cpa_surge" | "budget_runaway";
export type AnomalySeverity = "critical" | "warning";

export interface MarketingAnomaly {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  platform: string;
  platformLabel: string;
  campaignId?: string;
  campaignName: string;
  accountId?: string;
  accountName?: string;
  clientId?: string;
  clientName?: string;
  currency: string;
  currentSpend: number;
  currentConversions: number;
  currentCpa?: number;
  baselineCpa?: number;
  pctChange?: number;
  message: string;
  actionHint: string;
  detectedAt: string;
}

export interface AnomalyDetectionOptions {
  zeroConversionSpendThresholdUsd?: number;
  zeroConversionSpendThresholdVnd?: number;
  cpaSpikeMultiplier?: number;
  budgetRunawayMultiplier?: number;
  recentDays?: number;
}

/**
 * Evaluates metric rows to detect ad anomalies.
 * Expects rows from both the baseline window (e.g. 7-14 days ago) and recent window (last 24-48h).
 */
export function detectMarketingAnomalies(
  rows: MetricRowExport[],
  options: AnomalyDetectionOptions = {}
): MarketingAnomaly[] {
  if (!rows || rows.length === 0) return [];

  const zeroSpendThresholdUsd = options.zeroConversionSpendThresholdUsd ?? 50;
  const zeroSpendThresholdVnd = options.zeroConversionSpendThresholdVnd ?? 1000000;
  const cpaMultiplier = options.cpaSpikeMultiplier ?? 2.0;
  const runawayMultiplier = options.budgetRunawayMultiplier ?? 1.75;
  const recentDaysCount = options.recentDays ?? 2;

  // Find all distinct dates sorted
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  if (dates.length <= 1) return [];

  const recentDates = new Set(dates.slice(-recentDaysCount));
  const baselineDates = new Set(dates.slice(0, -recentDaysCount));

  // Group metrics by campaign identity
  interface CampaignBucket {
    platform: string;
    campaignId?: string;
    campaignName: string;
    accountId?: string;
    accountName?: string;
    currency: string;
    recentSpend: number;
    recentConversions: number;
    recentClicks: number;
    baselineSpend: number;
    baselineConversions: number;
    baselineDaysCount: number;
  }

  const campaignMap = new Map<string, CampaignBucket>();

  for (const r of rows) {
    const p = r.platform || "unknown";
    const name = (r.campaignName || r.campaignId || "Uncategorized").trim();
    const acc = (r.accountId || r.accountName || "default").trim();
    const campId = (r.campaignId || name).trim();
    const cur = (r.currency || "USD").trim().toUpperCase();

    const key = `${p}:::${acc}:::${campId}:::${cur}`;
    const existing = campaignMap.get(key) || {
      platform: p,
      campaignId: r.campaignId || undefined,
      campaignName: name,
      accountId: r.accountId || undefined,
      accountName: r.accountName || undefined,
      currency: cur,
      recentSpend: 0,
      recentConversions: 0,
      recentClicks: 0,
      baselineSpend: 0,
      baselineConversions: 0,
      baselineDaysCount: baselineDates.size || 1,
    };

    if (recentDates.has(r.date)) {
      existing.recentSpend += r.spend ?? 0;
      existing.recentConversions += r.conversions ?? 0;
      existing.recentClicks += r.clicks ?? 0;
    } else if (baselineDates.has(r.date)) {
      existing.baselineSpend += r.spend ?? 0;
      existing.baselineConversions += r.conversions ?? 0;
    }

    campaignMap.set(key, existing);
  }

  const anomalies: MarketingAnomaly[] = [];
  const detectedAt = new Date().toISOString();

  for (const [key, c] of campaignMap.entries()) {
    const isVnd = c.currency === "VND";
    const minZeroSpend = isVnd ? zeroSpendThresholdVnd : zeroSpendThresholdUsd;
    const minCpaSpend = isVnd ? 600000 : 30;

    // 1. CRITICAL: Zero-Conversion Spend Burn
    // Campaign spent money recently, but recorded 0 conversions, yet historically had conversions.
    if (c.recentSpend >= minZeroSpend && c.recentConversions === 0 && c.baselineConversions > 0) {
      const spendStr = formatCurrencyValue(c.recentSpend, c.currency);
      anomalies.push({
        id: `zero-conv-${key}`,
        type: "zero_conversion_burn",
        severity: "critical",
        platform: c.platform,
        platformLabel: getPlatformLabel(c.platform),
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        accountId: c.accountId,
        accountName: c.accountName,
        currency: c.currency,
        currentSpend: c.recentSpend,
        currentConversions: 0,
        message: `Zero conversions recorded on ${spendStr} spend in the past 48h (campaign historically had ${c.baselineConversions} conversions).`,
        actionHint: `Check Meta Pixel / Google Tag Manager firing, review checkout page for 500 errors, or pause ${c.campaignName}.`,
        detectedAt,
      });
      continue; // Don't trigger secondary CPA alerts on zero conversions
    }

    // 2. WARNING: CPA Surge (+100%+ efficiency collapse)
    if (c.recentSpend >= minCpaSpend && c.recentConversions > 0 && c.baselineConversions > 0 && c.baselineSpend > 0) {
      const recentCpa = c.recentSpend / c.recentConversions;
      const baselineCpa = c.baselineSpend / c.baselineConversions;

      if (recentCpa >= baselineCpa * cpaMultiplier) {
        const pctSpike = Math.round(((recentCpa - baselineCpa) / baselineCpa) * 100);
        const curCpaStr = formatCurrencyValue(recentCpa, c.currency);
        const baseCpaStr = formatCurrencyValue(baselineCpa, c.currency);

        anomalies.push({
          id: `cpa-surge-${key}`,
          type: "cpa_surge",
          severity: "warning",
          platform: c.platform,
          platformLabel: getPlatformLabel(c.platform),
          campaignId: c.campaignId,
          campaignName: c.campaignName,
          accountId: c.accountId,
          accountName: c.accountName,
          currency: c.currency,
          currentSpend: c.recentSpend,
          currentConversions: c.recentConversions,
          currentCpa: recentCpa,
          baselineCpa,
          pctChange: pctSpike,
          message: `CPA spiked by +${pctSpike}% to ${curCpaStr} (baseline was ${baseCpaStr}).`,
          actionHint: `Review creative fatigue, audience saturation, or bid cap settings for ${c.campaignName}.`,
          detectedAt,
        });
      }
    }

    // 3. WARNING: Budget Runaway / Pacing Surge
    if (c.baselineSpend > 0 && c.baselineDaysCount > 0) {
      const avgDailyBaselineSpend = c.baselineSpend / c.baselineDaysCount;
      const recentDailySpend = c.recentSpend / recentDaysCount;

      if (avgDailyBaselineSpend > 0 && recentDailySpend >= avgDailyBaselineSpend * runawayMultiplier && c.recentSpend >= minZeroSpend) {
        const pctSpike = Math.round(((recentDailySpend - avgDailyBaselineSpend) / avgDailyBaselineSpend) * 100);
        const curSpendStr = formatCurrencyValue(recentDailySpend, c.currency);
        const baseSpendStr = formatCurrencyValue(avgDailyBaselineSpend, c.currency);

        anomalies.push({
          id: `budget-runaway-${key}`,
          type: "budget_runaway",
          severity: "warning",
          platform: c.platform,
          platformLabel: getPlatformLabel(c.platform),
          campaignId: c.campaignId,
          campaignName: c.campaignName,
          accountId: c.accountId,
          accountName: c.accountName,
          currency: c.currency,
          currentSpend: c.recentSpend,
          currentConversions: c.recentConversions,
          pctChange: pctSpike,
          message: `Daily spend accelerated +${pctSpike}% to ${curSpendStr}/day (baseline daily avg: ${baseSpendStr}).`,
          actionHint: `Verify daily budget limits and pacing strategy on ${c.campaignName}.`,
          detectedAt,
        });
      }
    }
  }

  // Sort critical first, then by spend descending
  return anomalies.sort((a, b) => {
    if (a.severity === "critical" && b.severity !== "critical") return -1;
    if (b.severity === "critical" && a.severity !== "critical") return 1;
    return b.currentSpend - a.currentSpend;
  });
}
