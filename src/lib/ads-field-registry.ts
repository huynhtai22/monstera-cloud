export type AdsFieldKind = "dimension" | "metric";
export type AdsMetricAgg = "sum";

export type AdsField = {
  id: string;
  kind: AdsFieldKind;
  label: string;
  description?: string;
  prismaField?: string;
};

export type AdsMetricField = AdsField & {
  kind: "metric";
  agg?: AdsMetricAgg;
  isCalculatedMetric?: boolean;
  formula?: string;
  // Dependencies on other unified metric ids (raw components), used for validation.
  requires?: string[];
};

export type AdsDimensionField = AdsField & {
  kind: "dimension";
};

// Stable, join-safe dimensions (IDs + names). Additions must be backward compatible.
export const ADS_DIMENSIONS: AdsDimensionField[] = [
  { id: "date", kind: "dimension", label: "Date", prismaField: "date" },
  { id: "platform", kind: "dimension", label: "Platform", prismaField: "platform" },
  { id: "account_id", kind: "dimension", label: "Account ID", prismaField: "accountId" },
  { id: "account_name", kind: "dimension", label: "Account Name", prismaField: "accountName" },
  { id: "campaign_id", kind: "dimension", label: "Campaign ID", prismaField: "campaignId" },
  { id: "campaign", kind: "dimension", label: "Campaign", prismaField: "campaignName" },
  { id: "ad_group_id", kind: "dimension", label: "Ad Group / Ad Set ID", prismaField: "adsetId" },
  { id: "ad_group", kind: "dimension", label: "Ad Group / Ad Set", prismaField: "adsetName" },
  { id: "ad_id", kind: "dimension", label: "Ad ID", prismaField: "adId" },
  { id: "ad", kind: "dimension", label: "Ad", prismaField: undefined },
  { id: "currency", kind: "dimension", label: "Currency", prismaField: "currency" }
];

// Raw measurable components (safe to SUM across platforms).
// Note: CampaignMetric currently only stores a subset of the canonical schema.
export const ADS_METRICS: AdsMetricField[] = [
  { id: "spend", kind: "metric", label: "Spend", prismaField: "spend", agg: "sum" },
  { id: "impressions", kind: "metric", label: "Impressions", prismaField: "impressions", agg: "sum" },
  { id: "reach", kind: "metric", label: "Reach", prismaField: "reach", agg: "sum" },
  // Clicks in CampaignMetric is a platform-normalized click count; treat as `clicks`.
  { id: "clicks", kind: "metric", label: "Clicks", prismaField: "clicks", agg: "sum" },
  // Conversions in CampaignMetric is generic conversion count/value; do not assume purchase.
  { id: "conversions", kind: "metric", label: "Conversions", prismaField: "conversions", agg: "sum" },
  // Stored as `revenue` in DB; semantically safer to expose as `conversion_value`.
  { id: "conversion_value", kind: "metric", label: "Conversion Value", prismaField: "revenue", agg: "sum" }
];

// Calculated metrics (never aggregated directly; computed from summed raw components).
export const ADS_CALCULATED_METRICS: AdsMetricField[] = [
  {
    id: "ctr",
    kind: "metric",
    label: "CTR",
    isCalculatedMetric: true,
    formula: "clicks / impressions",
    requires: ["clicks", "impressions"]
  },
  {
    id: "cpc",
    kind: "metric",
    label: "CPC",
    isCalculatedMetric: true,
    formula: "spend / clicks",
    requires: ["spend", "clicks"]
  },
  {
    id: "cpm",
    kind: "metric",
    label: "CPM",
    isCalculatedMetric: true,
    formula: "spend / impressions * 1000",
    requires: ["spend", "impressions"]
  },
  {
    id: "cvr",
    kind: "metric",
    label: "CVR",
    isCalculatedMetric: true,
    formula: "conversions / clicks",
    requires: ["conversions", "clicks"]
  },
  {
    id: "cpa",
    kind: "metric",
    label: "CPA",
    isCalculatedMetric: true,
    formula: "spend / conversions",
    requires: ["spend", "conversions"]
  },
  {
    id: "roas",
    kind: "metric",
    label: "ROAS",
    isCalculatedMetric: true,
    formula: "conversion_value / spend",
    requires: ["conversion_value", "spend"]
  },
  {
    id: "frequency",
    kind: "metric",
    label: "Frequency",
    isCalculatedMetric: true,
    formula: "impressions / reach",
    requires: ["impressions", "reach"]
  }
];

export const ADS_FIELDS_BY_ID: Record<string, AdsField> = Object.fromEntries(
  [...ADS_DIMENSIONS, ...ADS_METRICS, ...ADS_CALCULATED_METRICS].map((f) => [f.id, f]),
);

export function getDefaultAdsExplorerSelection(): { dimensions: string[]; metrics: string[] } {
  return {
    dimensions: ["date", "platform", "account_id", "campaign_id"],
    metrics: ["spend", "impressions", "clicks", "conversions", "conversion_value", "roas"],
  };
}

