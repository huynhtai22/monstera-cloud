/**
 * Verified Weekly Performance Blueprint v1.
 *
 * One opinionated, customer-visible report built exclusively on the shared
 * production reporting primitives introduced by PR #152:
 *   - `loadReportReadiness` (evidence-based READY/NOT_READY/WARNING/UNKNOWN)
 *   - `reportingDataset` (canonical dataset fingerprint + evidence clock)
 *   - `DestinationDeliveryReceipt` currentness (no connection status as proof)
 *   - `Client.requiredProviders` / `requiredDestinations` / `requirementsConfiguredAt`
 * It never calls ad providers and never converts currency.
 *
 * Derived-metric semantics (blueprint display layer only):
 *   CTR  = clicks / impressions
 *   CPC  = spend / clicks
 *   CPA  = spend / conversions
 *   ROAS = conversion value (revenue) / spend
 * A zero denominator yields null ("unavailable") — never 0, never fabricated.
 * Monetary sums are only produced when every contributing row shares one
 * known currency; anything else renders provider sections separately.
 */

import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import {
  READINESS_MESSAGES,
  defaultReportingWindow,
  type ReportReadinessStatus,
  type ReportReadinessEvaluation,
} from "@/lib/report-readiness";
import { loadReportReadiness } from "@/lib/report-readiness-server";
import { REPORT_DATASET_CAP, reportingDataset } from "@/lib/report-delivery";
import type { ScopedTransaction } from "@/lib/warehouse-query";
import { getPlatformLabel } from "@/lib/client-export";
import { RbacError } from "@/lib/rbac";
import { withSystemScope } from "@/lib/tenant-guard";

export const BLUEPRINT_ID = "weekly-paid-media-performance";
export const BLUEPRINT_VERSION = 1;
export const BLUEPRINT_SCHEMA_VERSION = 2;
/**
 * Version of the normalized metric mapping this blueprint consumes.
 * Source of truth: the CampaignMetric table (UTC-day rows, string IDs,
 * per-row currency) written by the existing provider ingestion mappers.
 */
export const METRIC_CONTRACT_VERSION = "weekly-blueprint-metrics-v3";
/**
 * Blueprint v1 provider scope: the three paid-media providers this blueprint
 * supports. Marketplace providers (shopee, lazada) are deliberately OUT of
 * scope — their ad facts and order rollups are never combined here.
 */
export const BLUEPRINT_SUPPORTED_PROVIDERS = ["google_ads", "meta_ads", "tiktok_business"] as const;
/**
 * Authoritative aggregation grain PER SUPPORTED PROVIDER, derived from each
 * active ingestion path's actually persisted rows (not assumed):
 *   - google_ads:  "campaign"  (ad-platform-ingest.ts ingestGoogleAdsRows)
 *   - meta_ads:    "ad"        (sync-connection.ts syncMetaAds — the active
 *     sync fetches level:"ad" and deletes legacy campaign aggregates after a
 *     complete replacement, so production windows hold ad rows)
 *   - tiktok_business: "campaign" (ad-platform-ingest.ts ingestTiktokRows)
 * Rows at a provider's authoritative grain are aggregated (Meta ad rows roll
 * up to stable campaign identities). Rows at other grains are
 * non-authoritative duplicates and are ignored — never summed. A required
 * supported provider whose window rows exist ONLY at a non-authoritative
 * grain has unsupported grain evidence and fails verification closed.
 * Providers outside BLUEPRINT_SUPPORTED_PROVIDERS fail closed with
 * `unsupported_provider:<provider>` and are never aggregated.
 */
export const PROVIDER_SOURCE_GRAINS: Record<string, string> = {
  google_ads: "campaign",
  meta_ads: "ad",
  tiktok_business: "campaign",
};
export const MAX_CAMPAIGN_ROWS = 100;

export type BlueprintVerificationLabel = "VERIFIED" | "NOT_VERIFIED";

export type BlueprintReadinessStatus = ReportReadinessStatus;

// ---------------------------------------------------------------------------
// Canonical JSON + hashing
// ---------------------------------------------------------------------------

/** Deterministic JSON: object keys sorted recursively, arrays left as-is. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ---------------------------------------------------------------------------
// Reporting-window math (pure)
// ---------------------------------------------------------------------------

export type ReportingWindow = { start: string; end: string };

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function addDays(day: string, amount: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + amount));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** Day difference between two `YYYY-MM-DD` strings (b - a). */
export function daysBetween(a: string, b: string): number {
  const toTs = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toTs(b) - toTs(a)) / 86_400_000);
}

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Reject impossible calendar dates (e.g. 2026-02-31): Date.parse silently
  // rolls them forward, so require the canonical UTC round-trip.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The last fully elapsed Monday–Sunday week, in UTC calendar dates (the
 * window vocabulary shared with `evaluateReportReadiness` and
 * `reportingDataset`). Pure: same inputs always produce the same window.
 */
