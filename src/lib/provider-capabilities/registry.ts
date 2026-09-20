import type { ProviderCapability } from "./types";

export const PROVIDER_CAPABILITY_REGISTRY_VERSION = "1.1.0";

const META_INSIGHTS_SOURCE = {
  title: "Meta Marketing API — Ads Insights",
  url: "https://developers.facebook.com/docs/marketing-api/insights",
  accessedOn: "2026-09-13",
  evidence:
    "Meta's Ads Insights documentation describes historical-data and attribution-window availability for the Insights surface.",
} as const;

const META_BREAKDOWNS_SOURCE = {
  title: "Meta Marketing API — Insights breakdowns",
  url: "https://developers.facebook.com/docs/marketing-api/insights/breakdowns",
  accessedOn: "2026-09-13",
  evidence:
    "Meta's breakdown reference identifies both hourly breakdown identifiers and their historical-data restriction.",
} as const;

const META_METRICS_UPDATE_SOURCE = {
  title: "Meta Business — Metrics updates to offer more actionable business insights",
  url: "https://www.facebook.com/business/news/metrics-updates-to-offer-you-more-actionable-business-insights",
  accessedOn: "2026-09-13",
  evidence:
    "Meta's metrics-update notice documents replacement of relevance score by the three relevance diagnostics.",
} as const;

const ALL_GRANULARITIES = ["account", "campaign", "adset", "ad"] as const;
const AD_GRANULARITY = ["ad"] as const;

/*
 * V1 deliberately contains only restrictions that have an accompanying Meta
 * source reference. Broad report-level and frequency claims from the initial
 * prototype were removed because their cited pages did not substantiate those
 * exact identifiers, dates, and lookback values.
 */
const records = [
  {
    registryVersion: PROVIDER_CAPABILITY_REGISTRY_VERSION,
    recordId: "meta_ads.ads_insights.performance.report.standard_totals.2026-01-12",
    provider: "meta_ads",
    reportSurface: "ads_insights",
    reportType: "performance",
    kind: "report",
    capabilityId: "standard_totals",
    lifecycle: "active",
    effectiveDate: "2026-01-12",
    granularities: ALL_GRANULARITIES,
    attributionRestrictions: [
      {
        allowedWindows: ["1d_view"],
        unavailableWindows: ["7d_view", "28d_view"],
        forbiddenCombinations: [["7d_view", "28d_view"]],
        explanation:
          "Only the documented one-day view-through window is available; seven-day and 28-day view-through windows are retired.",
      },
    ],
    severity: "error",
    operatorExplanation:
      "Use one-day view-through attribution when view attribution is required and disclose the measurement change.",
    sourceReference: META_INSIGHTS_SOURCE,
  },
  {
    registryVersion: PROVIDER_CAPABILITY_REGISTRY_VERSION,
    recordId: "meta_ads.ads_insights.performance.field.relevance_score.2019-04-30",
    provider: "meta_ads",
    reportSurface: "ads_insights",
    reportType: "performance",
    kind: "field",
    capabilityId: "relevance_score",
    lifecycle: "retired",
    effectiveDate: "2019-04-30",
    replacement: [
      "quality_ranking",
      "engagement_rate_ranking",
      "conversion_rate_ranking",
    ],
    granularities: AD_GRANULARITY,
    attributionRestrictions: [],
    severity: "error",
    operatorExplanation:
      "Relevance score was retired. Use the three ad-level relevance diagnostics together; they are categorical diagnostics, not a numeric score.",
    sourceReference: META_METRICS_UPDATE_SOURCE,
  },
  ...["quality_ranking", "engagement_rate_ranking", "conversion_rate_ranking"].map(
    (capabilityId) => ({
      registryVersion: PROVIDER_CAPABILITY_REGISTRY_VERSION,
      recordId: `meta_ads.ads_insights.performance.field.${capabilityId}.2019-03-19`,
      provider: "meta_ads" as const,
      reportSurface: "ads_insights" as const,
      reportType: "performance" as const,
      kind: "field" as const,
      capabilityId,
      lifecycle: "active" as const,
      effectiveDate: "2019-03-19",
      granularities: AD_GRANULARITY,
      attributionRestrictions: [],
      severity: "error" as const,
      operatorExplanation:
        "This relevance diagnostic is available only for ad-level reporting and should be interpreted with the other relevance diagnostics.",
      sourceReference: META_METRICS_UPDATE_SOURCE,
    }),
  ),
  ...["unique_actions", "cost_per_unique_action_type"].map((capabilityId) => ({
    registryVersion: PROVIDER_CAPABILITY_REGISTRY_VERSION,
    recordId: `meta_ads.ads_insights.performance.field.${capabilityId}.2026-01-12`,
    provider: "meta_ads" as const,
    reportSurface: "ads_insights" as const,
    reportType: "performance" as const,
    kind: "field" as const,
    capabilityId,
    lifecycle: "restricted" as const,
    effectiveDate: "2026-01-12",
    lookbackLimit: { value: 13, unit: "month" as const, anchor: "evaluation_date" as const },
    granularities: ALL_GRANULARITIES,
    attributionRestrictions: [],
    severity: "error" as const,
    operatorExplanation:
      "Meta limits these unique-count fields to 13 calendar months of history. Use already-warehoused values for older comparisons.",
    sourceReference: META_INSIGHTS_SOURCE,
  })),
  ...[
    "hourly_stats_aggregated_by_advertiser_time_zone",
    "hourly_stats_aggregated_by_audience_time_zone",
  ].map((capabilityId) => ({
    registryVersion: PROVIDER_CAPABILITY_REGISTRY_VERSION,
    recordId: `meta_ads.ads_insights.performance.breakdown.${capabilityId}.2026-01-12`,
    provider: "meta_ads" as const,
    reportSurface: "ads_insights" as const,
    reportType: "performance" as const,
    kind: "breakdown" as const,
    capabilityId,
    lifecycle: "restricted" as const,
    effectiveDate: "2026-01-12",
    lookbackLimit: { value: 13, unit: "month" as const, anchor: "evaluation_date" as const },
    granularities: ALL_GRANULARITIES,
    attributionRestrictions: [],
    severity: "error" as const,
    operatorExplanation:
      "Meta limits hourly breakdowns to 13 calendar months of history. Remove the hourly breakdown or use already-warehoused detail for older periods.",
    sourceReference: META_BREAKDOWNS_SOURCE,
  })),
] satisfies ProviderCapability[];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const PROVIDER_CAPABILITY_REGISTRY: readonly ProviderCapability[] =
  deepFreeze(records.slice());
