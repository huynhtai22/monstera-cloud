import type { ProviderCapability } from "./types";

export const PROVIDER_CAPABILITY_REGISTRY_VERSION = "1.0.0";

const META_BREAKDOWNS_SOURCE = {
  title: "Meta Marketing API — Insights breakdowns",
  url: "https://developers.facebook.com/docs/marketing-api/insights/breakdowns",
  accessedOn: "2026-09-13",
} as const;

const META_METRICS_UPDATE_SOURCE = {
  title: "Meta Business — Metrics updates to offer more actionable business insights",
  url: "https://www.facebook.com/business/news/metrics-updates-to-offer-you-more-actionable-business-insights",
  accessedOn: "2026-09-13",
} as const;

const META_ADS_INSIGHTS_CHANGE_SOURCE = {
  title: "Meta for Developers — Ads Insights API historical data and attribution changes",
  url: "https://developers.facebook.com/docs/marketing-api/insights",
  accessedOn: "2026-09-13",
} as const;

const ALL_GRANULARITIES = ["account", "campaign", "adset", "ad"] as const;
const AD_GRANULARITY = ["ad"] as const;

const records = [
  {
    registryVersion: PROVIDER_CAPABILITY_REGISTRY_VERSION,
    recordId: "meta_ads.ads_insights.performance.report.standard_totals.2021-05-25",
    provider: "meta_ads",
    reportSurface: "ads_insights",
    reportType: "performance",
    kind: "report",
    capabilityId: "standard_totals",
    lifecycle: "restricted",
    effectiveDate: "2021-05-25",
    lookbackLimit: { value: 37, unit: "month", anchor: "evaluation_date" },
    granularities: ALL_GRANULARITIES,
    attributionRestrictions: [],
    severity: "error",
    operatorExplanation:
      "Meta Ads Insights total values are available for at most 37 calendar months. Preserve older reporting data in the warehouse before it ages out.",
    sourceReference: META_ADS_INSIGHTS_CHANGE_SOURCE,
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
      "Meta limits unique-count fields to 13 calendar months of history. Use already-warehoused values for older comparisons.",
    sourceReference: META_ADS_INSIGHTS_CHANGE_SOURCE,
  })),
  {
    registryVersion: PROVIDER_CAPABILITY_REGISTRY_VERSION,
    recordId:
      "meta_ads.ads_insights.performance.breakdown.hourly_stats_aggregated_by_advertiser_time_zone.2026-01-12",
    provider: "meta_ads",
    reportSurface: "ads_insights",
    reportType: "performance",
    kind: "breakdown",
    capabilityId: "hourly_stats_aggregated_by_advertiser_time_zone",
    lifecycle: "restricted",
    effectiveDate: "2026-01-12",
    lookbackLimit: { value: 13, unit: "month", anchor: "evaluation_date" },
    granularities: ALL_GRANULARITIES,
    attributionRestrictions: [],
    severity: "error",
    operatorExplanation:
      "Meta limits hourly breakdowns to 13 calendar months of history. Remove the hourly breakdown or use already-warehoused detail for older periods.",
    sourceReference: META_BREAKDOWNS_SOURCE,
  },
  {
    registryVersion: PROVIDER_CAPABILITY_REGISTRY_VERSION,
    recordId: "meta_ads.ads_insights.performance.breakdown.frequency_value.2026-01-12",
    provider: "meta_ads",
    reportSurface: "ads_insights",
    reportType: "performance",
    kind: "breakdown",
    capabilityId: "frequency_value",
    lifecycle: "restricted",
    effectiveDate: "2026-01-12",
    lookbackLimit: { value: 6, unit: "month", anchor: "evaluation_date" },
    granularities: ALL_GRANULARITIES,
    attributionRestrictions: [],
    severity: "error",
    operatorExplanation:
      "Meta limits frequency breakdowns to six calendar months of history. Remove the breakdown or use already-warehoused detail for older periods.",
    sourceReference: META_BREAKDOWNS_SOURCE,
  },
  ...["7d_view", "28d_view"].map((capabilityId) => ({
    registryVersion: PROVIDER_CAPABILITY_REGISTRY_VERSION,
    recordId: `meta_ads.ads_insights.performance.attribution_window.${capabilityId}.2026-01-12`,
    provider: "meta_ads" as const,
    reportSurface: "ads_insights" as const,
    reportType: "performance" as const,
    kind: "attribution_window" as const,
    capabilityId,
    lifecycle: "retired" as const,
    effectiveDate: "2026-01-12",
    replacement: ["1d_view"],
    granularities: ALL_GRANULARITIES,
    attributionRestrictions: [
      {
        unavailableWindows: [capabilityId],
        allowedWindows: ["1d_view"],
        explanation:
          "Longer view-through windows no longer return Ads Insights data; use one-day view-through attribution when view attribution is required.",
      },
    ],
    severity: "error" as const,
    operatorExplanation:
      "This view-through attribution window no longer returns Ads Insights data. Replace it with one-day view-through attribution and disclose the measurement change.",
    sourceReference: META_ADS_INSIGHTS_CHANGE_SOURCE,
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
