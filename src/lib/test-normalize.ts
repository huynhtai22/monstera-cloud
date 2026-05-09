import { normalizeGoogleAdsRow } from "./google-ads";

const rawRow = {
  campaign: {
    resourceName: "customers/123/campaigns/456",
    id: "456",
    name: "My Campaign"
  },
  metrics: {
    impressions: "100",
    costMicros: "1500000",
    ctr: 0.05
  },
  segments: {
    date: "2026-05-09"
  }
};

const normalized = normalizeGoogleAdsRow(rawRow as any);
console.log("Normalized:", normalized);
