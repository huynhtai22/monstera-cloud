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

export const BLUEPRINT_ID = "weekly-paid-media-performance";
export const BLUEPRINT_VERSION = 1;
export const BLUEPRINT_SCHEMA_VERSION = 2;
/**
 * Version of the normalized metric mapping this blueprint consumes.
 * Source of truth: the CampaignMetric table (UTC-day rows, string IDs,
 * per-row currency) written by the existing provider ingestion mappers.
 */
export const METRIC_CONTRACT_VERSION = "weekly-blueprint-metrics-v2";
/**
 * The ONE authoritative aggregation grain. Totals, provider breakdowns and
 * the campaign table aggregate ONLY `level = "campaign"` rows. Rows at
 * account/adset/ad grain in the same window make the grain ambiguous and
 * fail verification closed — they are never summed together with it.
 */
export const AUTHORITATIVE_AGGREGATION_GRAIN = "campaign";
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
  /** True when non-campaign rows share the window — mixed grains fail closed. */
  aggregationGrainAmbiguous: boolean;
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
  if (input.aggregationGrainAmbiguous) reasons.push("aggregation_grain_ambiguous");
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

export type ProviderBreakdown = {
  provider: string;
  providerLabel: string;
  required: boolean;
  included: boolean;
  metrics: BlueprintMetrics;
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
  metrics: BlueprintMetrics,
  included: boolean,
): string {
  if (!included) {
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
  grainAmbiguous: boolean;
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

function computeGenerationKey(
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
    const currentRows = ctx.currentRows.filter((row) => row.platform === provider);
    const previousRows = ctx.previousRows.filter((row) => row.platform === provider);
    const metrics = aggregateBlueprintMetrics(currentRows);
    const hasData = currentRows.length > 0;
    if (hasData) {
      includedProviders.push(provider);
      // Included accounts are derived from ACTUAL metric evidence: the
      // distinct account ids present in the campaign-grain rows themselves.
      const accountIds = [...new Set(currentRows.map((row) => row.accountId))].sort();
      const connectionByAccount = new Map(
        ctx.connections.filter((c) => c.provider === provider).map((c) => [c.remoteAccountId, c.id]),
      );
      for (const accountId of accountIds) {
        includedAccounts.push({
          provider,
          accountId,
          connectionId: connectionByAccount.get(accountId) ?? "",
        });
      }
    }
    const dataThrough = ctx.evaluation.providers
      .find((entry) => entry.provider === provider)?.latestDataDate ?? null;
    const partial = {
      provider,
      providerLabel: getPlatformLabel(provider),
      required: true,
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
    aggregationGrainAmbiguous: ctx.grainAmbiguous,
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
  if (client.requiredProviders.length === 0 || client.requiredDestinations.length === 0
    || !client.requirementsConfiguredAt) {
    throw new BlueprintInputError(
      "Reporting requirements are not configured for this client. An owner or admin must choose required providers and destinations in Clients before a verified report can be generated.",
      "requirements_not_configured",
    );
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

  // EVERYTHING the snapshot binds — client requirements, both dataset
  // fingerprints, exact metric rows, and destination receipts with
  // currentness evaluated against THESE fingerprints — is loaded through ONE
  // RepeatableRead transaction. A receipt evaluated against dataset A can
  // never verify dataset B, because currentness and the bound fingerprint
  // come from the same read.
  const { dataset, comparisonDataset, connections, currentWindow, previousWindow, receiptRows, txClient } = await prisma.$transaction(async (tx) => {
    const [dataset, comparisonDataset, txClient, connections, currentWindow, previousWindow, receiptRows] = await Promise.all([
      reportingDataset(tx, workspaceId, clientId, window),
      reportingDataset(tx, workspaceId, clientId, comparisonWindow),
      tx.client.findFirst({
        where: { id: clientId, workspaceId },
        select: { requiredProviders: true, requiredDestinations: true, requirementsConfiguredAt: true },
      }),
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
    return { dataset, comparisonDataset, connections, currentWindow, previousWindow, receiptRows, txClient };
  }, { isolationLevel: "RepeatableRead", timeout: 30_000 });

  // A requirement change between the header read and the transaction must
  // fail closed rather than mix two configurations.
  if (!txClient
    || canonicalJson(txClient.requiredProviders) !== canonicalJson(client.requiredProviders)
    || canonicalJson(txClient.requiredDestinations) !== canonicalJson(client.requiredDestinations)
    || txClient.requirementsConfiguredAt?.toISOString() !== client.requirementsConfiguredAt.toISOString()) {
    throw new BlueprintInputError(
      "Reporting requirements changed while the report was being read. Retry generation.",
      "evidence_inconsistent",
    );
  }

  // Receipt currentness is evaluated against THIS transaction's dataset
  // fingerprint (PR #152's exact rule) — never against another read's.
  const receipts: DependencyState["receipts"] = receiptRows.flatMap((receipt) => receipt ? [{
    id: receipt.id,
    destination: receipt.destination,
    retrievedAt: receipt.retrievedAt.toISOString(),
    dataThroughDate: receipt.dataThroughDate,
    current: !dataset.limited
      && receipt.datasetFingerprint === dataset.fingerprint
      && receipt.retrievedAt.getTime() >= dataset.evidenceAt,
  }] : []);

  // Authoritative readiness: evidence-based evaluator from PR #152's server
  // layer. Its destination view must agree with the transaction's receipts —
  // divergence means data moved between the two reads, and generation fails
  // closed instead of mixing datasets.
  const readiness = await loadReportReadiness(workspaceId, window, { clientId });
  const evaluation = readiness.evaluations[0];
  if (!evaluation) {
    throw new BlueprintInputError("Client not found in this workspace.", "client_not_found");
  }
  const evaluationReceiptKey = (receipts: Array<{ id: string; destination: string; current: boolean }>) =>
    canonicalJson([...receipts].sort((a, b) => a.id.localeCompare(b.id)).map((receipt) => ({ id: receipt.id, destination: receipt.destination, current: receipt.current })));
  if (evaluationReceiptKey(evaluation.destination.receipts ?? []) !== evaluationReceiptKey(receipts)) {
    throw new BlueprintInputError(
      "Reporting evidence changed while the report was being read. Retry generation.",
      "evidence_inconsistent",
    );
  }

  // ONE aggregation grain: campaign-level rows only.
  const currentCampaignRows = currentWindow.rows.filter((row) => row.level === AUTHORITATIVE_AGGREGATION_GRAIN);
  const previousCampaignRows = previousWindow.rows.filter((row) => row.level === AUTHORITATIVE_AGGREGATION_GRAIN);
  const grainAmbiguous = currentWindow.rows.some((row) => row.level !== AUTHORITATIVE_AGGREGATION_GRAIN)
    || previousWindow.rows.some((row) => row.level !== AUTHORITATIVE_AGGREGATION_GRAIN);

  const ctx: GenerationContext = {
    workspaceId,
    clientId,
    clientName: client.name,
    clientRequirement: {
      requiredProviders: [...client.requiredProviders].sort(),
      requiredDestinations: [...client.requiredDestinations].sort(),
      requirementsConfiguredAt: client.requirementsConfiguredAt.toISOString(),
    },
    window,
    comparisonWindow,
    connections,
    currentRows: currentCampaignRows,
    previousRows: previousCampaignRows,
    grainAmbiguous,
    rowsLimited: currentWindow.limited,
    evaluation,
    dataset,
    comparisonDataset,
    receipts,
  };

  const totals = aggregateBlueprintMetrics(currentCampaignRows);
  const dependencyState = buildDependencyState(ctx);
  const dependencyHash = computeDependencyHash(dependencyState);
  const generationKey = computeGenerationKey(workspaceId, clientId, window, comparisonWindow);

  // Idempotent: same canonical input + same dependency state returns the
  // stored snapshot and its stored result, byte-for-byte — never a rebuild.
  const existing = await prisma.reportSnapshot.findFirst({
    where: { generationKey, dependencyHash },
    orderBy: [{ sequence: "desc" }],
  });
  if (existing) {
    return {
      snapshot: toSnapshotMeta(existing),
      report: existing.result as unknown as BlueprintReport,
      created: false,
      readiness: {
        status: evaluation.status,
        blockers: evaluation.blockers.map((issue) => issue.code),
        warnings: evaluation.warnings.map((issue) => issue.code),
        destinationState: evaluation.destination.state,
      },
    };
  }

  const verification = buildVerification(ctx, totals, currentWindow.limited, true);
  const report = buildReport(ctx, verification);
  const campaigns = buildCampaignTable(currentCampaignRows, previousCampaignRows);
  report.campaigns = campaigns.campaigns;
  report.campaignTruncated = campaigns.truncated;
  report.campaignTotal = campaigns.totalTracked;

  const dateRange = windowDateRange(window);
  const comparisonRange = windowDateRange(comparisonWindow);
  const createSnapshot = (sequence: number) => prisma.reportSnapshot.create({
    data: {
      workspaceId,
      clientId,
      blueprintId: BLUEPRINT_ID,
      blueprintVersion: BLUEPRINT_VERSION,
      generationKey,
      sequence,
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
    },
  });

  // Concurrent generations for the same canonical input either agree (same
  // dependency state → one snapshot, idempotent) or race on the sequence
  // counter. A P2002 loser retries the allocation so every distinct
  // dependency state gets its own immutable version and no generation fails
  // spuriously.
  let created: Awaited<ReturnType<typeof createSnapshot>> | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const maxSequence = await prisma.reportSnapshot.findFirst({
      where: { generationKey },
      orderBy: [{ sequence: "desc" }],
      select: { sequence: true },
    });
    try {
      created = await createSnapshot((maxSequence?.sequence ?? 0) + 1);
      break;
    } catch (error: unknown) {
      if (!isUniqueViolation(error) || attempt === 4) throw error;
      // Same-state winner takes precedence: identical input + deps is
      // idempotent even when two generations raced.
      const winner = await prisma.reportSnapshot.findFirst({
        where: { generationKey, dependencyHash },
        orderBy: [{ sequence: "desc" }],
      });
      if (winner) {
        created = winner;
        break;
      }
    }
  }
  if (!created) {
    throw new BlueprintInputError(
      "Snapshot could not be written under concurrent generation. Retry.",
      "sequence_contention",
    );
  }

  return {
    snapshot: toSnapshotMeta(created),
    report,
    created: true,
    readiness: report.overview.readiness,
  };
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
    const [client, dataset, comparisonDataset] = await Promise.all([
      tx.client.findFirst({
        where: { id: snapshot.clientId, workspaceId: snapshot.workspaceId },
        select: {
          requiredProviders: true,
          requiredDestinations: true,
          requirementsConfiguredAt: true,
        },
      }),
      reportingDataset(tx, snapshot.workspaceId, snapshot.clientId, window),
      reportingDataset(tx, snapshot.workspaceId, snapshot.clientId, comparisonWindow),
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