export function lastCompleteWeek(now: Date = new Date()): ReportingWindow {
  const today = now.toISOString().slice(0, 10);
  const dow = new Date(`${today}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
  const thisWeekStart = addDays(today, -(dow + 6) % 7);
  const start = addDays(thisWeekStart, -7);
  return { start, end: addDays(start, 6) };
}

/** Validated explicit seven-day window. */
export function resolveExplicitWindow(start: string, end: string): ReportingWindow {
  if (!isValidDateString(start) || !isValidDateString(end)) {
    throw new BlueprintInputError("Reporting window must use YYYY-MM-DD dates");
  }
  if (daysBetween(start, end) !== 6) {
    throw new BlueprintInputError("Reporting window must span exactly 7 days");
  }
  return { start, end };
}

export function comparisonWindowFor(window: ReportingWindow): ReportingWindow {
  const end = addDays(window.start, -1);
  return { start: addDays(end, -6), end };
}

/** True when the window's final day has fully elapsed (UTC calendar). */
export function windowIsComplete(window: ReportingWindow, now: Date = new Date()): boolean {
  return daysBetween(window.end, now.toISOString().slice(0, 10)) > 0;
}

/**
 * The shared default window when no explicit window is chosen: PR #152's
 * authoritative `defaultReportingWindow` (rolling 7 days ending yesterday,
 * UTC) so the blueprint never invents a second default-window rule.
 */
export const defaultBlueprintWindow = defaultReportingWindow;

// ---------------------------------------------------------------------------
// Metric aggregation (pure)
// ---------------------------------------------------------------------------

export type MetricRowInput = {
  platform: string;
  connectionId: string;
  accountId: string;
  accountName: string | null;
  campaignId: string;
  campaignName: string;
  entityId: string;
  level: string;
  date: Date;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
  currency: string | null;
};

export type BlueprintMetrics = {
  /** Single verified currency, or null when mixed/unknown/no rows. */
  currency: string | null;
  monetaryAvailable: boolean;
  currencies: string[];
  spend: number | null;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number | null;
  ctr: number | null;
  cpc: number | null;
  cpa: number | null;
  roas: number | null;
};

function normalizeCurrency(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase() || "UNKNOWN";
}

function finiteOrZero(value: number | null | undefined): number {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Quantize floats so in-memory values survive the JSONB round-trip exactly
 * (Prisma's engine truncates Json numbers to ~16 significant digits;
 * (Postgres numeric normalization would otherwise shave the 16th digit and
 * make stored snapshots differ from freshly derived ones).
 */
function quantize(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(4));
}

/** Derived ratio; null when the denominator is zero or an input is unavailable. */
export function safeRatio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

export function aggregateBlueprintMetrics(rows: MetricRowInput[]): BlueprintMetrics {
  const currencies = [...new Set(rows.map((row) => normalizeCurrency(row.currency)))].sort();
  const monetaryAvailable = currencies.length === 1 && currencies[0] !== "UNKNOWN";
  const currency = monetaryAvailable ? currencies[0] : null;

  const impressions = rows.reduce((sum, row) => sum + finiteOrZero(row.impressions), 0);
  const clicks = rows.reduce((sum, row) => sum + finiteOrZero(row.clicks), 0);
  const conversions = rows.reduce((sum, row) => sum + finiteOrZero(row.conversions), 0);
  const spend = monetaryAvailable
    ? quantize(rows.reduce((sum, row) => sum + finiteOrZero(row.spend), 0))
    : null;
  const conversionValue = monetaryAvailable
    ? quantize(rows.reduce((sum, row) => sum + finiteOrZero(row.revenue), 0))
    : null;

  return {
    currency,
    monetaryAvailable,
    currencies,
    spend,
    impressions,
    clicks,
    conversions,
    conversionValue,
    ctr: (value => value === null ? null : quantize(value))(safeRatio(clicks, impressions)),
    cpc: (value => value === null ? null : quantize(value))(safeRatio(spend, clicks)),
    cpa: (value => value === null ? null : quantize(value))(safeRatio(spend, conversions)),
    roas: (value => value === null ? null : quantize(value))(safeRatio(conversionValue, spend)),
  };
}

export type PercentDelta = {
  field: string;
  current: number | null;
  previous: number | null;
  /** Percent change vs previous; null when not comparable (no baseline / zero baseline). */
  deltaPercent: number | null;
};

function percentDelta(field: string, current: number | null, previous: number | null): PercentDelta {
  if (current === null || previous === null || previous === 0) {
    return { field, current, previous, deltaPercent: null };
  }
  return { field, current, previous, deltaPercent: quantize(((current - previous) / previous) * 100) };
}

const DELTA_FIELDS = ["spend", "impressions", "clicks", "conversions", "conversionValue"] as const;

/** Deltas only when both windows are complete and currency-comparable. */
export function computeMetricsDeltas(current: BlueprintMetrics, previous: BlueprintMetrics): PercentDelta[] {
  const comparable = current.currency !== null
    && previous.currency !== null
    && current.currency === previous.currency;
  return DELTA_FIELDS.map((field) => percentDelta(
    field,
    comparable ? current[field] : null,
    comparable ? previous[field] : null,
  ));
}

/**
 * Canonical identity for a campaign across windows: platform + account +
 * stable provider entity id (campaignId, falling back to entityId) +
 * currency. The mutable campaign NAME is deliberately NOT part of the
 * identity — a renamed campaign stays one row. IDs stay exact strings.
 */
function campaignKey(row: MetricRowInput): string {
  return [
    row.platform,
    row.accountId,
    row.campaignId || row.entityId,
    normalizeCurrency(row.currency),
  ].join(":::");
}

/** Deterministic display name: the latest row's (by date, then entityId). */
function stableCampaignName(rows: MetricRowInput[]): string {
  const latest = rows.reduce((best, row) => {
    const bestTs = best.date.getTime();
    const rowTs = row.date.getTime();
    if (rowTs > bestTs) return row;
    if (rowTs === bestTs && row.entityId > best.entityId) return row;
    return best;
  });
  return latest.campaignName || latest.campaignId || latest.entityId;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export type CampaignMetricsRow = {
  provider: string;
  providerLabel: string;
  campaignId: string;
  campaignName: string;
  accountId: string;
  accountName: string | null;
  currency: string | null;
  spend: number | null;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number | null;
  cpa: number | null;
  roas: number | null;
  changes: PercentDelta[];
};

export function buildCampaignTable(
  currentRows: MetricRowInput[],
  previousRows: MetricRowInput[],
  limit: number = MAX_CAMPAIGN_ROWS,
): { campaigns: CampaignMetricsRow[]; totalTracked: number; truncated: boolean } {
  const previousGroups = new Map<string, MetricRowInput[]>();
  for (const row of previousRows) {
    const key = campaignKey(row);
    const bucket = previousGroups.get(key);
    if (bucket) bucket.push(row);
    else previousGroups.set(key, [row]);
  }

  const groups = new Map<string, MetricRowInput[]>();
  for (const row of currentRows) {
    const key = campaignKey(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const campaigns: CampaignMetricsRow[] = [];
  for (const bucket of groups.values()) {
    const metrics = aggregateBlueprintMetrics(bucket);
    const previousRows = previousGroups.get(campaignKey(bucket[0]));
    const previous = previousRows ? aggregateBlueprintMetrics(previousRows) : null;
    const first = bucket[0];
    campaigns.push({
      provider: first.platform,
      providerLabel: getPlatformLabel(first.platform),
      // IDs are preserved verbatim as strings — never coerced to numbers.
      // Identity is (platform, account, campaignId||entityId, currency);
      // the display name is the latest row's, so renames never split rows.
      campaignId: first.campaignId || first.entityId,
      campaignName: stableCampaignName(bucket),
      accountId: first.accountId,
      accountName: first.accountName,
      currency: metrics.currency,
      spend: metrics.spend,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      conversions: metrics.conversions,
      conversionValue: metrics.conversionValue,
      cpa: metrics.cpa,
      roas: metrics.roas,
      changes: previous ? computeMetricsDeltas(metrics, previous) : [],
    });
  }

  campaigns.sort((a, b) =>
    compareStrings(a.provider, b.provider)
    || compareStrings(a.campaignName, b.campaignName)
    || compareStrings(a.campaignId, b.campaignId)
    || compareStrings(a.accountId, b.accountId)
    || compareStrings(a.currency ?? "", b.currency ?? ""),
  );

  return {
    campaigns: campaigns.slice(0, limit),
    totalTracked: campaigns.length,
    truncated: campaigns.length > limit,
  };
}

// ---------------------------------------------------------------------------
// Verification semantics
// ---------------------------------------------------------------------------

export type VerificationInput = {
  /** The shared evaluator's status for this exact client + window. */
  readinessStatus: BlueprintReadinessStatus;
  /** Requirements must be explicitly configured, never inferred from sources. */
  requiredProvidersBasis: "assigned_sources" | "explicit";
  requiredProviders: string[];
  includedProviders: string[];
  hasMetricData: boolean;
  aggregationCompatible: boolean;
  /** Required providers whose window rows exist only at a non-authoritative
   *  grain (unknown/unsupported grain evidence) — fails verification closed. */
  grainUnsupportedProviders: string[];
  /** Required providers outside the blueprint's supported scope. */
  unsupportedProviders: string[];
  currencyVerified: boolean;
  windowComplete: boolean;
  timezoneVerified: boolean;
  destinationsRequired: string[];
  destinationsVerified: boolean;
  datasetLimited: boolean;
  generatorVersionRecorded: boolean;
  dependencyHashMatches: boolean;
};

export type VerificationResult = {
  status: BlueprintVerificationLabel;
  reasons: string[];
};

/**
 * `VERIFIED` requires every gate, including the shared evaluator returning
 * READY (which itself encodes source health, window coverage, timezone and
 * currency context, and current destination receipts). Any other state keeps
 * the underlying readiness status and exact recovery reasons.
 */
export function computeVerificationStatus(input: VerificationInput): VerificationResult {
  const reasons: string[] = [];
  if (input.readinessStatus !== "READY") {
    reasons.push(`readiness_not_ready:${input.readinessStatus}`);
  }
  if (input.requiredProvidersBasis !== "explicit") {
    reasons.push("required_providers_inferred");
  }
  if (input.requiredProviders.length === 0) {
    reasons.push("required_providers_not_configured");
  }
  const missing = input.requiredProviders.filter((p) => !input.includedProviders.includes(p));
  if (missing.length > 0) {
    reasons.push(`required_providers_missing:${missing.join(",")}`);
  }
  if (!input.hasMetricData) reasons.push("no_metric_data");
  if (!input.aggregationCompatible) reasons.push("incompatible_metric_semantics");
  if (input.grainUnsupportedProviders.length > 0) {
    reasons.push(`aggregation_grain_unsupported:${input.grainUnsupportedProviders.sort().join(",")}`);
  }
  if (input.unsupportedProviders.length > 0) {
    reasons.push(`unsupported_provider:${input.unsupportedProviders.sort().join(",")}`);
  }
  if (!input.currencyVerified) reasons.push("currency_unverified");
  if (!input.windowComplete) reasons.push("window_incomplete");
  if (!input.timezoneVerified) reasons.push("reporting_timezone_unverified");
  if (input.destinationsRequired.length === 0) {
    reasons.push("destination_requirements_missing");
  } else if (!input.destinationsVerified) {
    reasons.push("destination_evidence_missing");
  }
  if (input.datasetLimited) reasons.push("evidence_limit_reached");
  if (!input.generatorVersionRecorded) reasons.push("generator_version_unrecorded");
  if (!input.dependencyHashMatches) reasons.push("dependency_evidence_changed");

  return {
    status: reasons.length === 0 ? "VERIFIED" : "NOT_VERIFIED",
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Dependency state (staleness evidence)
// ---------------------------------------------------------------------------

export type DependencyState = {
  requirement: {
    requiredProviders: string[];
    requiredDestinations: string[];
    requirementsConfiguredAt: string | null;
  } | null;
  /** Canonical dataset fingerprint from PR #152's `reportingDataset`. */
  datasetFingerprint: string;
  evidenceAt: string;
  dataThroughDate: string | null;
  rowCount: number;
  /** The comparison (previous) window is bound with equal authority. */
  comparisonDatasetFingerprint: string;
  comparisonEvidenceAt: string;
  comparisonDataThroughDate: string | null;
  comparisonRowCount: number;
  /** Latest receipt per required destination, currentness vs THIS dataset. */
  receipts: Array<{
    id: string;
    destination: string;
    retrievedAt: string;
    dataThroughDate: string;
    current: boolean;
  }>;
  contractVersions: Record<string, string>;
};

export const STALE_REASON_LABELS: Record<string, string> = {
  requirement_changed: "Client reporting requirements changed after generation",
  dataset_changed: "Underlying warehouse data or reporting context changed after generation",
  destination_evidence_changed: "Delivery evidence changed, expired or was replaced after generation",
  contract_changed: "Metric contract version changed after generation",
};

function diffDependencyComponents(stored: DependencyState, current: DependencyState): string[] {
  const reasons: string[] = [];
  if (canonicalJson(stored.requirement) !== canonicalJson(current.requirement)) {
    reasons.push("requirement_changed");
  }
  if (stored.datasetFingerprint !== current.datasetFingerprint
    || stored.evidenceAt !== current.evidenceAt
    || stored.dataThroughDate !== current.dataThroughDate
    || stored.rowCount !== current.rowCount) {
    reasons.push("dataset_changed");
  }
  if (stored.comparisonDatasetFingerprint !== current.comparisonDatasetFingerprint
    || stored.comparisonEvidenceAt !== current.comparisonEvidenceAt
    || stored.comparisonDataThroughDate !== current.comparisonDataThroughDate
    || stored.comparisonRowCount !== current.comparisonRowCount) {
    reasons.push("dataset_changed");
  }
  if (canonicalJson(stored.receipts) !== canonicalJson(current.receipts)) {
    reasons.push("destination_evidence_changed");
  }
  if (canonicalJson(stored.contractVersions) !== canonicalJson(current.contractVersions)) {
    reasons.push("contract_changed");
  }
  return reasons;
}

export function computeDependencyHash(state: DependencyState): string {
  return sha256Hex(canonicalJson(state));
}

// ---------------------------------------------------------------------------
// Report model
// ---------------------------------------------------------------------------

export type ProviderBreakdownStatus = "included" | "no_data" | "unsupported";

export type ProviderBreakdown = {
  provider: string;
  providerLabel: string;
  required: boolean;
  /** included = authoritative rows aggregated; no_data = supported, no rows;
   *  unsupported = outside blueprint scope — metrics are deliberately null. */
  status: ProviderBreakdownStatus;
  included: boolean;
  /** null when the provider is out of scope: never render numeric zeros or
   *  derived metrics for a provider this blueprint does not support. */
  metrics: BlueprintMetrics | null;
  changes: PercentDelta[];
  dataThrough: string | null;
  explanation: string;
};

export type BlueprintReport = {
  overview: {
    clientName: string;
    blueprintId: string;
    blueprintVersion: number;
    reportingWindow: ReportingWindow;
    comparisonWindow: ReportingWindow | null;
    reportingTimezone: string | null;
    currency: string | null;
    requiredProviders: string[];
    requiredDestinations: string[];
    includedProviders: string[];
    includedAccounts: Array<{ provider: string; accountId: string; connectionId: string }>;
    generatedAt: string;
    verification: VerificationResult;
    readiness: {
      status: BlueprintReadinessStatus;
      blockers: string[];
      warnings: string[];
      destinationState: ReportReadinessEvaluation["destination"]["state"];
    };
  };
  totals: BlueprintMetrics & { scope: "combined" | "by_provider_only" };
  providers: ProviderBreakdown[];
  campaigns: CampaignMetricsRow[];
  campaignTruncated: boolean;
  campaignTotal: number;
};

export class BlueprintInputError extends Error {
  readonly code: string;
  constructor(message: string, code = "blueprint_input_invalid") {
    super(message);
    this.name = "BlueprintInputError";
    this.code = code;
  }
}

function explanationFor(
  provider: string,
  evaluation: ReportReadinessEvaluation,
  metrics: BlueprintMetrics | null,
  included: boolean,
): string {
  if (!(BLUEPRINT_SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
    return "Out of scope. This provider is outside Verified Weekly Performance Blueprint v1 (Google Ads, Meta Ads, TikTok Ads). Its rows are never aggregated in this report; remove it from the client's required providers or use the broader reporting workflows.";
  }
  if (!included || !metrics) {
    const entry = evaluation.providers.find((p) => p.provider === provider);
    const message = entry?.blockers.map((issue) => READINESS_MESSAGES[issue.code]).find(Boolean)
      ?? READINESS_MESSAGES.SOURCE_MISSING;
    return `No normalized data exists for this provider in the selected window. ${message}`;
  }
  if (!metrics.monetaryAvailable) {
    return `Rows report mixed or unknown currencies (${metrics.currencies.join(", ")}); monetary totals are intentionally unavailable and no conversion is performed.`;
  }
  return "Complete coverage with verified reporting context for this window.";
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

type ConnectionSummary = {
  id: string;
  provider: string;
  remoteAccountId: string;
  status: string;
  lastDataThrough: Date | null;
};

/** UTC day bounds — the same window vocabulary as `reportingDataset`. */
function windowDateRange(window: ReportingWindow): { gte: Date; lte: Date } {
  return {
    gte: new Date(`${window.start}T00:00:00.000Z`),
    lte: new Date(`${window.end}T23:59:59.999Z`),
  };
}

async function loadWindowRows(
  tx: ScopedTransaction,
  workspaceId: string,
  clientId: string,
  providers: string[],
  window: ReportingWindow,
): Promise<{ rows: MetricRowInput[]; limited: boolean }> {
  const range = windowDateRange(window);
  const rows = await tx.campaignMetric.findMany({
    where: {
      workspaceId,
      platform: { in: providers },
      connection: { clientId, workspaceId },
      date: { gte: range.gte, lte: range.lte },
    },
    select: {
      platform: true,
      connectionId: true,
      accountId: true,
      accountName: true,
      campaignId: true,
      campaignName: true,
      entityId: true,
      level: true,
      date: true,
      impressions: true,
      clicks: true,
      spend: true,
      conversions: true,
      revenue: true,
      currency: true,
    },
    orderBy: [{ id: "asc" }],
    take: REPORT_DATASET_CAP + 1,
  });
  const limited = rows.length > REPORT_DATASET_CAP;
  return { rows: rows.slice(0, REPORT_DATASET_CAP), limited };
}

// ---------------------------------------------------------------------------
// Generation context
// ---------------------------------------------------------------------------

type GenerationContext = {
  workspaceId: string;
  clientId: string;
  clientName: string;
  clientRequirement: {
    requiredProviders: string[];
    requiredDestinations: string[];
    requirementsConfiguredAt: string | null;
  };
  window: ReportingWindow;
  comparisonWindow: ReportingWindow;
  connections: ConnectionSummary[];
  /** Campaign-grain rows only — the authoritative aggregation grain. */
  currentRows: MetricRowInput[];
  previousRows: MetricRowInput[];
  /** Rows at other grains in the window make aggregation ambiguous. */
  grainUnsupportedProviders: string[];
  rowsLimited: boolean;
  evaluation: ReportReadinessEvaluation;
  dataset: Awaited<ReturnType<typeof reportingDataset>>;
  comparisonDataset: Awaited<ReturnType<typeof reportingDataset>>;
  /** Latest receipt per required destination, currentness vs THIS dataset. */
  receipts: DependencyState["receipts"];
};

function buildDependencyState(ctx: GenerationContext): DependencyState {
  return {
    requirement: { ...ctx.clientRequirement },
    datasetFingerprint: ctx.dataset.fingerprint,
    evidenceAt: new Date(ctx.dataset.evidenceAt).toISOString(),
    dataThroughDate: ctx.dataset.dataThroughDate,
    rowCount: ctx.dataset.rowCount,
    comparisonDatasetFingerprint: ctx.comparisonDataset.fingerprint,
    comparisonEvidenceAt: new Date(ctx.comparisonDataset.evidenceAt).toISOString(),
    comparisonDataThroughDate: ctx.comparisonDataset.dataThroughDate,
    comparisonRowCount: ctx.comparisonDataset.rowCount,
    receipts: ctx.receipts.map((receipt) => ({ ...receipt })),
    contractVersions: {
      metrics: METRIC_CONTRACT_VERSION,
      dataset: "reporting-dataset-v1",
    },
  };
}

export function computeGenerationKey(
  workspaceId: string,
  clientId: string,
  window: ReportingWindow,
  comparisonWindow: ReportingWindow,
): string {
  return sha256Hex(canonicalJson({
    workspaceId,
    clientId,
    blueprintId: BLUEPRINT_ID,
    blueprintVersion: BLUEPRINT_VERSION,
    reportingWindow: window,
    comparisonWindow,
  }));
}

function currencyVerifiedFor(totals: BlueprintMetrics, evaluation: ReportReadinessEvaluation): boolean {
  return totals.monetaryAvailable
    && evaluation.currencies.length === 1
    && evaluation.currencies[0] === totals.currency;
}

function aggregationCompatibleFor(currentRows: MetricRowInput[], totals: BlueprintMetrics): boolean {
  if (totals.monetaryAvailable) return true;
  // Mixed overall is acceptable only when every provider scope is internally
  // compatible; combined monetary totals stay unavailable either way.
  const platforms = [...new Set(currentRows.map((row) => row.platform))];
  return platforms.every((provider) => {
    const providerMetrics = aggregateBlueprintMetrics(
      currentRows.filter((row) => row.platform === provider),
    );
    return providerMetrics.monetaryAvailable || providerMetrics.currencies.length === 0;
  });
}

function buildProviderBreakdowns(ctx: GenerationContext): {
  providers: ProviderBreakdown[];
  includedProviders: string[];
  includedAccounts: Array<{ provider: string; accountId: string; connectionId: string }>;
} {
  const providers: ProviderBreakdown[] = [];
  const includedProviders: string[] = [];
  const includedAccounts: Array<{ provider: string; accountId: string; connectionId: string }> = [];

  for (const provider of ctx.clientRequirement.requiredProviders) {
    const isSupported = (BLUEPRINT_SUPPORTED_PROVIDERS as readonly string[]).includes(provider);
    if (!isSupported) {
      const partial: Omit<ProviderBreakdown, "explanation"> = {
        provider,
        providerLabel: getPlatformLabel(provider),
        required: true,
        status: "unsupported",
        included: false,
        metrics: null,
        changes: [],
        dataThrough: null,
      };
      providers.push({ ...partial, explanation: explanationFor(provider, ctx.evaluation, null, false) });
      continue;
    }
    const currentRows = ctx.currentRows.filter((row) => row.platform === provider);
    const previousRows = ctx.previousRows.filter((row) => row.platform === provider);
    const metrics = aggregateBlueprintMetrics(currentRows);
    const hasData = currentRows.length > 0;
    if (hasData) {
      includedProviders.push(provider);
      // Included account/connection evidence is derived from ACTUAL metric
      // rows: distinct (connectionId, accountId) pairs as stored. Never
      // reconstructed by matching account ids against Connection labels.
      const pairs = [...new Map(
        currentRows.map((row) => [`${row.connectionId}::${row.accountId}`, { provider, accountId: row.accountId, connectionId: row.connectionId }]),
      ).values()].sort((a, b) => compareStrings(a.accountId, b.accountId) || compareStrings(a.connectionId, b.connectionId));
      includedAccounts.push(...pairs);
    }
    const dataThrough = ctx.evaluation.providers
      .find((entry) => entry.provider === provider)?.latestDataDate ?? null;
    const partial = {
      provider,
      providerLabel: getPlatformLabel(provider),
      required: true,
      status: hasData ? "included" as const : "no_data" as const,
      included: hasData,
      metrics,
      changes: computeMetricsDeltas(metrics, aggregateBlueprintMetrics(previousRows)),
      dataThrough,
    };
    providers.push({ ...partial, explanation: explanationFor(provider, ctx.evaluation, metrics, hasData) });
  }

  includedAccounts.sort((a, b) =>
    compareStrings(a.provider, b.provider) || compareStrings(a.accountId, b.accountId));
  includedProviders.sort();
  return { providers, includedProviders, includedAccounts };
}

function buildReport(ctx: GenerationContext, verification: VerificationResult): BlueprintReport {
  const totals = aggregateBlueprintMetrics(ctx.currentRows);
  const { providers, includedProviders, includedAccounts } = buildProviderBreakdowns(ctx);
  const timezones = ctx.evaluation.timezones;

  return {
    overview: {
      clientName: ctx.clientName,
      blueprintId: BLUEPRINT_ID,
      blueprintVersion: BLUEPRINT_VERSION,
      reportingWindow: ctx.window,
      comparisonWindow: ctx.comparisonWindow,
      reportingTimezone: timezones.length === 1 ? timezones[0] : null,
      currency: totals.currency,
      requiredProviders: ctx.clientRequirement.requiredProviders,
      requiredDestinations: ctx.clientRequirement.requiredDestinations,
      includedProviders,
      includedAccounts,
      generatedAt: new Date().toISOString(),
      verification,
      readiness: {
        status: ctx.evaluation.status,
        blockers: ctx.evaluation.blockers.map((issue) => issue.code),
        warnings: ctx.evaluation.warnings.map((issue) => issue.code),
        destinationState: ctx.evaluation.destination.state,
      },
    },
    totals: { ...totals, scope: totals.monetaryAvailable ? "combined" : "by_provider_only" },
    providers,
    campaigns: [],
    campaignTruncated: false,
    campaignTotal: 0,
  };
}

function buildVerification(
  ctx: GenerationContext,
  totals: BlueprintMetrics,
  rowsLimited: boolean,
  dependencyHashMatches: boolean,
): VerificationResult {
  const includedProviders = [...new Set(ctx.currentRows.map((row) => row.platform))];
  return computeVerificationStatus({
    readinessStatus: ctx.evaluation.status,
    requiredProvidersBasis: ctx.evaluation.requiredProvidersBasis,
    requiredProviders: ctx.clientRequirement.requiredProviders,
    includedProviders,
    hasMetricData: ctx.currentRows.length > 0,
    aggregationCompatible: aggregationCompatibleFor(ctx.currentRows, totals),
    grainUnsupportedProviders: ctx.grainUnsupportedProviders,
    unsupportedProviders: ctx.clientRequirement.requiredProviders.filter(
      (provider) => !(BLUEPRINT_SUPPORTED_PROVIDERS as readonly string[]).includes(provider),
    ),
    currencyVerified: currencyVerifiedFor(totals, ctx.evaluation),
    windowComplete: windowIsComplete(ctx.window),
    timezoneVerified: ctx.evaluation.timezones.length === 1,
    destinationsRequired: ctx.clientRequirement.requiredDestinations,
    destinationsVerified: ctx.clientRequirement.requiredDestinations.length > 0
      && ctx.clientRequirement.requiredDestinations.every((name) => ctx.receipts.some((receipt) => receipt.destination === name && receipt.current)),
    datasetLimited: rowsLimited || ctx.dataset.limited || ctx.comparisonDataset.limited || ctx.evaluation.evidence.limited,
    generatorVersionRecorded: Boolean(
      process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA,
    ),
    dependencyHashMatches,
  });
}

// ---------------------------------------------------------------------------
// Snapshot persistence + staleness
// ---------------------------------------------------------------------------

export type SnapshotMeta = {
  id: string;
  sequence: number;
  blueprintId: string;
  blueprintVersion: number;
  generationKey: string;
  dependencyHash: string;
  verificationStatus: string;
  verificationReasons: string[];
  generatedAt: Date;
  reportingWindowStart: Date;
  reportingWindowEnd: Date;
};

export type GenerateResult = {
  snapshot: SnapshotMeta;
  report: BlueprintReport;
  created: boolean;
  readiness: {
    status: BlueprintReadinessStatus;
    blockers: string[];
    warnings: string[];
    destinationState: ReportReadinessEvaluation["destination"]["state"];
  };
};

function toSnapshotMeta(snapshot: {
  id: string;
  sequence: number;
  blueprintId: string;
  blueprintVersion: number;
  generationKey: string;
  dependencyHash: string;
  verificationStatus: string;
  verificationReasons: string[];
  generatedAt: Date;
  reportingWindowStart: Date;
  reportingWindowEnd: Date;
}): SnapshotMeta {
  return {
    id: snapshot.id,
    sequence: snapshot.sequence,
    blueprintId: snapshot.blueprintId,
    blueprintVersion: snapshot.blueprintVersion,
    generationKey: snapshot.generationKey,
    dependencyHash: snapshot.dependencyHash,
    verificationStatus: snapshot.verificationStatus,
    verificationReasons: snapshot.verificationReasons,
    generatedAt: snapshot.generatedAt,
    reportingWindowStart: snapshot.reportingWindowStart,
    reportingWindowEnd: snapshot.reportingWindowEnd,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error) && typeof error === "object" && (error as { code?: string }).code === "P2002";
}

/** Candidate discarded because a canonical dependency moved during publication. */
class CandidateSupersededError extends Error {
  constructor() {
    super("Publication candidate superseded by newer dependencies");
    this.name = "CandidateSupersededError";
  }
}

/** Prisma wraps Postgres 40001 serialization failures as P2034. */
function isSerializationFailure(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "P2034" || code === "40001";
}

/**
 * @internal TEST-ONLY seam for deterministic publication interleaving.
 * Never called by routes; not exposed through any API or Zod input.
 */
const publicationHooks: { afterEvidence?: (info: { generationKey: string }) => Promise<void> } = {};

/** @internal TEST-ONLY. Install/remove deterministic publication hooks. */
export function _setPublicationTestHooks(hooks: { afterEvidence?: (info: { generationKey: string }) => Promise<void> }): void {
  publicationHooks.afterEvidence = hooks.afterEvidence;
}

/** Create a snapshot row through an explicit transaction client. The tenant
 *  guard's bulk/create rule is satisfied by the explicit workspaceId fields. */
function prismaReportSnapshotCreate(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  data: Record<string, unknown>,
): Promise<{
  id: string;
  sequence: number;
  blueprintId: string;
  blueprintVersion: number;
  generationKey: string;
  dependencyHash: string;
  verificationStatus: string;
  verificationReasons: string[];
  readinessStatus: string;
  readinessEvidence: unknown;
  result: unknown;
  generatedAt: Date;
  reportingWindowStart: Date;
  reportingWindowEnd: Date;
}> {
  return withSystemScope(() => (tx as unknown as {
    reportSnapshot: { create: (args: { data: Record<string, unknown> }) => Promise<{
      id: string;
      sequence: number;
      blueprintId: string;
      blueprintVersion: number;
      generationKey: string;
      dependencyHash: string;
      verificationStatus: string;
      verificationReasons: string[];
      readinessStatus: string;
      readinessEvidence: unknown;
      result: unknown;
      generatedAt: Date;
      reportingWindowStart: Date;
      reportingWindowEnd: Date;
    }> };
  }).reportSnapshot.create({ data }));
}

/**
 * Generate (or idempotently return) the blueprint snapshot for a canonical
 * input. Existing snapshots are never overwritten: when dependencies changed
 * a new immutable sequence is created. Shared-readiness READY plus every
 * verification gate produces the customer-facing `VERIFIED` label; anything
 * else stores the underlying readiness state and exact recovery reasons.
 */
export async function generateWeeklyBlueprint(params: {
  workspaceId: string;
  clientId: string;
  windowStart?: string;
  windowEnd?: string;
  now?: Date;
}): Promise<GenerateResult> {
  const { workspaceId, clientId, now = new Date() } = params;

  // Outer lookup: authorization/existence ONLY. Its mutable reporting fields
  // are deliberately NOT selected — they can never participate in generation.
  const clientExists = await prisma.client.findFirst({
    where: { id: clientId, workspaceId },
    select: { id: true },
  });
  if (!clientExists) {
    throw new BlueprintInputError("Client not found in this workspace.", "client_not_found");
  }

  if (Boolean(params.windowStart) !== Boolean(params.windowEnd)) {
    throw new BlueprintInputError(
      "Provide both windowStart and windowEnd, or neither (the last complete week is used).",
      "window_boundary_incomplete",
    );
  }
  // The blueprint's opinionated default is the last complete Monday–Sunday
  // week (UTC calendar dates, shared with the evaluator's window vocabulary).
  // POST and reopen MUST resolve the same default or the UI diverges.
  const window = params.windowStart && params.windowEnd
    ? resolveExplicitWindow(params.windowStart, params.windowEnd)
    : lastCompleteWeek(now);
  const comparisonWindow = comparisonWindowFor(window);
  const generationKey = computeGenerationKey(workspaceId, clientId, window, comparisonWindow);

  /**
   * ATOMIC VERIFICATION-PUBLICATION POINT.
   *
   * One READ COMMITTED transaction performs, in order:
   *   1. generation serialization (advisory lock) as the FIRST statement —
   *      while it blocks, no snapshot is established, so the evidence read
   *      that follows is always fresh (never a stale RepeatableRead view
   *      captured while queued);
   *   2. the client requirement row locked FOR UPDATE — requirement PATCHes
   *      cannot commit between requirement evaluation and snapshot publication;
   *   3. readiness, requirements, reporting context, both scoped dataset
   *      fingerprints, exact metric rows and receipt currentness from this
   *      authoritative transaction state;
   *   4. idempotency lookup, sequence allocation and snapshot insertion in the
   *      same transaction;
   *   5. a final re-validation that recomputes the canonical dependency state
   *      from fresh reads and DISCARDS the candidate (retry, bounded) when any
   *      dependency moved between evaluation and publication. If the candidate
   *      cannot be stabilized, the error is retryable — a stale VERIFIED result
   *      is never returned.
   * `generatedAt` comes from the successful publication state.
   */
  const MAX_PUBLICATION_ATTEMPTS = 3;
  let lastContention: unknown = null;
  for (let attempt = 1; attempt <= MAX_PUBLICATION_ATTEMPTS; attempt += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${generationKey}))`;
        // Lock the requirement row so requirement PATCHes wait for publication.
        await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
        const client = await tx.client.findFirst({
          where: { id: clientId, workspaceId },
          select: {
            id: true,
            name: true,
            requiredProviders: true,
            requiredDestinations: true,
            requirementsConfiguredAt: true,
          },
        });
        if (!client) {
          throw new BlueprintInputError("Client not found in this workspace.", "client_not_found");
        }
        if (client.requiredProviders.length === 0 || client.requiredDestinations.length === 0
          || !client.requirementsConfiguredAt) {
          throw new BlueprintInputError(
            "Reporting requirements are not configured for this client. An owner or admin must choose required providers and destinations in Clients before a verified report can be generated.",
            "requirements_not_configured",
          );
        }

        const readiness = await loadReportReadiness(workspaceId, window, { clientId, tx });
        const evaluation = readiness.evaluations[0];
        if (!evaluation) {
          throw new BlueprintInputError("Client not found in this workspace.", "client_not_found");
        }

        const providerScope = [...client.requiredProviders].sort();
        const [dataset, comparisonDataset] = await Promise.all([
          reportingDataset(tx, workspaceId, clientId, window, providerScope),
          reportingDataset(tx, workspaceId, clientId, comparisonWindow, providerScope),
        ]);
        const [connections, currentWindow, previousWindow, receiptRows] = await Promise.all([
          tx.connection.findMany({
            where: {
              workspaceId,
              clientId,
              type: "source",
              provider: { in: client.requiredProviders },
            },
            select: {
              id: true,
              provider: true,
              remoteAccountId: true,
              status: true,
              lastDataThrough: true,
            },
            orderBy: [{ id: "asc" }],
          }),
          loadWindowRows(tx, workspaceId, clientId, client.requiredProviders, window),
          loadWindowRows(tx, workspaceId, clientId, client.requiredProviders, comparisonWindow),
          Promise.all(client.requiredDestinations.map((destination) =>
            tx.destinationDeliveryReceipt.findFirst({
              where: { workspaceId, clientId, destination, windowStart: window.start, windowEnd: window.end },
              orderBy: [{ retrievedAt: "desc" }, { id: "desc" }],
            }))),
        ]);

        // Receipt currentness is evaluated against THIS transaction's scoped
        // dataset fingerprint (PR #152's exact rule).
        const receipts: DependencyState["receipts"] = receiptRows.flatMap((receipt) => receipt ? [{
          id: receipt.id,
          destination: receipt.destination,
          retrievedAt: receipt.retrievedAt.toISOString(),
          dataThroughDate: receipt.dataThroughDate,
          current: !dataset.limited
            && receipt.datasetFingerprint === dataset.fingerprint
            && receipt.retrievedAt.getTime() >= dataset.evidenceAt,
        }] : []);

        // Per-provider authoritative grain resolution (blueprint scope only).
        const requiredProviders = [...client.requiredProviders].sort();
        const unsupportedProviders = requiredProviders.filter(
          (provider) => !(BLUEPRINT_SUPPORTED_PROVIDERS as readonly string[]).includes(provider),
        );
        const supportedProviders = requiredProviders.filter(
          (provider) => (BLUEPRINT_SUPPORTED_PROVIDERS as readonly string[]).includes(provider),
        );
        const splitByGrain = (rows: MetricRowInput[]) => {
          const authoritative: MetricRowInput[] = [];
          const unsupportedOnly = new Set<string>();
          for (const provider of supportedProviders) {
            const grain = PROVIDER_SOURCE_GRAINS[provider];
            const providerRows = rows.filter((row) => row.platform === provider);
            const authoritativeRows = providerRows.filter((row) => row.level === grain);
            if (authoritativeRows.length > 0) {
              authoritative.push(...authoritativeRows);
            } else if (providerRows.length > 0) {
              unsupportedOnly.add(provider);
            }
          }
          return { authoritative, unsupportedOnly };
        };
        const { authoritative: currentCampaignRows, unsupportedOnly: currentUnsupported } = splitByGrain(currentWindow.rows);
        const { authoritative: previousCampaignRows, unsupportedOnly: previousUnsupported } = splitByGrain(previousWindow.rows);
        const grainUnsupportedProviders = [...new Set([...currentUnsupported, ...previousUnsupported])];

        const ctx: GenerationContext = {
          workspaceId,
          clientId,
          clientName: client.name,
          clientRequirement: {
            requiredProviders,
            requiredDestinations: [...client.requiredDestinations].sort(),
            requirementsConfiguredAt: client.requirementsConfiguredAt.toISOString(),
          },
          window,
          comparisonWindow,
          connections,
          currentRows: currentCampaignRows,
          previousRows: previousCampaignRows,
          grainUnsupportedProviders,
          rowsLimited: currentWindow.limited,
          evaluation,
          dataset,
          comparisonDataset,
          receipts,
        };

        const totals = aggregateBlueprintMetrics(currentCampaignRows);
        const dependencyState = buildDependencyState(ctx);
        const dependencyHash = computeDependencyHash(dependencyState);

        // Candidate re-validation: recompute the canonical dependency state
        // from FRESH reads inside the same transaction. Any change that
        // committed since evaluation (dataset, receipts) discards the
        // candidate and forces a regeneration attempt.
        await publicationHooks.afterEvidence?.({ generationKey });
        const [recheckDataset, recheckComparisonDataset, recheckReceiptRows] = await Promise.all([
          reportingDataset(tx, workspaceId, clientId, window, providerScope),
          reportingDataset(tx, workspaceId, clientId, comparisonWindow, providerScope),
          Promise.all(client.requiredDestinations.map((destination) =>
            tx.destinationDeliveryReceipt.findFirst({
              where: { workspaceId, clientId, destination, windowStart: window.start, windowEnd: window.end },
              orderBy: [{ retrievedAt: "desc" }, { id: "desc" }],
            }))),
        ]);
        const recheckState: DependencyState = {
          requirement: { ...ctx.clientRequirement },
          datasetFingerprint: recheckDataset.fingerprint,
          evidenceAt: new Date(recheckDataset.evidenceAt).toISOString(),
          dataThroughDate: recheckDataset.dataThroughDate,
          rowCount: recheckDataset.rowCount,
          comparisonDatasetFingerprint: recheckComparisonDataset.fingerprint,
          comparisonEvidenceAt: new Date(recheckComparisonDataset.evidenceAt).toISOString(),
          comparisonDataThroughDate: recheckComparisonDataset.dataThroughDate,
          comparisonRowCount: recheckComparisonDataset.rowCount,
          receipts: recheckReceiptRows.flatMap((receipt) => receipt ? [{
            id: receipt.id,
            destination: receipt.destination,
            retrievedAt: receipt.retrievedAt.toISOString(),
            dataThroughDate: receipt.dataThroughDate,
            current: !recheckDataset.limited
              && receipt.datasetFingerprint === recheckDataset.fingerprint
              && receipt.retrievedAt.getTime() >= recheckDataset.evidenceAt,
          }] : []),
          contractVersions: dependencyState.contractVersions,
        };
        if (canonicalJson(recheckState) !== canonicalJson(dependencyState)) {
          throw new CandidateSupersededError();
        }

        // Idempotency lookup, sequence allocation and insertion inside the
        // same publication transaction.
        const winner = await tx.reportSnapshot.findFirst({
          where: { generationKey, dependencyHash },
          orderBy: [{ sequence: "desc" }],
        });
        if (winner) {
          return { kind: "existing" as const, row: winner };
        }

        const verification = buildVerification(ctx, totals, currentWindow.limited, true);
        const report = buildReport(ctx, verification);
        const campaigns = buildCampaignTable(currentCampaignRows, previousCampaignRows);
        report.campaigns = campaigns.campaigns;
        report.campaignTruncated = campaigns.truncated;
        report.campaignTotal = campaigns.totalTracked;

        const publicationNow = new Date();
        report.overview.generatedAt = publicationNow.toISOString();
        const dateRange = windowDateRange(window);
        const comparisonRange = windowDateRange(comparisonWindow);
        const maxSequence = await tx.reportSnapshot.findFirst({
          where: { generationKey },
          orderBy: [{ sequence: "desc" }],
          select: { sequence: true },
        });
        const row = await prismaReportSnapshotCreate(tx, {
          workspaceId,
          clientId,
          blueprintId: BLUEPRINT_ID,
          blueprintVersion: BLUEPRINT_VERSION,
          generationKey,
          sequence: (maxSequence?.sequence ?? 0) + 1,
          reportingWindowStart: dateRange.gte,
          reportingWindowEnd: dateRange.lte,
          comparisonWindowStart: comparisonRange.gte,
          comparisonWindowEnd: comparisonRange.lte,
          reportingTimezone: report.overview.reportingTimezone,
          reportingCurrency: totals.currency,
          requiredProviders: ctx.clientRequirement.requiredProviders,
          requiredDestinations: ctx.clientRequirement.requiredDestinations,
          includedProviders: report.overview.includedProviders,
          includedAccountIds: report.overview.includedAccounts.map((account) => account.accountId),
          dataThroughByProvider: Object.fromEntries(
            report.providers.map((provider) => [provider.provider, provider.dataThrough]),
          ),
          metricContractVersions: dependencyState.contractVersions,
          datasetFingerprint: dependencyState.datasetFingerprint,
          readinessStatus: report.overview.readiness.status,
          verificationStatus: verification.status,
          verificationReasons: verification.reasons,
          readinessEvidence: {
            evaluatedAt: evaluation.evaluatedAt,
            blockers: evaluation.blockers,
            warnings: evaluation.warnings,
            currencies: evaluation.currencies,
            timezones: evaluation.timezones,
            destinationState: evaluation.destination.state,
            latestDataDate: evaluation.latestDataDate,
            evidenceIdentifier: dependencyHash,
            dependencyState,
          },
          destinationReceipts: dependencyState.receipts,
          generatorCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null,
          schemaVersion: BLUEPRINT_SCHEMA_VERSION,
          dependencyHash,
          result: report as unknown as Record<string, unknown>,
          generatedAt: publicationNow,
        });
        return { kind: "created" as const, row };
      }, { timeout: 30_000 });

      if (result.kind === "existing") {
        return {
          snapshot: toSnapshotMeta(result.row),
          report: result.row.result as unknown as BlueprintReport,
          created: false,
          readiness: {
            status: result.row.readinessStatus as BlueprintReadinessStatus,
            blockers: (result.row.readinessEvidence as { blockers?: Array<{ code: string }> }).blockers?.map((issue) => issue.code) ?? [],
            warnings: (result.row.readinessEvidence as { warnings?: Array<{ code: string }> }).warnings?.map((issue) => issue.code) ?? [],
            destinationState: (result.row.readinessEvidence as { destinationState?: ReportReadinessEvaluation["destination"]["state"] }).destinationState ?? "unverified",
          },
        };
      }
      const storedReport = result.row.result as unknown as BlueprintReport;
      return {
        snapshot: toSnapshotMeta(result.row),
        report: storedReport,
        created: true,
        readiness: storedReport.overview.readiness,
      };
    } catch (error: unknown) {
      if (error instanceof CandidateSupersededError) {
        lastContention = error;
        continue; // discard the candidate and regenerate with fresh reads
      }
      if (isSerializationFailure(error)) {
        lastContention = error;
        continue; // a concurrent requirement/data write: fresh transaction retry
      }
      throw error;
    }
  }
  throw new RbacError(
    "Report generation could not stabilize against concurrent reporting changes. Retry.",
    "SNAPSHOT_CONTENTION",
    503,
  );
}

