/**
 * Trusted Reporting Assistant v1: Metric catalog and reporting contracts.
 * 
 * Strict semantic contracts ensure no silent FX conversions, no blending of
 * disparate currencies, separate tracking of advertising vs marketplace commerce,
 * and preservation of unavailable values (avoiding converting missing denominators to zero).
 */

export type ReportingMetricId =
  | "spend"
  | "impressions"
  | "clicks"
  | "cpc"
  | "ctr"
  | "conversions"
  | "cost_per_conversion"
  | "roas"
  | "marketplace_orders"
  | "marketplace_revenue";

export type MetricUnits = "currency" | "count" | "ratio" | "percentage";
export type AggregationBehavior = "sum" | "ratio_of_sums";

export type ReportingMetricDefinition = {
  id: ReportingMetricId;
  name: string;
  units: MetricUnits;
  requiredInputs: string[];
  aggregationBehavior: AggregationBehavior;
  applicableSourceGrain: string;
  nullHandling: string;
  semanticLimitations: string[];
};

export const REPORTING_METRIC_CATALOG: Record<ReportingMetricId, ReportingMetricDefinition> = {
  spend: {
    id: "spend",
    name: "Advertising Spend",
    units: "currency",
    requiredInputs: ["spend"],
    aggregationBehavior: "sum",
    applicableSourceGrain: "CampaignMetric.spend grouped by currency",
    nullHandling: "Nulls in spend rows are treated as unavailable. Zero is observed zero spend.",
    semanticLimitations: [
      "Must be grouped by currency; never blended across disparate currencies without audited FX.",
      "Represents paid advertising costs reported by ad platforms; does not include agency retainers or tool fees.",
    ],
  },
  impressions: {
    id: "impressions",
    name: "Ad Impressions",
    units: "count",
    requiredInputs: ["impressions"],
    aggregationBehavior: "sum",
    applicableSourceGrain: "CampaignMetric.impressions",
    nullHandling: "Summed across reported rows; zero indicates zero served impressions.",
    semanticLimitations: [
      "Platform-reported ad impressions; frequency limits and deduping logic vary across platforms (Meta vs TikTok vs Google).",
    ],
  },
  clicks: {
    id: "clicks",
    name: "Ad Clicks",
    units: "count",
    requiredInputs: ["clicks"],
    aggregationBehavior: "sum",
    applicableSourceGrain: "CampaignMetric.clicks",
    nullHandling: "Summed across reported rows.",
    semanticLimitations: [
      "Reflects platform-normalized click interactions; does not guarantee unique landing page sessions.",
    ],
  },
  cpc: {
    id: "cpc",
    name: "Cost Per Click (CPC)",
    units: "currency",
    requiredInputs: ["spend", "clicks"],
    aggregationBehavior: "ratio_of_sums",
    applicableSourceGrain: "SUM(spend) / SUM(clicks)",
    nullHandling: "If total clicks is zero or unavailable, CPC is unavailable (null), never zero.",
    semanticLimitations: [
      "Computed as ratio of sums over identical reporting scope and currency.",
    ],
  },
  ctr: {
    id: "ctr",
    name: "Click-Through Rate (CTR)",
    units: "percentage",
    requiredInputs: ["clicks", "impressions"],
    aggregationBehavior: "ratio_of_sums",
    applicableSourceGrain: "SUM(clicks) / SUM(impressions)",
    nullHandling: "If impressions is zero or unavailable, CTR is unavailable (null), never zero.",
    semanticLimitations: [
      "Ratio of platform clicks to platform impressions; does not measure post-click engagement.",
    ],
  },
  conversions: {
    id: "conversions",
    name: "Platform-Reported Conversions",
    units: "count",
    requiredInputs: ["conversions"],
    aggregationBehavior: "sum",
    applicableSourceGrain: "CampaignMetric.conversions",
    nullHandling: "Summed across reported rows.",
    semanticLimitations: [
      "Represents self-reported conversions from ad platforms according to each platform's attribution window.",
      "Must NOT be claimed as unique buyers or total customers; cross-channel double counting is inherent to platform-reported figures.",
    ],
  },
  cost_per_conversion: {
    id: "cost_per_conversion",
    name: "Cost Per Conversion",
    units: "currency",
    requiredInputs: ["spend", "conversions"],
    aggregationBehavior: "ratio_of_sums",
    applicableSourceGrain: "SUM(spend) / SUM(conversions)",
    nullHandling: "If conversions is zero or unavailable, Cost Per Conversion is unavailable (null), never zero.",
    semanticLimitations: [
      "Do NOT label as Customer Acquisition Cost (CAC); these are platform conversions, not audited new customers.",
    ],
  },
  roas: {
    id: "roas",
    name: "Platform-Reported ROAS",
    units: "ratio",
    requiredInputs: ["revenue", "spend"],
    aggregationBehavior: "ratio_of_sums",
    applicableSourceGrain: "SUM(CampaignMetric.revenue) / SUM(CampaignMetric.spend)",
    nullHandling: "If spend is zero or unavailable, ROAS is unavailable (null).",
    semanticLimitations: [
      "Measured within identical currency scope only.",
      "Uses advertising platform-reported attribution revenue; does not represent audited bank or accounting revenue.",
    ],
  },
  marketplace_orders: {
    id: "marketplace_orders",
    name: "Marketplace Orders",
    units: "count",
    requiredInputs: ["order_count"],
    aggregationBehavior: "sum",
    applicableSourceGrain: "Shopee/Lazada daily order rollups in CampaignMetric",
    nullHandling: "Summed across verified marketplace rollup rows.",
    semanticLimitations: [
      "Direct store order count from marketplace APIs (Shopee, Lazada).",
      "Kept strictly separate from ad-platform conversions.",
    ],
  },
  marketplace_revenue: {
    id: "marketplace_revenue",
    name: "Marketplace Order Revenue",
    units: "currency",
    requiredInputs: ["order_revenue"],
    aggregationBehavior: "sum",
    applicableSourceGrain: "Shopee/Lazada daily revenue rollups in CampaignMetric",
    nullHandling: "Summed across verified marketplace rollup rows; currency matched to store currency.",
    semanticLimitations: [
      "Represents total store GMV / order revenue from marketplace endpoints.",
      "Kept strictly separate from ad-attributed conversion value to prevent duplicate attribution.",
    ],
  },
};

