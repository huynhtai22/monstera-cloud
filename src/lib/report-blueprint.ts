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
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  READINESS_MESSAGES,
  READINESS_EVIDENCE_CONTRACT_VERSION,
  defaultReportingWindow,
  type ReportReadinessStatus,
  type ReportReadinessEvaluation,
  type ReadinessDependencyEvidence,
} from "@/lib/report-readiness";
import { loadReportReadiness } from "@/lib/report-readiness-server";
import { REPORT_DATASET_CAP, REPORTING_DATASET_CONTRACT_VERSION, reportingDataset } from "@/lib/report-delivery";
import type { ScopedTransaction } from "@/lib/warehouse-query";
import { getPlatformLabel } from "@/lib/client-export";
import { RbacError } from "@/lib/rbac";
import { withSystemScope } from "@/lib/tenant-guard";
import { PROVIDER_SOURCE_GRAINS } from "@/lib/provider-metric-grain";
export { PROVIDER_SOURCE_GRAINS } from "@/lib/provider-metric-grain";

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
  options?: {
    excludedProviders?: string[];
    comparisonInvalidProviders?: string[];
  },
): { campaigns: CampaignMetricsRow[]; totalTracked: number; truncated: boolean } {
  const excluded = new Set(options?.excludedProviders ?? []);
  const comparisonInvalid = new Set(options?.comparisonInvalidProviders ?? []);

  const eligiblePreviousRows = previousRows.filter((row) => !excluded.has(row.platform));
  const eligibleCurrentRows = currentRows.filter((row) => !excluded.has(row.platform));

  const previousGroups = new Map<string, MetricRowInput[]>();
  for (const row of eligiblePreviousRows) {
    const key = campaignKey(row);
    const bucket = previousGroups.get(key);
    if (bucket) bucket.push(row);
    else previousGroups.set(key, [row]);
  }

  const groups = new Map<string, MetricRowInput[]>();
  for (const row of eligibleCurrentRows) {
    const key = campaignKey(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const campaigns: CampaignMetricsRow[] = [];
  for (const bucket of groups.values()) {
    const metrics = aggregateBlueprintMetrics(bucket);
    const first = bucket[0];
    const comparisonEligible = !comparisonInvalid.has(first.platform);
    const previousCampaignRows = comparisonEligible ? previousGroups.get(campaignKey(first)) : undefined;
    const previous = previousCampaignRows ? aggregateBlueprintMetrics(previousCampaignRows) : null;
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
      changes: previous && comparisonEligible ? computeMetricsDeltas(metrics, previous) : [],
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
// Account-scope evidence (shared canonical logic — generation AND freshness)
// ---------------------------------------------------------------------------

export type AccountScopeWindow = "reporting" | "comparison";

export type AccountScopeEvidence = {
  window: AccountScopeWindow;
  provider: string;
  /** Exact account identifier — never coerced or normalized. */
  accountId: string;
  /** Sorted distinct source connections exposing this account scope. */
  connectionIds: string[];
  /** True when more than one connection claims the same account scope. */
  ambiguous: boolean;
  contractVersion: string;
};

/**
 * The ONE authoritative-grain filter for blueprint aggregation: for each
 * required supported provider, keep only rows at that provider's persisted
 * ingestion grain. Used identically by generation, scope-evidence building
 * and freshness recomputation — never two interpretations.
 */
export function authoritativeRowsForProviders(
  rows: MetricRowInput[],
  requiredProviders: string[],
): MetricRowInput[] {
  const authoritative: MetricRowInput[] = [];
  for (const provider of requiredProviders) {
    const grain = (PROVIDER_SOURCE_GRAINS as Record<string, string>)[provider];
    if (!grain) continue;
    for (const row of rows) {
      if (row.platform === provider && row.level === grain) authoritative.push(row);
    }
  }
  return authoritative;
}

/**
 * Canonical (provider, accountId) ownership evidence for both windows, built
 * ONLY from otherwise-eligible authoritative rows in exact client/workspace
 * scope. Deterministic ordering: window, provider, accountId. Multiple
 * distinct connectionIds for one account scope are ambiguous — the same
 * child account surfaced through several MCC/root connections must never be
 * summed; no connection "winner" is chosen.
 */
export function buildAccountScopeEvidence(
  currentRows: MetricRowInput[],
  previousRows: MetricRowInput[],
  requiredProviders: string[],
): {
  evidence: AccountScopeEvidence[];
  ambiguousReasons: string[];
  ambiguousProvidersReporting: string[];
  ambiguousProvidersComparison: string[];
} {
  const evidence: AccountScopeEvidence[] = [];
  const ambiguousReasons = new Set<string>();
  const ambiguousProvidersReporting = new Set<string>();
  const ambiguousProvidersComparison = new Set<string>();
  const windows: Array<{ name: AccountScopeWindow; rows: MetricRowInput[] }> = [
    { name: "comparison", rows: previousRows },
    { name: "reporting", rows: currentRows },
  ];
  for (const { name: window, rows } of windows) {
    const groups = new Map<string, { accountId: string; connectionIds: Set<string> }>();
    for (const row of rows) {
      if (!requiredProviders.includes(row.platform)) continue;
      if (!(BLUEPRINT_SUPPORTED_PROVIDERS as readonly string[]).includes(row.platform)) continue;
      const key = `${row.platform}:::${row.accountId}`;
      const group = groups.get(key);
      if (group) group.connectionIds.add(row.connectionId);
      else groups.set(key, { accountId: row.accountId, connectionIds: new Set([row.connectionId]) });
    }
    for (const [key, group] of groups) {
      const provider = key.split(":::")[0];
      const connectionIds = [...group.connectionIds].sort();
      const ambiguous = connectionIds.length > 1;
      evidence.push({
        window,
        provider,
        accountId: group.accountId,
        connectionIds,
        ambiguous,
        contractVersion: METRIC_CONTRACT_VERSION,
      });
      if (ambiguous) {
        ambiguousReasons.add(`account_scope_ambiguous:${provider}:${group.accountId}`);
        if (window === "reporting") ambiguousProvidersReporting.add(provider);
        if (window === "comparison") ambiguousProvidersComparison.add(provider);
      }
    }
  }
  evidence.sort((a, b) =>
    compareStrings(a.window, b.window)
    || compareStrings(a.provider, b.provider)
    || compareStrings(a.accountId, b.accountId));
  return {
    evidence,
    ambiguousReasons: [...ambiguousReasons].sort(),
    ambiguousProvidersReporting: [...ambiguousProvidersReporting].sort(),
    ambiguousProvidersComparison: [...ambiguousProvidersComparison].sort(),
  };
}

/** Metrics object with every value unavailable — the established
 *  unavailable-not-zero representation for ambiguous totals. */
export function unavailableBlueprintMetrics(): BlueprintMetrics {
  return {
    currency: null,
    monetaryAvailable: false,
    currencies: [],
    spend: null,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conversionValue: null,
    ctr: null,
    cpc: null,
    cpa: null,
    roas: null,
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
  /** Canonical machine-readable reasons for ambiguous account scopes
   *  (account_scope_ambiguous:<provider>:<accountId>). Ready receipts and
   *  READY readiness can never override them. */
  accountScopeAmbiguous: string[];
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
  for (const reason of input.accountScopeAmbiguous) {
    reasons.push(reason);
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
  /** Canonical (provider, accountId) ownership evidence for both windows —
   *  overlaps make snapshots stale and verification fail closed. */
  accountScopeEvidence: Array<{
    window: AccountScopeWindow;
    provider: string;
    accountId: string;
    connectionIds: string[];
    ambiguous: boolean;
    contractVersion: string;
  }>;
  /** Sanitized canonical evidence produced by the shared readiness evaluator. */
  readinessEvidence: ReadinessDependencyEvidence;
  contractVersions: Record<string, string>;
};

export const STALE_REASON_LABELS: Record<string, string> = {
  requirement_changed: "Client reporting requirements changed after generation",
  dataset_changed: "Underlying warehouse data or reporting context changed after generation",
  destination_evidence_changed: "Delivery evidence changed, expired or was replaced after generation",
  readiness_evidence_changed: "Source, account, sync, reporting context, pipeline or readiness evidence changed after generation",
  contract_changed: "Metric contract version changed after generation",
  account_scope_changed: "Connected account ownership evidence changed after generation",
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
  if (canonicalJson(stored.accountScopeEvidence) !== canonicalJson(current.accountScopeEvidence)) {
    // Any introduced, removed or changed overlapping connection/account scope
    // makes the snapshot stale.
    reasons.push("account_scope_changed");
  }
  if (canonicalJson(stored.readinessEvidence) !== canonicalJson(current.readinessEvidence)) {
    reasons.push("readiness_evidence_changed");
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

export type ProviderBreakdownStatus = "included" | "no_data" | "unsupported" | "ambiguous";

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
  totals: BlueprintMetrics & { scope: "combined" | "by_provider_only" | "unavailable"; unavailable: boolean };
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
  comparisonAmbiguous = false,
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
  if (comparisonAmbiguous) {
    return "Complete coverage for this window. Comparison deltas are unavailable because the previous window has ambiguous account sources.";
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

  const assignments = await tx.clientProviderAccountAssignment.findMany({
    where: {
      workspaceId,
      clientId,
      status: "active",
      provider: { in: [...providers] },
    },
    select: {
      provider: true,
      accountId: true,
      connectionId: true,
    },
  });

  const where: Prisma.CampaignMetricWhereInput = {
    workspaceId,
    date: { gte: range.gte, lte: range.lte },
  };

  if (assignments.length > 0) {
    where.OR = assignments.map((a) => ({
      connectionId: a.connectionId,
      platform: a.provider,
      accountId: a.accountId,
    }));
  } else {
    where.platform = { in: [...providers] };
    where.connection = { clientId, workspaceId };
  }

  const rows = await tx.campaignMetric.findMany({
    where,
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
  /** Canonical (provider, accountId) ownership evidence for both windows. */
  accountScopeEvidence: AccountScopeEvidence[];
  /** Machine-readable account_scope_ambiguous reasons (both windows). */
  accountScopeAmbiguous: string[];
  /** Required providers with an ambiguous scope in the REPORTING window. */
  ambiguousReportingProviders: string[];
  /** Required providers with an ambiguous scope in the COMPARISON window. */
  ambiguousComparisonProviders: string[];
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
    accountScopeEvidence: ctx.accountScopeEvidence.map((entry) => ({ ...entry })),
    readinessEvidence: ctx.evaluation.dependencyEvidence,
    contractVersions: {
      metrics: METRIC_CONTRACT_VERSION,
      dataset: REPORTING_DATASET_CONTRACT_VERSION,
      readiness: READINESS_EVIDENCE_CONTRACT_VERSION,
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
    // Ambiguous account scope: the same provider account is claimed by more
    // than one source connection. Metrics are unavailable — never doubled,
    // never zero — until ownership is resolved.
    if (ctx.ambiguousReportingProviders.includes(provider)) {
      const partial: Omit<ProviderBreakdown, "explanation"> = {
        provider,
        providerLabel: getPlatformLabel(provider),
        required: true,
        status: "ambiguous",
        included: false,
        metrics: null,
        changes: [],
        dataThrough: null,
      };
      providers.push({
        ...partial,
        explanation: "Ambiguous account sources: the same provider account is assigned through multiple source connections in this window. Metrics are unavailable until the duplicate account assignment is resolved — rows were not summed.",
      });
      continue;
    }
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
    const isComparisonValid = !ctx.ambiguousComparisonProviders.includes(provider);
    const dataThrough = ctx.evaluation.providers
      .find((entry) => entry.provider === provider)?.latestDataDate ?? null;
    const partial = {
      provider,
      providerLabel: getPlatformLabel(provider),
      required: true,
      status: hasData ? "included" as const : "no_data" as const,
      included: hasData,
      metrics,
      changes: hasData && isComparisonValid
        ? computeMetricsDeltas(metrics, aggregateBlueprintMetrics(previousRows))
        : [],
      dataThrough,
    };
    providers.push({
      ...partial,
      explanation: explanationFor(provider, ctx.evaluation, metrics, hasData, !isComparisonValid),
    });
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
  const totalsUnavailable = ctx.ambiguousReportingProviders.length > 0;

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
    totals: totalsUnavailable
      ? { ...unavailableBlueprintMetrics(), scope: "unavailable" as const, unavailable: true }
      : { ...totals, scope: totals.monetaryAvailable ? "combined" as const : "by_provider_only" as const, unavailable: false },
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
    accountScopeAmbiguous: ctx.accountScopeAmbiguous,
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

/** A fresh publication attempt did not acquire the generation serializer. */
class PublicationLockUnavailableError extends Error {
  constructor() {
    super("Publication serializer is busy");
    this.name = "PublicationLockUnavailableError";
  }
}

/** Prisma wraps Postgres 40001 serialization failures as P2034. */
function isSerializationFailure(error: unknown): boolean {
  const candidate = error as { code?: string; meta?: { code?: string; message?: string }; message?: string };
  return candidate?.code === "P2034"
    || candidate?.code === "40001"
    || candidate?.meta?.code === "40001"
    || /could not serialize access/i.test(candidate?.meta?.message ?? candidate?.message ?? "");
}

/**
 * @internal TEST-ONLY seam for deterministic publication interleaving.
 * Never called by routes; not exposed through any API or Zod input.
 */
const publicationHooks: {
  afterLockAcquired?: (info: { generationKey: string }) => Promise<void>;
  onLockUnavailable?: (info: { generationKey: string }) => Promise<void>;
  afterReadiness?: (info: { generationKey: string }) => Promise<void>;
  afterCurrentDataset?: (info: { generationKey: string }) => Promise<void>;
  afterCurrentWindow?: (info: { generationKey: string }) => Promise<void>;
  beforeReceipts?: (info: { generationKey: string }) => Promise<void>;
  afterEvidence?: (info: { generationKey: string }) => Promise<void>;
  beforeInsert?: (info: { generationKey: string }) => Promise<void>;
  afterCommitBeforeFreshness?: (info: { generationKey: string; snapshotId: string }) => Promise<void>;
} = {};

/** @internal TEST-ONLY. Install/remove deterministic publication hooks. */
export function _setPublicationTestHooks(hooks: {
  afterLockAcquired?: (info: { generationKey: string }) => Promise<void>;
  onLockUnavailable?: (info: { generationKey: string }) => Promise<void>;
  afterReadiness?: (info: { generationKey: string }) => Promise<void>;
  afterCurrentDataset?: (info: { generationKey: string }) => Promise<void>;
  afterCurrentWindow?: (info: { generationKey: string }) => Promise<void>;
  beforeReceipts?: (info: { generationKey: string }) => Promise<void>;
  afterEvidence?: (info: { generationKey: string }) => Promise<void>;
  beforeInsert?: (info: { generationKey: string }) => Promise<void>;
  afterCommitBeforeFreshness?: (info: { generationKey: string; snapshotId: string }) => Promise<void>;
}): void {
  publicationHooks.afterLockAcquired = hooks.afterLockAcquired;
  publicationHooks.onLockUnavailable = hooks.onLockUnavailable;
  publicationHooks.afterReadiness = hooks.afterReadiness;
  publicationHooks.afterCurrentDataset = hooks.afterCurrentDataset;
  publicationHooks.afterCurrentWindow = hooks.afterCurrentWindow;
  publicationHooks.beforeReceipts = hooks.beforeReceipts;
  publicationHooks.afterEvidence = hooks.afterEvidence;
  publicationHooks.beforeInsert = hooks.beforeInsert;
  publicationHooks.afterCommitBeforeFreshness = hooks.afterCommitBeforeFreshness;
}

/** Create a snapshot row through an explicit transaction client. The tenant
 *  guard's bulk/create rule is satisfied by the explicit workspaceId fields. */
function prismaReportSnapshotCreate(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  data: Record<string, unknown>,
): Promise<{
  id: string;
  workspaceId: string;
  clientId: string;
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
      workspaceId: string;
      clientId: string;
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
   * Publication linearizes at the commit of one fresh RepeatableRead attempt.
   * The non-blocking advisory lock is the first database operation: a loser
   * aborts the transaction instead of waiting with an old snapshot. All report
   * evidence and insertion then share the successful transaction snapshot.
   * Writers do not share this lock, so a new-transaction freshness check after
   * commit is required before VERIFIED is returned. This is an as-of-publication
   * guarantee, not a claim that dependencies cannot change after the response.
   */
  const MAX_PUBLICATION_ATTEMPTS = 40;
  for (let attempt = 1; attempt <= MAX_PUBLICATION_ATTEMPTS; attempt += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext(${generationKey})) AS locked`;
        if (!lock?.locked) throw new PublicationLockUnavailableError();
        await publicationHooks.afterLockAcquired?.({ generationKey });
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
        await publicationHooks.afterReadiness?.({ generationKey });

        const dataset = await reportingDataset(tx, workspaceId, clientId, window, [...client.requiredProviders].sort());
        await publicationHooks.afterCurrentDataset?.({ generationKey });
        const comparisonDataset = await reportingDataset(tx, workspaceId, clientId, comparisonWindow, [...client.requiredProviders].sort());
        const clientAssignments = await tx.clientProviderAccountAssignment.findMany({
          where: {
            workspaceId,
            clientId,
            status: "active",
            provider: { in: client.requiredProviders },
          },
          select: { connectionId: true },
        });
        const authoritativeConnIds = [...new Set(clientAssignments.map((a) => a.connectionId))];
        const connections = await tx.connection.findMany({
            where: {
              workspaceId,
              type: "source",
              provider: { in: client.requiredProviders },
              ...(authoritativeConnIds.length > 0 ? { id: { in: authoritativeConnIds } } : { clientId }),
            },
            select: {
              id: true,
              provider: true,
              remoteAccountId: true,
              status: true,
              lastDataThrough: true,
            },
            orderBy: [{ id: "asc" }],
          });
        const currentWindow = await loadWindowRows(tx, workspaceId, clientId, client.requiredProviders, window);
        await publicationHooks.afterCurrentWindow?.({ generationKey });
        const previousWindow = await loadWindowRows(tx, workspaceId, clientId, client.requiredProviders, comparisonWindow);
        await publicationHooks.beforeReceipts?.({ generationKey });
        const receiptRows = await Promise.all(client.requiredDestinations.map((destination) =>
            tx.destinationDeliveryReceipt.findFirst({
              where: { workspaceId, clientId, destination, windowStart: window.start, windowEnd: window.end },
              orderBy: [{ retrievedAt: "desc" }, { id: "desc" }],
            })));

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

        // Per-provider authoritative grain resolution (blueprint scope only),
        // via the ONE shared grain filter used by freshness as well.
        const requiredProviders = [...client.requiredProviders].sort();
        const supportedProviders = requiredProviders.filter(
          (provider) => (BLUEPRINT_SUPPORTED_PROVIDERS as readonly string[]).includes(provider),
        );
        const currentAuthoritativeRows = authoritativeRowsForProviders(currentWindow.rows, supportedProviders);
        const previousAuthoritativeRows = authoritativeRowsForProviders(previousWindow.rows, supportedProviders);
        const currentUnsupported = new Set<string>();
        const previousUnsupported = new Set<string>();
        for (const provider of supportedProviders) {
          if (currentWindow.rows.some((row) => row.platform === provider) && !currentAuthoritativeRows.some((row) => row.platform === provider)) currentUnsupported.add(provider);
          if (previousWindow.rows.some((row) => row.platform === provider) && !previousAuthoritativeRows.some((row) => row.platform === provider)) previousUnsupported.add(provider);
        }
        const currentCampaignRows = currentAuthoritativeRows;
        const previousCampaignRows = previousAuthoritativeRows;
        const grainUnsupportedProviders = [...new Set([...currentUnsupported, ...previousUnsupported])];

        // Canonical (provider, accountId) ownership evidence for BOTH windows.
        const scopeEvidence = buildAccountScopeEvidence(
          currentCampaignRows, previousCampaignRows, supportedProviders,
        );
        const ambiguousReportingProviders = scopeEvidence.ambiguousProvidersReporting;
        const ambiguousComparisonProviders = scopeEvidence.ambiguousProvidersComparison;

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
          accountScopeEvidence: scopeEvidence.evidence,
          accountScopeAmbiguous: scopeEvidence.ambiguousReasons,
          ambiguousReportingProviders,
          ambiguousComparisonProviders,
          rowsLimited: currentWindow.limited,
          evaluation,
          dataset,
          comparisonDataset,
          receipts,
        };

        const rawTotals = aggregateBlueprintMetrics(currentCampaignRows);
        // Ambiguous account scopes in the reporting window make the combined
        // totals incomplete after exclusion — unavailable, never partial.
        const totalsUnavailable = ambiguousReportingProviders.length > 0;
        const totals = totalsUnavailable
          ? { ...unavailableBlueprintMetrics(), scope: "unavailable" as const }
          : { ...rawTotals, scope: rawTotals.monetaryAvailable ? "combined" as const : "by_provider_only" as const };
        const dependencyState = buildDependencyState(ctx);
        const dependencyHash = computeDependencyHash(dependencyState);

        await publicationHooks.afterEvidence?.({ generationKey });

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
        const campaigns = buildCampaignTable(
          currentCampaignRows,
          previousCampaignRows,
          MAX_CAMPAIGN_ROWS,
          {
            excludedProviders: ambiguousReportingProviders,
            comparisonInvalidProviders: ambiguousComparisonProviders,
          },
        );
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
        await publicationHooks.beforeInsert?.({ generationKey });
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
      }, { isolationLevel: "RepeatableRead", timeout: 30_000 });

      await publicationHooks.afterCommitBeforeFreshness?.({ generationKey, snapshotId: result.row.id });
      const postCommitFreshness = await evaluateSnapshotFreshness(result.row);
      if (!postCommitFreshness.dependencyHashMatches) {
        continue;
      }

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
      if (error instanceof PublicationLockUnavailableError) {
        await publicationHooks.onLockUnavailable?.({ generationKey });
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue; // the next attempt starts a completely new transaction
      }
      if (isSerializationFailure(error)) {
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
    const [readiness, dataset, comparisonDataset] = await Promise.all([
      loadReportReadiness(snapshot.workspaceId, window, { clientId: snapshot.clientId, tx }),
      reportingDataset(tx, snapshot.workspaceId, snapshot.clientId, window, scope),
      reportingDataset(tx, snapshot.workspaceId, snapshot.clientId, comparisonWindow, scope),
    ]);
    const evaluation = readiness.evaluations[0];
    if (!evaluation) throw new BlueprintInputError("Client not found in this workspace.", "client_not_found");
    // Same canonical account-scope logic as generation: authoritative rows for
    // the client's explicitly required providers, both windows, recomputed in
    // this transaction.
    const supportedProviders = (client?.requiredProviders ?? []).filter(
      (provider) => (BLUEPRINT_SUPPORTED_PROVIDERS as readonly string[]).includes(provider),
    );
    const [currentWindowRows, previousWindowRows] = await Promise.all([
      loadWindowRows(tx, snapshot.workspaceId, snapshot.clientId, client?.requiredProviders ?? [], window),
      loadWindowRows(tx, snapshot.workspaceId, snapshot.clientId, client?.requiredProviders ?? [], comparisonWindow),
    ]);
    const accountScopeEvidence = buildAccountScopeEvidence(
      authoritativeRowsForProviders(currentWindowRows.rows, supportedProviders),
      authoritativeRowsForProviders(previousWindowRows.rows, supportedProviders),
      supportedProviders,
    );
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
      accountScopeEvidence: accountScopeEvidence.evidence.map((entry) => ({ ...entry })),
      readinessEvidence: evaluation.dependencyEvidence,
      contractVersions: {
        metrics: METRIC_CONTRACT_VERSION,
        dataset: REPORTING_DATASET_CONTRACT_VERSION,
        readiness: READINESS_EVIDENCE_CONTRACT_VERSION,
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
