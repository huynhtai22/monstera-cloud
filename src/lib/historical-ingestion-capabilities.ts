/**
 * Canonical, declarative policy for Warehouse historical ingestion.
 *
 * This is deliberately separate from provider clients and from the existing
 * report-field capability registry proposal. It makes no network, database,
 * environment, or account-normalization decisions. In particular, a provider
 * being listed here never authorizes a route to start an extended import.
 */

export const HISTORICAL_INGESTION_CAPABILITY_VERSION = "historical-ingestion-v1";

export const WAREHOUSE_NORMALIZED_METRIC_RETENTION_DAYS = 731;

export type HistoricalIngestionProvider =
  | "meta_ads"
  | "google_ads"
  | "tiktok_business"
  | "shopee"
  | "shopee_ads"
  | "lazada"
  | "amazon"
  | "shopify";

export type LimitClassification =
  | "provider_hard"
  | "internal_safety"
  | "product_plan"
  | "unverified";

export interface CapabilitySourceReference {
  readonly title: string;
  readonly url: string;
  readonly accessedOn: string;
  readonly evidence: string;
}

export interface DayLimit {
  readonly days: number;
  readonly classification: LimitClassification;
  readonly source?: CapabilitySourceReference;
  readonly note: string;
}

export interface CalendarMonthLookback {
  readonly months: number;
  readonly classification: LimitClassification;
  readonly source?: CapabilitySourceReference;
  readonly note: string;
}

export interface HistoricalIngestionCapability {
  readonly version: typeof HISTORICAL_INGESTION_CAPABILITY_VERSION;
  readonly provider: HistoricalIngestionProvider;
  /** Connection-provider key(s) in this repository; Shopee Ads shares `shopee`. */
  readonly connectionProviderKeys: readonly string[];
  readonly warehouseIngestion: "implemented" | "unavailable";
  readonly historicalBackfill: "supported" | "limited" | "unavailable";
  readonly readiness: "production-ready" | "limited" | "unavailable";
  readonly defaultAutomaticBackfill: DayLimit;
  /** A customer product choice; never a claim about the provider. */
  readonly maximumCustomerSelectableRange: DayLimit | null;
  /** The maximum range sent to one provider request by a future worker. */
  readonly maximumRequestSpan: DayLimit;
  readonly recommendedChunkSize: DayLimit;
  /** Daily-grain provider history, if the provider's source verifies it. */
  readonly providerLookbackCeiling: CalendarMonthLookback | null;
  readonly paginationStrategy: string;
  readonly reportingGrain: string;
  readonly asyncReportAvailability: "available" | "unavailable" | "unverified";
  /** Whether a future extended execution may rely on the provider limits. */
  readonly extendedExecutionVerification: "verified" | "unverified" | "not_applicable";
  /** Retention of rows already normalized in Monstera, not provider availability. */
  readonly normalizedMetricRetention: DayLimit;
  readonly sources: readonly CapabilitySourceReference[];
  readonly notes: readonly string[];
}

const ACCESSED_ON = "2026-09-16";

const META_INSIGHTS_SOURCE: CapabilitySourceReference = {
  title: "Meta Marketing API — Ads Insights",
  url: "https://developers.facebook.com/docs/marketing-api/insights",
  accessedOn: ACCESSED_ON,
  evidence:
    "Documents the Insights reporting surface used by the Warehouse connector. It does not substantiate a general daily-history ceiling for this connector.",
};

const GOOGLE_DATE_RANGES_SOURCE: CapabilitySourceReference = {
  title: "Google Ads API — Date ranges",
  url: "https://developers.google.com/google-ads/api/docs/query/date-ranges",
  accessedOn: ACCESSED_ON,
  evidence: "Documents inclusive custom YYYY-MM-DD GAQL date ranges.",
};

const GOOGLE_ZERO_METRICS_SOURCE: CapabilitySourceReference = {
  title: "Google Ads API — Zero metrics",
  url: "https://developers.google.com/google-ads/api/docs/reporting/zero-metrics",
  accessedOn: ACCESSED_ON,
  evidence:
    "Documents a 37-month retention window for granular reporting and a date-range error beyond it.",
};

const SHOPIFY_ORDERS_SOURCE: CapabilitySourceReference = {
  title: "Shopify Admin API — Order",
  url: "https://shopify.dev/docs/api/admin-rest/unstable/resources/order",
  accessedOn: ACCESSED_ON,
  evidence:
    "Documents default 60-day order access and the read_all_orders requirement for older orders. Monstera has no Warehouse order-ingestion worker yet.",
};

const RETENTION: DayLimit = {
  days: WAREHOUSE_NORMALIZED_METRIC_RETENTION_DAYS,
  classification: "product_plan",
  note: "Monstera target retention for normalized metrics; no pruning worker is enabled by this declaration.",
};

const INTERNAL_30_DAY_CHUNK: DayLimit = {
  days: 30,
  classification: "internal_safety",
  note: "Conservative Warehouse request and chunk boundary for Meta/Google automatic OAuth jobs and a future extended worker; not a provider claim and does not enable an extended route.",
};