export type FreshnessResult = {
  freshness: "CURRENT" | "STALE";
  staleReasons: string[];
  dependencyHashMatches: boolean;
};

/**
 * Recompute the stored snapshot's canonical dependency state from live
 * warehouse/configuration/receipt data and diff it against generation time.
 */
export async function evaluateSnapshotFreshness(snapshot: {
  workspaceId: string;
  clientId: string;
  dependencyHash: string;
  reportingWindowStart: Date;
  reportingWindowEnd: Date;
  readinessEvidence: unknown;
}): Promise<FreshnessResult> {
  const evidence = snapshot.readinessEvidence as { dependencyState?: DependencyState } | null;
  const storedState = evidence?.dependencyState;
  if (!storedState) {
    return { freshness: "STALE", staleReasons: ["contract_changed"], dependencyHashMatches: false };
  }

  const window: ReportingWindow = {
    start: snapshot.reportingWindowStart.toISOString().slice(0, 10),
    end: snapshot.reportingWindowEnd.toISOString().slice(0, 10),
  };
  const comparisonWindow = comparisonWindowFor(window);

  // Requirements, both dataset fingerprints, and receipts are re-read through
  // ONE RepeatableRead transaction so the recomputed dependency state can
  // never mix reads from different moments.
  const currentState = await prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: snapshot.clientId, workspaceId: snapshot.workspaceId },
      select: {
        requiredProviders: true,
        requiredDestinations: true,
        requirementsConfiguredAt: true,
      },
    });
    const scope = client?.requirementsConfiguredAt && client.requiredProviders.length > 0
      ? client.requiredProviders
      : undefined;
    const [dataset, comparisonDataset] = await Promise.all([
      reportingDataset(tx, snapshot.workspaceId, snapshot.clientId, window, scope),
      reportingDataset(tx, snapshot.workspaceId, snapshot.clientId, comparisonWindow, scope),
    ]);
    // Latest receipt per required destination, with PR #152 currentness
    // (exact window + destination + fingerprint + not older than evidence),
    // evaluated against THIS transaction's dataset.
    const receiptRows = await Promise.all(
      (client?.requiredDestinations ?? []).map((destination) =>
        tx.destinationDeliveryReceipt.findFirst({
          where: {
            workspaceId: snapshot.workspaceId,
            clientId: snapshot.clientId,
            destination,
            windowStart: window.start,
            windowEnd: window.end,
          },
          orderBy: [{ retrievedAt: "desc" }, { id: "desc" }],
        })),
    );
    return {
      requirement: client
        ? {
          requiredProviders: [...client.requiredProviders].sort(),
          requiredDestinations: [...client.requiredDestinations].sort(),
          requirementsConfiguredAt: client.requirementsConfiguredAt?.toISOString() ?? null,
        }
        : null,
      datasetFingerprint: dataset.fingerprint,
      evidenceAt: new Date(dataset.evidenceAt).toISOString(),
      dataThroughDate: dataset.dataThroughDate,
      rowCount: dataset.rowCount,
      comparisonDatasetFingerprint: comparisonDataset.fingerprint,
      comparisonEvidenceAt: new Date(comparisonDataset.evidenceAt).toISOString(),
      comparisonDataThroughDate: comparisonDataset.dataThroughDate,
      comparisonRowCount: comparisonDataset.rowCount,
      receipts: receiptRows.flatMap((receipt) => receipt ? [{
        id: receipt.id,
        destination: receipt.destination,
        retrievedAt: receipt.retrievedAt.toISOString(),
        dataThroughDate: receipt.dataThroughDate,
        current: !dataset.limited
          && receipt.datasetFingerprint === dataset.fingerprint
          && receipt.retrievedAt.getTime() >= dataset.evidenceAt,
      }] : []),
      contractVersions: {
        metrics: METRIC_CONTRACT_VERSION,
        dataset: "reporting-dataset-v1",
      },
    };
  }, { isolationLevel: "RepeatableRead", timeout: 30_000 });

  const currentHash = computeDependencyHash(currentState);
  if (currentHash === snapshot.dependencyHash) {
    return { freshness: "CURRENT", staleReasons: [], dependencyHashMatches: true };
  }
  return {
    freshness: "STALE",
    staleReasons: diffDependencyComponents(storedState, currentState),
    dependencyHashMatches: false,
  };
}

