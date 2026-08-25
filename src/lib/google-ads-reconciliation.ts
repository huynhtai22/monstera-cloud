export type GoogleAdsReconciliationContext = {
  customerId: string;
  since: string;
  until: string;
  accountTimeZone: string;
  currency: string;
  campaignScope: string;
  conversionSemantics: string;
};

export type GoogleAdsReconciliationTotals = {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  campaignCount: number;
};

export type GoogleAdsReconciliationResult = {
  contextMatches: boolean;
  contextMismatches: Array<keyof GoogleAdsReconciliationContext>;
  metrics: Array<{
    metric: keyof GoogleAdsReconciliationTotals;
    provider: number;
    warehouse: number;
    absoluteVariance: number;
    percentVariance: number | null;
  }>;
};

const contextKeys: Array<keyof GoogleAdsReconciliationContext> = [
  "customerId",
  "since",
  "until",
  "accountTimeZone",
  "currency",
  "campaignScope",
  "conversionSemantics",
];

const metricKeys: Array<keyof GoogleAdsReconciliationTotals> = [
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "conversionValue",
  "campaignCount",
];

function comparableContextValue(value: string): string {
  return value.trim();
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Compare provider totals with warehouse totals only when their reporting
 * context is explicit. This deliberately accepts totals from a safe internal
 * export/query and never requires credentials or makes a provider request.
 */
export function reconcileGoogleAdsTotals(input: {
  providerContext: GoogleAdsReconciliationContext;
  warehouseContext: GoogleAdsReconciliationContext;
  providerTotals: GoogleAdsReconciliationTotals;
  warehouseTotals: GoogleAdsReconciliationTotals;
}): GoogleAdsReconciliationResult {
  const contextMismatches = contextKeys.filter((key) => {
    const providerValue = comparableContextValue(input.providerContext[key]);
    const warehouseValue = comparableContextValue(input.warehouseContext[key]);
    return !providerValue || !warehouseValue || providerValue !== warehouseValue;
  });

  return {
    contextMatches: contextMismatches.length === 0,
    contextMismatches,
    metrics: metricKeys.map((metric) => {
      const provider = finite(input.providerTotals[metric]);
      const warehouse = finite(input.warehouseTotals[metric]);
      const absoluteVariance = Math.abs(provider - warehouse);
      return {
        metric,
        provider,
        warehouse,
        absoluteVariance,
        percentVariance: provider === 0 ? null : (absoluteVariance / Math.abs(provider)) * 100,
      };
    }),
  };
}
