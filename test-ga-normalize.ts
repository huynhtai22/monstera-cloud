import { normalizeGoogleAdsRow } from "./src/lib/google-ads";

const testRow = {
  campaign: {
    id: "2110283749",
    name: "Search-Camp-01",
    status: "ENABLED"
  },
  metrics: {
    impressions: "1500",
    clicks: "50",
    costMicros: "15000000",
    conversions: 5,
    conversionsValue: 120.5
  },
  segments: {
    date: "2026-05-08"
  },
  customer: {
    currencyCode: "USD"
  }
};

const result = normalizeGoogleAdsRow(testRow as any);
console.log(JSON.stringify(result, null, 2));