export type ReportingWindowPreset = "last_7d" | "last_30d";

export type ReportingWindowRange = {
  start: string;
  end: string;
};

export const REPORTING_BRIEF_FINGERPRINT_VERSION = "brief-fingerprint-v1";
export const REPORTING_METRIC_CATALOG_VERSION = "metric-catalog-v1";

export type ReportingPeriodWindows = {
  preset: ReportingWindowPreset;
  current: ReportingWindowRange;
  prior: ReportingWindowRange;
  timezone: string;
  timezoneSource: "verified" | "inferred" | "unknown";
  daysCount: number;
  comparisonAvailable?: boolean;
  comparisonUnavailableReason?: string | null;
};

export type ReportingMetricValue = {
  metricId: ReportingMetricId;
  name: string;
  currency: string | null;
  currentValue: number | null;
  priorValue: number | null;
  absoluteChange: number | null;
  percentageChange: number | null;
  status: "available" | "unavailable" | "zero_baseline";
  limitations: string[];
};

export type ReportingChannelSummary = {
  channel: string;
  currency: string;
  spend: number | null;
  conversions: number | null;
  conversionValue: number | null;
  roas: number | null;
  orders: number | null;
  orderRevenue: number | null;
  clicks: number | null;
  impressions: number | null;
};

export type ReportingObservation = {
  id: string;
  type: "spend" | "conversion" | "roas" | "marketplace" | "limitation" | "freshness";
  text: string;
  evidenceRef: string;
};

import type { FreshnessJourney as CanonicalFreshnessJourney } from "@/lib/freshness-journey";

export type FreshnessJourney = CanonicalFreshnessJourney & {
  sourceHealth?: "fresh" | "stale" | "partial" | "failed" | "never" | "refreshing";
  warehouseFreshness?: string;
  readinessStatus?: "READY" | "WARNING" | "NOT_READY" | "UNKNOWN";
  deliveryStatus?: "verified" | "unverified" | "stale" | "unconfigured";
};

export function createMockFreshnessJourney(overrides: Partial<FreshnessJourney> = {}): FreshnessJourney {
  return {
    status: "READY",
    evaluatedAt: "2026-09-24T12:00:00.000Z",
    window: { start: "2026-09-17", end: "2026-09-23" },
    lastSuccessfulSyncAt: "2026-09-23T23:59:59.000Z",
    dataThroughDate: "2026-09-23",
    deliveredAt: null,
    stages: [
      { key: "source", state: "passed", codes: [], href: "/sources" },
      { key: "warehouse", state: "passed", codes: [], href: "/explorer" },
      { key: "report", state: "passed", codes: [], href: "/reports" },
      { key: "delivery", state: "passed", codes: [], href: "/exports" },
    ],
    sourceHealth: "fresh",
    warehouseFreshness: "fresh",
    readinessStatus: "READY",
    deliveryStatus: "unconfigured",
    ...overrides,
  };
}

export type ReportingContext = {
  workspaceId: string;
  clientId: string;
  clientName: string;
  plan: string;
  windows: ReportingPeriodWindows;
  readiness: {
    status: "READY" | "WARNING" | "NOT_READY" | "UNKNOWN";
    exportEligible: boolean;
    blockers: string[];
    warnings: string[];
    latestDataDate: string | null;
    currencies: string[];
    timezone: string | null;
    fingerprint: string | null;
  };
  freshnessJourney: FreshnessJourney;
  completeness: {
    coverageStatus: "complete" | "incomplete" | "unknown";
    sourceCount: number;
    partialCount: number;
    missingDays: number | null;
    limitReached: boolean;
  };
  metrics: ReportingMetricValue[];
  channels: ReportingChannelSummary[];
  observations: ReportingObservation[];
  evaluatedAt: string;
  fingerprint: string;
};

export type ExecutiveBriefResponse = {
  workspaceId: string;
  clientId: string;
  clientName: string;
  window: ReportingPeriodWindows;
  readiness: ReportingContext["readiness"];
  freshnessJourney: FreshnessJourney;
  generationMode: "model_assisted" | "deterministic";
  sections: {
    headline: string;
    kpiScorecard: ReportingMetricValue[];
    channelScorecard: ReportingChannelSummary[];
    observations: ReportingObservation[];
    suggestedChecks: string[];
    sourcesAndLimitations: string[];
  };
  generatedAt: string;
  fingerprint: string;
};
