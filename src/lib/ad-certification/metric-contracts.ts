/**
 * Versioned Metric Contracts for Advertising Connector Certification (v1.0.0)
 *
 * Covers:
 * - Google Ads
 * - Meta Ads
 * - TikTok Ads (TikTok for Business Marketing API)
 *
 * Rules:
 * 1. Compare underlying inputs (spend, impressions, clicks, conversions, revenue) before derived metrics.
 * 2. Exact equality for delivery integers (impressions, clicks).
 * 3. Documented currency rounding tolerance (0.01 or 1 VND).
 * 4. Zero arbitrary percentage tolerances to conceal mismatches.
 * 5. Explanations required for any non-zero material variance.
 */

import type { AdProvider, MetricComparison, ReconciliationSummary, ReconciliationTimingContext } from "./types";

export interface ProviderMetricContract {
  provider: AdProvider;
  contractVersion: string;
  requiredDimensions: string[];
  supportedUnderlyingMetrics: string[];
  supportedDerivedMetrics: string[];
  tolerances: {
    deliveryIntegers: number; // 0 for exact match
    currencyRounding: number; // 0.01
    rateRounding: number;     // 0.01
  };
  semantics: {
    timezoneHandling: string;
    currencyHandling: string;
    campaignStatusFilter: string;
    attributionWindow: string;
    conversionDateSemantics: string;
    lateDataLookback: string;
  };
}

export const METRIC_CONTRACTS: Record<AdProvider, ProviderMetricContract> = {
  google_ads: {
    provider: "google_ads",
    contractVersion: "1.0.0",
    requiredDimensions: ["date", "customerId", "campaignId", "campaignName"],
    supportedUnderlyingMetrics: [
      "impressions",
      "clicks",
      "spend",
      "conversions",
      "revenue",
    ],
    supportedDerivedMetrics: ["ctr", "cpc", "cpm", "cpa", "roas"],
    tolerances: {
      deliveryIntegers: 0,   // Exact match for impressions & clicks
      currencyRounding: 0.01, // 0.01 standard currency unit
      rateRounding: 0.01,
    },
    semantics: {
      timezoneHandling: "Customer account reporting timezone (from customer.time_zone)",
      currencyHandling: "Customer account native currency code (from customer.currency_code); cost_micros divided by 1,000,000",
      campaignStatusFilter: "Excludes REMOVED campaigns (campaign.status != 'REMOVED')",
      attributionWindow: "Google Ads default attribution model; conversion date vs interaction date semantics noted",
      conversionDateSemantics: "Conversions reported by interaction/click date or conversion date depending on query definition",
      lateDataLookback: "Rolling 7-day or 30-day lookback window recommended for conversion lag",
    },
  },
  meta_ads: {
    provider: "meta_ads",
    contractVersion: "1.0.0",
    requiredDimensions: ["date", "adAccountId", "campaignId", "campaignName"],
    supportedUnderlyingMetrics: [
      "impressions",
      "clicks",
      "spend",
      "conversions",
      "revenue",
    ],
    supportedDerivedMetrics: ["ctr", "cpc", "cpm", "cpa", "roas"],
    tolerances: {
      deliveryIntegers: 0,   // Exact match
      currencyRounding: 0.01,
      rateRounding: 0.01,
    },
    semantics: {
      timezoneHandling: "Ad Account timezone (from timezone_name)",
      currencyHandling: "Ad Account native currency (from currency); floating point parsed without loss",
      campaignStatusFilter: "Active and paused campaigns; deleted campaigns retained in historical warehouse data",
      attributionWindow: "Default 7-day click + 1-day view attribution window",
      conversionDateSemantics: "Meta reports conversions on impression/click timestamp, not conversion timestamp",
      lateDataLookback: "Rolling 7-day lookback required to reconcile attribution credit revisions",
    },
  },
  tiktok_business: {
    provider: "tiktok_business",
    contractVersion: "1.0.0",
    requiredDimensions: ["date", "advertiserId", "campaignId", "campaignName"],
    supportedUnderlyingMetrics: [
      "impressions",
      "clicks",
      "spend",
      "conversions",
      "revenue",
    ],
    supportedDerivedMetrics: ["ctr", "cpc", "cpm", "cpa", "roas"],
    tolerances: {
      deliveryIntegers: 0,   // Exact match
      currencyRounding: 0.01,
      rateRounding: 0.01,
    },
    semantics: {
      timezoneHandling: "Advertiser account timezone (from advertiser info API)",
      currencyHandling: "Advertiser account currency code",
      campaignStatusFilter: "All campaign statuses matching active reporting range",
      attributionWindow: "TikTok standard attribution (default 7-day click, 1-day view)",
      conversionDateSemantics: "Conversions attributed to ad interaction time",
      lateDataLookback: "Rolling lookback recommended to capture delayed TikTok pixel events",
    },
  },
};