const EXTENDED_TWO_YEAR_PRODUCT_RANGE: DayLimit = {
  days: 731,
  classification: "product_plan",
  note: "Customer-selectable planning ceiling for a later asynchronous workflow; this declaration does not enable an import action.",
};

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

const records: readonly HistoricalIngestionCapability[] = [
  {
    version: HISTORICAL_INGESTION_CAPABILITY_VERSION,
    provider: "amazon",
    connectionProviderKeys: ["amazon"],
    warehouseIngestion: "unavailable",
    historicalBackfill: "unavailable",
    readiness: "unavailable",
    defaultAutomaticBackfill: { days: 0, classification: "unverified", note: "No Warehouse worker exists." },
    maximumCustomerSelectableRange: null,
    maximumRequestSpan: { days: 0, classification: "unverified", note: "No Warehouse worker exists." },
    recommendedChunkSize: { days: 0, classification: "unverified", note: "No Warehouse worker exists." },
    providerLookbackCeiling: null,
    paginationStrategy: "not implemented",
    reportingGrain: "not implemented",
    asyncReportAvailability: "unverified",
    extendedExecutionVerification: "not_applicable",
    normalizedMetricRetention: RETENTION,
    sources: [],
    notes: ["Amazon SP OAuth exists, but no production CampaignMetric ingestion worker exists."],
  },
  {
    version: HISTORICAL_INGESTION_CAPABILITY_VERSION,
    provider: "google_ads",
    connectionProviderKeys: ["google_ads"],
    warehouseIngestion: "implemented",
    historicalBackfill: "limited",
    readiness: "limited",
    defaultAutomaticBackfill: { days: 90, classification: "product_plan", note: "Approved automatic initial backfill policy." },
    maximumCustomerSelectableRange: EXTENDED_TWO_YEAR_PRODUCT_RANGE,
    maximumRequestSpan: INTERNAL_30_DAY_CHUNK,
    recommendedChunkSize: INTERNAL_30_DAY_CHUNK,
    providerLookbackCeiling: {
      months: 37,
      classification: "provider_hard",
      source: GOOGLE_ZERO_METRICS_SOURCE,
      note: "Applies to the connector's daily/granular reporting grain.",
    },
    paginationStrategy: "Google Ads SearchStream; automatic OAuth work is queued in 30-day slices, while custom Warehouse requests remain unchunked and memory-bound.",
    reportingGrain: "daily campaign metrics",
    asyncReportAvailability: "unavailable",
    extendedExecutionVerification: "verified",
    normalizedMetricRetention: RETENTION,
    sources: [GOOGLE_DATE_RANGES_SOURCE, GOOGLE_ZERO_METRICS_SOURCE],
    notes: ["A future 24-month workflow must be asynchronous, chunked, resumable, idempotent, and observable before execution is enabled."],
  },
  {
    version: HISTORICAL_INGESTION_CAPABILITY_VERSION,
    provider: "lazada",
    connectionProviderKeys: ["lazada"],
    warehouseIngestion: "implemented",
    historicalBackfill: "limited",
    readiness: "limited",
    defaultAutomaticBackfill: { days: 30, classification: "internal_safety", note: "Matches the current rolling default; not a verified provider allowance." },
    maximumCustomerSelectableRange: null,
    maximumRequestSpan: INTERNAL_30_DAY_CHUNK,
    recommendedChunkSize: INTERNAL_30_DAY_CHUNK,
    providerLookbackCeiling: null,
    paginationStrategy: "offset pages of 100; existing worker stops after a finite offset safety guard.",
    reportingGrain: "daily order rollups",
    asyncReportAvailability: "unverified",
    extendedExecutionVerification: "unverified",
    normalizedMetricRetention: RETENTION,
    sources: [],
    notes: ["Provider historical limits are not verified by a current primary source; do not expose extended execution."],
  },
  {
    version: HISTORICAL_INGESTION_CAPABILITY_VERSION,
    provider: "meta_ads",
    connectionProviderKeys: ["meta_ads"],
    warehouseIngestion: "implemented",
    historicalBackfill: "limited",
    readiness: "limited",
    defaultAutomaticBackfill: { days: 90, classification: "product_plan", note: "Approved automatic initial backfill policy." },
    maximumCustomerSelectableRange: EXTENDED_TWO_YEAR_PRODUCT_RANGE,
    maximumRequestSpan: INTERNAL_30_DAY_CHUNK,
    recommendedChunkSize: INTERNAL_30_DAY_CHUNK,
    providerLookbackCeiling: null,
    paginationStrategy: "Insights cursor pagination; automatic OAuth work is queued in 30-day slices, while custom Warehouse requests have an in-memory row guard.",
    reportingGrain: "daily campaign/ad metrics",
    asyncReportAvailability: "available",
    extendedExecutionVerification: "unverified",
    normalizedMetricRetention: RETENTION,
    sources: [META_INSIGHTS_SOURCE],
    notes: ["The public source does not verify a general daily-history ceiling for the current metric selection. Extended planning is allowed; execution fails closed."],
  },
  {
    version: HISTORICAL_INGESTION_CAPABILITY_VERSION,
    provider: "shopee",
    connectionProviderKeys: ["shopee"],
    warehouseIngestion: "implemented",
    historicalBackfill: "limited",
    readiness: "limited",
    defaultAutomaticBackfill: { days: 30, classification: "internal_safety", note: "Matches the current rolling default; not a verified provider allowance." },
    maximumCustomerSelectableRange: null,
    maximumRequestSpan: { days: 14, classification: "unverified", note: "Current code chunks at roughly this size, but a current primary-source limit is not recorded yet." },
    recommendedChunkSize: { days: 14, classification: "unverified", note: "Planning-only boundary until verified provider evidence is recorded." },
    providerLookbackCeiling: null,
    paginationStrategy: "cursor order pages followed by order-detail batches",
    reportingGrain: "daily order rollups",
    asyncReportAvailability: "unverified",
    extendedExecutionVerification: "unverified",
    normalizedMetricRetention: RETENTION,
    sources: [],
    notes: ["Do not claim two-year availability. Existing order-window behavior requires current official verification."],
  },
  {
    version: HISTORICAL_INGESTION_CAPABILITY_VERSION,
    provider: "shopee_ads",
    connectionProviderKeys: ["shopee"],
    warehouseIngestion: "implemented",
    historicalBackfill: "limited",
    readiness: "limited",
    defaultAutomaticBackfill: { days: 30, classification: "internal_safety", note: "Current generic rolling default; not a provider claim." },
    maximumCustomerSelectableRange: null,
    maximumRequestSpan: { days: 28, classification: "internal_safety", note: "Existing best-effort ads client chunks requests at 28 days." },
    recommendedChunkSize: { days: 28, classification: "internal_safety", note: "Existing best-effort ads client chunk boundary." },
    providerLookbackCeiling: null,
    paginationStrategy: "campaign-ID pages with date chunks",
    reportingGrain: "daily campaign/ad performance when partner access permits",
    asyncReportAvailability: "unverified",
    extendedExecutionVerification: "unverified",
    normalizedMetricRetention: RETENTION,
    sources: [],
    notes: ["Best-effort only; permission failures can intentionally leave orders successful. It is not a separately persisted connection provider."],
  },
  {
    version: HISTORICAL_INGESTION_CAPABILITY_VERSION,
    provider: "shopify",
    connectionProviderKeys: ["shopify"],
    warehouseIngestion: "unavailable",
    historicalBackfill: "unavailable",
    readiness: "unavailable",
    defaultAutomaticBackfill: { days: 0, classification: "unverified", note: "No Warehouse worker exists." },
    maximumCustomerSelectableRange: null,
    maximumRequestSpan: { days: 0, classification: "unverified", note: "No Warehouse worker exists." },
    recommendedChunkSize: { days: 0, classification: "unverified", note: "No Warehouse worker exists." },
    providerLookbackCeiling: null,
    paginationStrategy: "not implemented for Warehouse ingestion",
    reportingGrain: "not implemented for Warehouse ingestion",
    asyncReportAvailability: "unverified",
    extendedExecutionVerification: "not_applicable",
    normalizedMetricRetention: RETENTION,
    sources: [SHOPIFY_ORDERS_SOURCE],
    notes: ["Shopify API access scope is not equivalent to a Warehouse ingestion worker; historical Warehouse import remains unavailable."],
  },
  {
    version: HISTORICAL_INGESTION_CAPABILITY_VERSION,
    provider: "tiktok_business",
    connectionProviderKeys: ["tiktok_business"],
    warehouseIngestion: "implemented",
    historicalBackfill: "limited",
    readiness: "limited",
    defaultAutomaticBackfill: { days: 30, classification: "internal_safety", note: "Matches the current rolling default; not a verified provider allowance." },
    maximumCustomerSelectableRange: null,
    maximumRequestSpan: INTERNAL_30_DAY_CHUNK,
    recommendedChunkSize: INTERNAL_30_DAY_CHUNK,
    providerLookbackCeiling: null,
    paginationStrategy: "async report task and file download; sandbox response pagination",
    reportingGrain: "daily campaign metrics",
    asyncReportAvailability: "available",
    extendedExecutionVerification: "unverified",
    normalizedMetricRetention: RETENTION,
    sources: [],
    notes: ["Provider historical limits are application/account-specific in current code and are not verified here; extended execution must fail closed."],
  },
];

/** Stable provider ordering makes snapshots, documentation and plans deterministic. */
export const HISTORICAL_INGESTION_CAPABILITIES = freeze(
  [...records].sort((left, right) => left.provider.localeCompare(right.provider)),
);

export function getHistoricalIngestionCapability(
  provider: string,
): HistoricalIngestionCapability | undefined {
  return HISTORICAL_INGESTION_CAPABILITIES.find((capability) => capability.provider === provider);
}

/**
 * Backwards-compatible default for legacy connectors. Only canonical Meta and
 * Google records currently opt into the approved 90-day automatic policy.
 */
export function getAutomaticWarehouseBackfillDays(provider?: string): number {
  return getHistoricalIngestionCapability(provider ?? "")?.defaultAutomaticBackfill.days ?? 30;
}
