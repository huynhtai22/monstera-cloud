import { META_CANONICAL_METRIC_GRAIN } from "@/lib/meta-ingest";

/** Authoritative CampaignMetric fact grain for each verified-report provider. */
export const PROVIDER_SOURCE_GRAINS = {
  google_ads: "campaign",
  meta_ads: META_CANONICAL_METRIC_GRAIN,
  tiktok_business: "campaign",
} as const;

export type VerifiedReportProvider = keyof typeof PROVIDER_SOURCE_GRAINS;