export interface RawComparisonTotals {
  impressions?: number;
  clicks?: number;
  spend?: number;
  conversions?: number;
  revenue?: number;
}

/**
 * Evaluates provider totals vs warehouse totals under the versioned metric contract.
 * Strictly checks underlying inputs first, then derived metrics.
 * Explicitly tracks snapshot timing, source, and alignment.
 */
export function evaluateReconciliation(
  provider: AdProvider,
  providerTotals: RawComparisonTotals,
  warehouseTotals: RawComparisonTotals,
  context: ReconciliationTimingContext,
  explanations: Record<string, string> = {}
): ReconciliationSummary {
  const contract = METRIC_CONTRACTS[provider];
  const comparisons: MetricComparison[] = [];
  const unexplainedVariances: string[] = [];

  // Snapshot alignment evaluation:
  // If native retrieval time and monstera data-through time differ significantly or are flagged unaligned
  const isSnapshotAligned =
    context.nativeRetrievalTime && context.monsteraDataThroughTime
      ? Math.abs(
          new Date(context.nativeRetrievalTime).getTime() -
            new Date(context.monsteraDataThroughTime).getTime()
        ) <= 300_000 // 5 minutes alignment tolerance
      : true;

  const toleranceForMetric = (metric: string): number => {
    if (metric === "impressions" || metric === "clicks") {
      return contract.tolerances.deliveryIntegers;
    }
    if (context.currency === "VND") {
      return 1; // 1 VND rounding
    }
    return contract.tolerances.currencyRounding;
  };

  // 1. Underlying inputs check
  const underlyingMetrics: Array<keyof RawComparisonTotals> = [
    "impressions",
    "clicks",
    "spend",
    "conversions",
    "revenue",
  ];

  let underlyingValid = true;

  for (const m of underlyingMetrics) {
    const pVal = providerTotals[m] ?? 0;
    const wVal = warehouseTotals[m] ?? 0;
    const absVar = Math.abs(pVal - wVal);
    const tol = toleranceForMetric(m);
    const withinTolerance = absVar <= tol;
    const pctVar = pVal !== 0 ? (absVar / Math.abs(pVal)) * 100 : wVal === 0 ? 0 : 100;
    const explanation = explanations[m]?.trim();
    const explanationRequired = !withinTolerance;

    if (!withinTolerance) {
      underlyingValid = false;
      if (!explanation) {
        unexplainedVariances.push(m);
      }
    }

    comparisons.push({
      metric: m,
      providerValue: pVal,
      warehouseValue: wVal,
      absoluteVariance: Number(absVar.toFixed(4)),
      percentVariance: Number(pctVar.toFixed(4)),
      tolerance: tol,
      withinTolerance,
      explanationRequired,
      explanation,
    });
  }

  // 2. Derived metrics check (only when underlying inputs are present)
  const computeDerived = (totals: RawComparisonTotals) => {
    const imp = totals.impressions ?? 0;
    const clk = totals.clicks ?? 0;
    const spd = totals.spend ?? 0;
    const conv = totals.conversions ?? 0;
    const rev = totals.revenue ?? 0;

    return {
      ctr: imp > 0 ? clk / imp : 0,
      cpc: clk > 0 ? spd / clk : 0,
      cpm: imp > 0 ? (spd / imp) * 1000 : 0,
      cpa: conv > 0 ? spd / conv : null,
      roas: spd > 0 ? rev / spd : null,
    };
  };

  const pDerived = computeDerived(providerTotals);
  const wDerived = computeDerived(warehouseTotals);

  const derivedKeys: Array<keyof typeof pDerived> = ["ctr", "cpc", "cpm", "cpa", "roas"];

  for (const d of derivedKeys) {
    const pVal = pDerived[d];
    const wVal = wDerived[d];

    if (pVal === null || wVal === null) {
      continue;
    }

    const absVar = Math.abs(pVal - wVal);
    const tol = contract.tolerances.rateRounding;
    const withinTolerance = absVar <= tol;
    const pctVar = pVal !== 0 ? (absVar / Math.abs(pVal)) * 100 : wVal === 0 ? 0 : 100;

    const directExplanation = explanations[d]?.trim();
    const inputInheritedExplanation =
      (d === "ctr" && (explanations.clicks || explanations.impressions)) ||
      (d === "cpc" && (explanations.spend || explanations.clicks)) ||
      (d === "cpm" && (explanations.spend || explanations.impressions)) ||
      (d === "cpa" && (explanations.spend || explanations.conversions)) ||
      (d === "roas" && (explanations.revenue || explanations.spend));

    const effectiveExplanation =
      directExplanation ||
      (inputInheritedExplanation
        ? `Derived variance explained by underlying input variance: ${inputInheritedExplanation}`
        : undefined);

    const explanationRequired = !withinTolerance;

    if (!withinTolerance && !effectiveExplanation) {
      unexplainedVariances.push(d);
    }

    comparisons.push({
      metric: d,
      providerValue: Number(pVal.toFixed(4)),
      warehouseValue: Number(wVal.toFixed(4)),
      absoluteVariance: Number(absVar.toFixed(4)),
      percentVariance: Number(pctVar.toFixed(4)),
      tolerance: tol,
      withinTolerance,
      explanationRequired,
      explanation: effectiveExplanation,
    });
  }

  let passed = unexplainedVariances.length === 0;
  let isInconclusive = false;
  let inconclusiveReason: string | undefined = undefined;

  // Handle snapshot timing mismatch without loosening tolerances
  if (!passed && !isSnapshotAligned) {
    isInconclusive = true;
    inconclusiveReason =
      `Snapshot timing mismatch: Provider native retrieval time (${context.nativeRetrievalTime}) ` +
      `and Monstera data-through time (${context.monsteraDataThroughTime}) are not aligned. ` +
      `Tolerances are not loosened. Result is INCONCLUSIVE pending aligned snapshot rerun.`;
    passed = false; // Never pass an inconclusive or unaligned comparison
  }

  return {
    passed,
    accountTimezone: context.accountTimezone,
    currency: context.currency,
    dateRange: context.dateRange,
    metrics: comparisons,
    underlyingInputsValid: underlyingValid,
    unexplainedVariances,
    nativeRetrievalTime: context.nativeRetrievalTime,
    monsteraDataThroughTime: context.monsteraDataThroughTime,
    warehouseQueryTime: context.warehouseQueryTime,
    attributionConfig: context.attributionConfig,
    conversionEventSelection: context.conversionEventSelection,
    campaignStatusFilter: context.campaignStatusFilter,
    reportingGranularity: context.reportingGranularity || "TOTAL",
    lateArrivalLookbackDays: context.lateArrivalLookbackDays || 7,
    nativeComparisonSource: context.nativeComparisonSource || "AD_MANAGER_UI",
    isSnapshotAligned,
    isInconclusive,
    inconclusiveReason,
  };
}
