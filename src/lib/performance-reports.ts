/**
 * Visual Performance Reporting Engine
 * Computes executive marketing metrics, daily trend series, platform distributions,
 * and top-performing campaigns across warehouse ad rows.
 */

import {
  calculateOverallKPIs,
  calculatePlatformRollups,
  calculateCampaignRollups,
  type MetricRowExport,
  type OverallKPIs,
  type PlatformRollup,
  type CampaignRollup,
} from "@/lib/client-export";

export interface DailyTrendPoint {
  date: string;
  spend: number;
  revenue: number;
  conversions: number;
  clicks: number;
  impressions: number;
  roas: number;
  cpa: number;
  currency: string;
}

export interface PerformanceReportData {
  overall: OverallKPIs;
  platformBreakdown: PlatformRollup[];
  dailyTrends: DailyTrendPoint[];
  topCampaigns: CampaignRollup[];
  currencies: string[];
  primaryCurrency: string;
  totalRecords: number;
}

/**
 * Aggregates metric rows into a chronological daily time series.
 */
export function calculateDailyTrends(rows: MetricRowExport[]): DailyTrendPoint[] {
  if (!rows || rows.length === 0) return [];

  const dayMap = new Map<string, {
    date: string;
    spend: number;
    revenue: number;
    conversions: number;
    clicks: number;
    impressions: number;
    currency: string;
  }>();

  for (const r of rows) {
    const d = r.date;
    const cur = (r.currency || "USD").toUpperCase();
    const existing = dayMap.get(d) || {
      date: d,
      spend: 0,
      revenue: 0,
      conversions: 0,
      clicks: 0,
      impressions: 0,
      currency: cur,
    };

    existing.spend += r.spend || 0;
    existing.revenue += r.revenue || 0;
    existing.conversions += r.conversions || 0;
    existing.clicks += r.clicks || 0;
    existing.impressions += r.impressions || 0;
    existing.currency = cur;

    dayMap.set(d, existing);
  }

  // Sort chronologically ascending
  const sortedDays = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  return sortedDays.map((pt) => ({
    ...pt,
    roas: pt.spend > 0 ? pt.revenue / pt.spend : 0,
    cpa: pt.conversions > 0 ? pt.spend / pt.conversions : 0,
  }));
}

/**
 * Builds the complete performance report payload from raw metric rows.
 */
export function buildPerformanceReport(rows: MetricRowExport[]): PerformanceReportData {
  const overall = calculateOverallKPIs(rows);
  const platformBreakdown = calculatePlatformRollups(rows);
  const dailyTrends = calculateDailyTrends(rows);
  const topCampaigns = calculateCampaignRollups(rows, 25);

  const distinctCurrencies = [...new Set(rows.map((r) => (r.currency || "USD").toUpperCase()))];
  const primaryCurrency = overall.isMixedCurrency
    ? overall.currencyBreakdowns?.[0]?.currency || "USD"
    : overall.currency || distinctCurrencies[0] || "USD";

  return {
    overall,
    platformBreakdown,
    dailyTrends,
    topCampaigns,
    currencies: distinctCurrencies,
    primaryCurrency,
    totalRecords: rows.length,
  };
}