/**
 * Reopen a saved snapshot for display: recompute staleness and re-derive the
 * verification label from the STORED verification evidence combined with the
 * live dependency-hash match. Reopening never rewrites history.
 */
export async function reopenWeeklyBlueprint(params: {
  workspaceId: string;
  clientId: string;
  windowStart?: string;
  windowEnd?: string;
  now?: Date;
}): Promise<{
  client: {
    id: string;
    name: string;
    requiredProviders: string[];
    requiredDestinations: string[];
    requirementsConfiguredAt: Date | null;
  } | null;
  snapshot: (SnapshotMeta & { freshness: FreshnessResult; verification: VerificationResult }) | null;
  report: BlueprintReport | null;
  defaultWindow: ReportingWindow;
}> {
  const { workspaceId, clientId, now = new Date() } = params;
  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId },
    select: {
      id: true,
      name: true,
      requiredProviders: true,
      requiredDestinations: true,
      requirementsConfiguredAt: true,
    },
  });
  if (!client) {
    throw new BlueprintInputError("Client not found in this workspace.", "client_not_found");
  }
  if (Boolean(params.windowStart) !== Boolean(params.windowEnd)) {
    throw new BlueprintInputError(
      "Provide both windowStart and windowEnd, or neither (the last complete week is used).",
      "window_boundary_incomplete",
    );
  }
  const window = params.windowStart && params.windowEnd
    ? resolveExplicitWindow(params.windowStart, params.windowEnd)
    : lastCompleteWeek(now);

  const generationKey = computeGenerationKey(workspaceId, clientId, window, comparisonWindowFor(window));
  const snapshot = await prisma.reportSnapshot.findFirst({
    where: { generationKey },
    orderBy: [{ sequence: "desc" }],
  });
  if (!snapshot) {
    return { client, snapshot: null, report: null, defaultWindow: lastCompleteWeek(now) };
  }

  const freshness = await evaluateSnapshotFreshness(snapshot);
  const verification: VerificationResult = freshness.dependencyHashMatches
    ? { status: snapshot.verificationStatus as BlueprintVerificationLabel, reasons: snapshot.verificationReasons }
    : {
      status: "NOT_VERIFIED",
      reasons: [...snapshot.verificationReasons, "dependency_evidence_changed"],
    };

  return {
    client,
    snapshot: {
      id: snapshot.id,
      sequence: snapshot.sequence,
      blueprintId: snapshot.blueprintId,
      blueprintVersion: snapshot.blueprintVersion,
      generationKey: snapshot.generationKey,
      dependencyHash: snapshot.dependencyHash,
      verificationStatus: verification.status,
      verificationReasons: verification.reasons,
      generatedAt: snapshot.generatedAt,
      reportingWindowStart: snapshot.reportingWindowStart,
      reportingWindowEnd: snapshot.reportingWindowEnd,
      freshness,
      verification,
    },
    report: snapshot.result as unknown as BlueprintReport,
    defaultWindow: lastCompleteWeek(now),
  };
}

export type BlueprintMetricKind = "money" | "count" | "ratio" | "percent";

export function formatBlueprintMetric(
  value: number | null,
  currency: string | null,
  kind: BlueprintMetricKind,
): string {
  if (value === null) return "—";
  if (kind === "money" && currency) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: currency === "VND" ? 0 : 2,
      }).format(value);
    } catch {
      return `${value.toLocaleString("en-US")} ${currency}`;
    }
  }
  if (kind === "percent") return `${(value * 100).toFixed(2)}%`;
  if (kind === "ratio") return `${value.toFixed(2)}x`;
  return value.toLocaleString("en-US");
}
