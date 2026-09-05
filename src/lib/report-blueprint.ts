/**
 * Verified Weekly Performance Blueprint v1.
 *
 * One opinionated, customer-visible report built exclusively on existing
 * warehouse primitives: scoped CampaignMetric rows + the shared reporting
 * readiness evaluator. Never calls ad providers and never converts currency.
 *
 * Derived-metric semantics (intentionally stricter than client-export.ts):
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
  deriveReportingReadiness,
  type ReadinessStatus,
  type ReportingReadiness,
} from "@/lib/reporting-readiness";
import { getPlatformLabel } from "@/lib/client-export";

export const BLUEPRINT_ID = "weekly-paid-media-performance";
export const BLUEPRINT_VERSION = 1;
export const BLUEPRINT_SCHEMA_VERSION = 1;
/**
 * Version of the normalized metric mapping this blueprint consumes.
 * Source of truth: the CampaignMetric table (UTC-day rows, string IDs,
 * per-row currency) written by the existing provider ingestion mappers.
 */
export const METRIC_CONTRACT_VERSION = "weekly-blueprint-metrics-v1";
export const MAX_CAMPAIGN_ROWS = 100;

export const SUPPORTED_PROVIDERS = ["google_ads", "meta_ads", "tiktok_business"] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

export type BlueprintVerificationLabel = "VERIFIED" | "NOT_VERIFIED";

/** Shared readiness status mapped onto the blueprint's four-state vocabulary. */
export type BlueprintReadiness = "READY" | "NOT_READY" | "WARNING" | "UNKNOWN";

export function mapReadinessStatus(status: ReadinessStatus): BlueprintReadiness {
  if (status === "ready") return "READY";
  if (status === "best_effort") return "WARNING";
  return "NOT_READY";
}

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
// Reporting-window math (timezone-aware, pure)
// ---------------------------------------------------------------------------

export type ReportingWindow = {
  /** Inclusive first day, `YYYY-MM-DD` in the reporting timezone. */
  start: string;
  /** Inclusive last day, `YYYY-MM-DD` in the reporting timezone. */
  end: string;
};

type ZonedParts = { year: number; month: number; day: number };

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const [year, month, day] = formatted.split("-").map(Number);
  return { year, month, day };
}

/** Minutes that `timeZone` was offset from UTC at the given instant. */
function zonedOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** UTC instant of local midnight for a `YYYY-MM-DD` calendar day. */
function zonedDayStartUtc(day: string, timeZone: string): Date {
  const [year, month, dateOfMonth] = day.split("-").map(Number);
  const ts = Date.UTC(year, month - 1, dateOfMonth);
  return new Date(ts - zonedOffsetMinutes(new Date(ts), timeZone) * 60_000);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function dayString(parts: ZonedParts): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** Local calendar day (in `timeZone`) of a UTC instant. */
export function calendarDayOf(instant: Date, timeZone: string): string {
  return dayString(zonedParts(instant, timeZone));
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
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The last fully elapsed Monday–Sunday week in the reporting timezone,
 * relative to `now`. Pure: same inputs always produce the same window.
 */
export function lastCompleteWeek(timeZone: string, now: Date = new Date()): ReportingWindow {
  const todayParts = zonedParts(now, timeZone);
  const today = dayString(todayParts);
  const asTs = Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day);
  const dow = new Date(asTs).getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (dow + 6) % 7;
  const thisWeekStart = addDays(today, -daysSinceMonday);
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

/** True when the window's final day has fully elapsed in the reporting timezone. */
export function windowIsComplete(window: ReportingWindow, timeZone: string, now: Date = new Date()): boolean {
  return daysBetween(window.end, dayString(zonedParts(now, timeZone))) > 0;
}

/** UTC day-start instants bounding a window, for CampaignMetric date queries. */
export function windowToDateRange(window: ReportingWindow, timeZone: string): { gte: Date; lte: Date } {
  return {
    gte: zonedDayStartUtc(window.start, timeZone),
    lte: zonedDayStartUtc(window.end, timeZone),
  };
}

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
  const spend = monetaryAvailable ? rows.reduce((sum, row) => sum + finiteOrZero(row.spend), 0) : null;
  const conversionValue = monetaryAvailable ? rows.reduce((sum, row) => sum + finiteOrZero(row.revenue), 0) : null;

  return {
    currency,
    monetaryAvailable,
    currencies,
    spend,
    impressions,
    clicks,
    conversions,
    conversionValue,
    ctr: safeRatio(clicks, impressions),
    cpc: safeRatio(spend, clicks),
    cpa: safeRatio(spend, conversions),
    roas: safeRatio(conversionValue, spend),
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
  return { field, current, previous, deltaPercent: ((current - previous) / previous) * 100 };
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

/** Canonical identity for a campaign across windows. IDs stay exact strings. */
function campaignKey(row: MetricRowInput): string {
  return [
    row.platform,
    row.accountId,
    row.campaignId,
    row.campaignName,
    normalizeCurrency(row.currency),
  ].join(":::");
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
  for (const [key, bucket] of groups) {
    const metrics = aggregateBlueprintMetrics(bucket);
    const previous = previousGroups.has(key)
      ? aggregateBlueprintMetrics(previousGroups.get(key) as MetricRowInput[])
      : null;
    const first = bucket[0];
    campaigns.push({
      provider: first.platform,
      providerLabel: getPlatformLabel(first.platform),
      // IDs are preserved verbatim as strings — never coerced to numbers.
      campaignId: first.campaignId,
      campaignName: first.campaignName || first.campaignId,
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
  readinessStatus: BlueprintReadiness;
  requiredProviders: SupportedProvider[];
  includedProviders: string[];
  coverageComplete: boolean;
  timezoneConfigured: boolean;
  /** Every contributing row carries one known currency (matching the configured one when set). */
  currencyVerified: boolean;
  windowComplete: boolean;
  hasMetricData: boolean;
  aggregationCompatible: boolean;
  destinationSatisfied: boolean;
  dependencyHashMatches: boolean;
};

export type VerificationResult = {
  status: BlueprintVerificationLabel;
  reasons: string[];
};

/**
 * `VERIFIED` requires every gate. Any other state keeps the underlying
 * readiness status and exact recovery reasons. `WARNING` can never become
 * `VERIFIED` because READY is required.
 */
export function computeVerificationStatus(input: VerificationInput): VerificationResult {
  const reasons: string[] = [];
  if (input.readinessStatus !== "READY") {
    reasons.push(`readiness_not_ready:${input.readinessStatus}`);
  }
  if (input.requiredProviders.length === 0) {
    reasons.push("required_providers_not_configured");
  }
  const missing = input.requiredProviders.filter((p) => !input.includedProviders.includes(p));
  if (missing.length > 0) {
    reasons.push(`required_providers_missing:${missing.join(",")}`);
  }
  if (!input.coverageComplete) reasons.push("account_coverage_incomplete");
  if (!input.timezoneConfigured) reasons.push("reporting_timezone_unverified");
  if (!input.currencyVerified) reasons.push("currency_unverified");
  if (!input.windowComplete) reasons.push("window_incomplete");
  if (!input.hasMetricData) reasons.push("no_metric_data");
  if (!input.aggregationCompatible) reasons.push("incompatible_metric_semantics");
  if (!input.destinationSatisfied) reasons.push("destination_evidence_missing");
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
    configVersion: number;
    requiredProviders: string[];
    requireDestination: boolean;
    reportingTimezone: string | null;
    reportingCurrency: string | null;
  } | null;
  requirementUpdatedAt: string | null;
  accounts: Array<{ connectionId: string; provider: string; accountId: string; status: string }>;
  dataThrough: Record<string, string | null>;
  currencySet: string[];
  readinessBlockers: string[];
  destination: { connectionId: string; status: string } | null;
  contractVersions: Record<string, string>;
};

export const STALE_REASON_LABELS: Record<string, string> = {
  requirement_changed: "Client reporting requirements changed after generation",
  account_coverage_changed: "Connected ad accounts changed after generation",
  data_through_changed: "Underlying warehouse data advanced after generation",
  currency_set_changed: "Reporting currencies in the window changed after generation",
  readiness_changed: "Readiness evidence changed after generation",
  destination_changed: "Delivery destination changed after generation",
  contract_changed: "Metric contract version changed after generation",
};

function diffDependencyComponents(stored: DependencyState, current: DependencyState): string[] {
  const reasons: string[] = [];
  if (canonicalJson(stored.requirement) !== canonicalJson(current.requirement)
    || stored.requirementUpdatedAt !== current.requirementUpdatedAt) {
    reasons.push("requirement_changed");
  }
  if (canonicalJson(stored.accounts) !== canonicalJson(current.accounts)) {
    reasons.push("account_coverage_changed");
  }
  if (canonicalJson(stored.dataThrough) !== canonicalJson(current.dataThrough)) {
    reasons.push("data_through_changed");
  }
  if (canonicalJson(stored.currencySet) !== canonicalJson(current.currencySet)) {
    reasons.push("currency_set_changed");
  }
  if (canonicalJson(stored.readinessBlockers) !== canonicalJson(current.readinessBlockers)) {
    reasons.push("readiness_changed");
  }
  if (canonicalJson(stored.destination) !== canonicalJson(current.destination)) {
    reasons.push("destination_changed");
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
  connectionCount: number;
  accountsCovered: number;
  coverageComplete: boolean;
  hasData: boolean;
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
    reportingTimezone: string;
    currency: string | null;
    requiredProviders: string[];
    includedProviders: string[];
    includedAccounts: Array<{ provider: string; accountId: string; connectionId: string }>;
    generatedAt: string;
    verification: VerificationResult;
    readiness: { status: BlueprintReadiness; blockers: string[] };
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

function explanationFor(breakdown: Omit<ProviderBreakdown, "explanation">): string {
  if (breakdown.connectionCount === 0) {
    return "No source connection is configured for this provider. Connect it under Sources to include it in verified reports.";
  }
  if (!breakdown.hasData) {
    const dataThrough = breakdown.dataThrough
      ? `Latest warehouse data is through ${breakdown.dataThrough.slice(0, 10)}.`
      : "The warehouse holds no normalized rows for this provider yet.";
    return `No normalized data exists for this provider in the selected window. ${dataThrough} Run a warehouse refresh from the Data explorer.`;
  }
  if (!breakdown.coverageComplete) {
    return "Some connected accounts for this provider reported no rows in the window, so account coverage is incomplete.";
  }
  if (!breakdown.metrics.monetaryAvailable) {
    return `Rows report mixed or unknown currencies (${breakdown.metrics.currencies.join(", ")}); monetary totals are intentionally unavailable and no conversion is performed.`;
  }
  return "Complete account coverage with verified currency for this window.";
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

type RequirementRow = import("@prisma/client").ClientReportingRequirement | null;

async function loadRequirement(workspaceId: string, clientId: string): Promise<RequirementRow> {
  return prisma.clientReportingRequirement.findUnique({
    where: { workspaceId_clientId: { workspaceId, clientId } },
  });
}

type ConnectionSummary = {
  id: string;
  provider: string;
  remoteAccountId: string;
  status: string;
  lastDataThrough: Date | null;
};

async function loadClientConnections(
  workspaceId: string,
  clientId: string,
  providers: string[],
): Promise<ConnectionSummary[]> {
  return prisma.connection.findMany({
    where: {
      workspaceId,
      clientId,
      type: "source",
      provider: { in: providers },
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
}

async function loadWindowRows(
  workspaceId: string,
  clientId: string,
  providers: string[],
  window: ReportingWindow,
  timeZone: string,
): Promise<MetricRowInput[]> {
  const range = windowToDateRange(window, timeZone);
  return prisma.campaignMetric.findMany({
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
      impressions: true,
      clicks: true,
      spend: true,
      conversions: true,
      revenue: true,
      currency: true,
    },
    orderBy: [{ id: "asc" }],
  });
}

async function resolveDestination(workspaceId: string): Promise<{ connectionId: string; status: string } | null> {
  const destination = await prisma.connection.findFirst({
    where: { workspaceId, type: "destination" },
    select: { id: true, status: true },
    orderBy: { id: "asc" },
  });
  return destination ? { connectionId: destination.id, status: destination.status } : null;
}

// ---------------------------------------------------------------------------
// Generation context
// ---------------------------------------------------------------------------

type GenerationContext = {
  workspaceId: string;
  clientId: string;
  clientName: string;
  requirement: NonNullable<RequirementRow>;
  window: ReportingWindow;
  comparisonWindow: ReportingWindow;
  connections: ConnectionSummary[];
  currentRows: MetricRowInput[];
  previousRows: MetricRowInput[];
  readiness: ReportingReadiness;
  destination: { connectionId: string; status: string } | null;
};

function buildDependencyState(ctx: GenerationContext): DependencyState {
  const { requirement } = ctx;
  const accounts = ctx.connections
    .map((connection) => ({
      connectionId: connection.id,
      provider: connection.provider,
      accountId: connection.remoteAccountId,
      status: connection.status,
    }))
    .sort((a, b) => compareStrings(a.connectionId, b.connectionId));
  const dataThrough: Record<string, string | null> = {};
  for (const connection of ctx.connections) {
    dataThrough[connection.id] = connection.lastDataThrough?.toISOString() ?? null;
  }
  return {
    requirement: {
      configVersion: requirement.configVersion,
      requiredProviders: [...requirement.requiredProviders].sort(),
      requireDestination: requirement.requireDestination,
      reportingTimezone: requirement.reportingTimezone,
      reportingCurrency: requirement.reportingCurrency,
    },
    requirementUpdatedAt: requirement.updatedAt.toISOString(),
    accounts,
    dataThrough,
    currencySet: [...ctx.readiness.currencies].sort(),
    readinessBlockers: [...ctx.readiness.blockers].sort(),
    destination: ctx.destination ? { ...ctx.destination } : null,
    contractVersions: { metrics: METRIC_CONTRACT_VERSION },
  };
}

function computeGenerationKey(
  workspaceId: string,
  clientId: string,
  window: ReportingWindow,
  timeZone: string,
): string {
  return sha256Hex(canonicalJson({
    workspaceId,
    clientId,
    blueprintId: BLUEPRINT_ID,
    blueprintVersion: BLUEPRINT_VERSION,
    reportingWindow: window,
    reportingTimezone: timeZone,
  }));
}

function currencyVerifiedFor(
  requirement: NonNullable<RequirementRow>,
  totals: BlueprintMetrics,
): boolean {
  return totals.monetaryAvailable
    && (!requirement.reportingCurrency || totals.currency === requirement.reportingCurrency.trim().toUpperCase());
}

function aggregationCompatibleFor(
  requiredProviders: string[],
  currentRows: MetricRowInput[],
  totals: BlueprintMetrics,
): boolean {
  if (totals.monetaryAvailable) return true;
  // Mixed overall is acceptable only when every provider scope is internally
  // compatible; combined monetary totals stay unavailable either way.
  return requiredProviders.every((provider) => {
    const providerMetrics = aggregateBlueprintMetrics(
      currentRows.filter((row) => row.platform === provider),
    );
    return providerMetrics.monetaryAvailable || providerMetrics.currencies.length === 0;
  });
}

function coverageCompleteFor(
  requiredProviders: string[],
  connections: ConnectionSummary[],
  currentRows: MetricRowInput[],
): boolean {
  const covered = new Set(currentRows.map((row) => row.connectionId));
  return requiredProviders.every((provider) => {
    const providerConnections = connections.filter((c) => c.provider === provider);
    return providerConnections.length > 0
      && providerConnections.every((c) => covered.has(c.id));
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

  for (const provider of ctx.requirement.requiredProviders) {
    const providerConnections = ctx.connections.filter((c) => c.provider === provider);
    const currentRows = ctx.currentRows.filter((row) => row.platform === provider);
    const previousRows = ctx.previousRows.filter((row) => row.platform === provider);
    const metrics = aggregateBlueprintMetrics(currentRows);
    const coveredConnectionIds = new Set(currentRows.map((row) => row.connectionId));
    const accountsCovered = providerConnections.filter((c) => coveredConnectionIds.has(c.id)).length;
    const providerCoverageComplete = providerConnections.length > 0
      && accountsCovered === providerConnections.length;
    const hasData = currentRows.length > 0;
    if (hasData) {
      includedProviders.push(provider);
      for (const connection of providerConnections.filter((c) => coveredConnectionIds.has(c.id))) {
        includedAccounts.push({
          provider,
          accountId: connection.remoteAccountId,
          connectionId: connection.id,
        });
      }
    }
    const dataThroughCandidates = providerConnections
      .map((c) => c.lastDataThrough?.toISOString() ?? null)
      .filter((value): value is string => Boolean(value))
      .sort();
    const partial: Omit<ProviderBreakdown, "explanation"> = {
      provider,
      providerLabel: getPlatformLabel(provider),
      required: true,
      connectionCount: providerConnections.length,
      accountsCovered,
      coverageComplete: providerCoverageComplete,
      hasData,
      metrics,
      changes: computeMetricsDeltas(metrics, aggregateBlueprintMetrics(previousRows)),
      dataThrough: dataThroughCandidates.at(-1) ?? null,
    };
    providers.push({ ...partial, explanation: explanationFor(partial) });
  }

  includedAccounts.sort((a, b) =>
    compareStrings(a.provider, b.provider) || compareStrings(a.accountId, b.accountId));
  includedProviders.sort();
  return { providers, includedProviders, includedAccounts };
}

function buildReport(ctx: GenerationContext, verification: VerificationResult): BlueprintReport {
  const totals = aggregateBlueprintMetrics(ctx.currentRows);
  const { providers, includedProviders, includedAccounts } = buildProviderBreakdowns(ctx);

  return {
    overview: {
      clientName: ctx.clientName,
      blueprintId: BLUEPRINT_ID,
      blueprintVersion: BLUEPRINT_VERSION,
      reportingWindow: ctx.window,
      comparisonWindow: ctx.comparisonWindow,
      reportingTimezone: ctx.requirement.reportingTimezone as string,
      currency: totals.currency,
      requiredProviders: ctx.requirement.requiredProviders,
      includedProviders,
      includedAccounts,
      generatedAt: new Date().toISOString(),
      verification,
      readiness: {
        status: mapReadinessStatus(ctx.readiness.status),
        blockers: ctx.readiness.blockers,
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
  coverageComplete: boolean,
  hasMetricData: boolean,
  aggregationCompatible: boolean,
  dependencyHashMatches: boolean,
): VerificationResult {
  const includedProviders = [...new Set(ctx.currentRows.map((row) => row.platform))];
  return computeVerificationStatus({
    readinessStatus: mapReadinessStatus(ctx.readiness.status),
    requiredProviders: ctx.requirement.requiredProviders as SupportedProvider[],
    includedProviders,
    coverageComplete,
    timezoneConfigured: Boolean(ctx.requirement.reportingTimezone),
    currencyVerified: currencyVerifiedFor(ctx.requirement, totals),
    windowComplete: windowIsComplete(ctx.window, ctx.requirement.reportingTimezone as string),
    hasMetricData,
    aggregationCompatible,
    destinationSatisfied: !ctx.requirement.requireDestination
      || (ctx.destination !== null && ctx.destination.status === "connected"),
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
  readiness: ReportingReadiness;
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
 * a new immutable sequence is created. `READY` + every verification gate
 * produces the customer-facing `VERIFIED` label; anything else stores the
 * underlying readiness state and exact recovery reasons.
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
    select: { id: true, name: true },
  });
  if (!client) {
    throw new BlueprintInputError("Client not found in this workspace.", "client_not_found");
  }
  const requirement = await loadRequirement(workspaceId, clientId);
  if (!requirement) {
    throw new BlueprintInputError(
      "No reporting requirements are configured for this client. Configure required providers, timezone and currency before generating a verified report.",
      "requirements_not_configured",
    );
  }
  if (requirement.requiredProviders.length === 0 || !requirement.reportingTimezone) {
    throw new BlueprintInputError(
      "Client reporting requirements must configure required providers and a reporting timezone.",
      "requirements_not_configured",
    );
  }
  if (!isValidTimeZone(requirement.reportingTimezone)) {
    throw new BlueprintInputError("Configured reporting timezone is invalid.", "invalid_timezone");
  }
  const timeZone = requirement.reportingTimezone;

  const window = params.windowStart && params.windowEnd
    ? resolveExplicitWindow(params.windowStart, params.windowEnd)
    : lastCompleteWeek(timeZone, now);
  const comparisonWindow = comparisonWindowFor(window);
  const providers = requirement.requiredProviders;

  const connections = await loadClientConnections(workspaceId, clientId, providers);
  const [currentRows, previousRows] = await Promise.all([
    loadWindowRows(workspaceId, clientId, providers, window, timeZone),
    loadWindowRows(workspaceId, clientId, providers, comparisonWindow, timeZone),
  ]);
  const readiness = await deriveReportingReadiness(workspaceId, {
    since: window.start,
    until: window.end,
    clientId,
  });
  const destination = requirement.requireDestination
    ? await resolveDestination(workspaceId)
    : null;

  const ctx: GenerationContext = {
    workspaceId,
    clientId,
    clientName: client.name,
    requirement,
    window,
    comparisonWindow,
    connections,
    currentRows,
    previousRows,
    readiness,
    destination,
  };

  const totals = aggregateBlueprintMetrics(currentRows);
  const coverageComplete = coverageCompleteFor(providers, connections, currentRows);
  const hasMetricData = currentRows.length > 0;
  const aggregationCompatible = aggregationCompatibleFor(providers, currentRows, totals);

  const dependencyState = buildDependencyState(ctx);
  const dependencyHash = computeDependencyHash(dependencyState);
  const generationKey = computeGenerationKey(workspaceId, clientId, window, timeZone);

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
      readiness,
    };
  }

  const verification = buildVerification(
    ctx,
    totals,
    coverageComplete,
    hasMetricData,
    aggregationCompatible,
    true,
  );
  const report = buildReport(ctx, verification);
  const campaigns = buildCampaignTable(currentRows, previousRows);
  report.campaigns = campaigns.campaigns;
  report.campaignTruncated = campaigns.truncated;
  report.campaignTotal = campaigns.totalTracked;

  const dateRange = windowToDateRange(window, timeZone);
  const comparisonRange = windowToDateRange(comparisonWindow, timeZone);
  const maxSequence = await prisma.reportSnapshot.findFirst({
    where: { generationKey },
    orderBy: [{ sequence: "desc" }],
    select: { sequence: true },
  });

  const created = await prisma.reportSnapshot.create({
    data: {
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
      reportingTimezone: timeZone,
      reportingCurrency: requirement.reportingCurrency,
      requiredProviders: providers,
      includedProviders: report.overview.includedProviders,
      includedAccountIds: report.overview.includedAccounts.map((account) => account.accountId),
      dataThroughByProvider: Object.fromEntries(
        report.providers.map((provider) => [provider.provider, provider.dataThrough]),
      ),
      metricContractVersions: dependencyState.contractVersions,
      readinessStatus: report.overview.readiness.status,
      verificationStatus: verification.status,
      verificationReasons: verification.reasons,
      readinessEvidence: {
        freshness: readiness.freshness,
        blockers: readiness.blockers,
        currencies: readiness.currencies,
        lastDataThrough: readiness.lastDataThrough,
        exportable: readiness.exportable,
        evidenceIdentifier: dependencyHash,
        dependencyState,
      },
      destinationConnectionId: destination?.connectionId ?? null,
      ...(destination ? { destinationEvidence: { status: destination.status } } : {}),
      generatorCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null,
      schemaVersion: BLUEPRINT_SCHEMA_VERSION,
      dependencyHash,
      result: report as unknown as Record<string, unknown>,
    },
  }).catch(async (error: unknown) => {
    // Concurrent generation raced on (generationKey, sequence): the winner's
    // snapshot is the answer — never a second row for the same version.
    if (isUniqueViolation(error)) {
      const winner = await prisma.reportSnapshot.findFirst({
        where: { generationKey, dependencyHash },
        orderBy: [{ sequence: "desc" }],
      });
      if (winner) return winner;
    }
    throw error;
  });

  return {
    snapshot: toSnapshotMeta(created),
    report,
    created: true,
    readiness,
  };
}

export type FreshnessResult = {
  freshness: "CURRENT" | "STALE";
  staleReasons: string[];
  dependencyHashMatches: boolean;
};

/**
 * Recompute the stored snapshot's canonical dependency state from live
 * warehouse/configuration data and diff it against generation time.
 */
export async function evaluateSnapshotFreshness(snapshot: {
  workspaceId: string;
  clientId: string;
  dependencyHash: string;
  reportingTimezone: string;
  reportingWindowStart: Date;
  reportingWindowEnd: Date;
  readinessEvidence: unknown;
}): Promise<FreshnessResult> {
  const evidence = snapshot.readinessEvidence as { dependencyState?: DependencyState } | null;
  const storedState = evidence?.dependencyState;
  if (!storedState) {
    return { freshness: "STALE", staleReasons: ["contract_changed"], dependencyHashMatches: false };
  }

  const timeZone = snapshot.reportingTimezone;
  const window: ReportingWindow = {
    start: calendarDayOf(snapshot.reportingWindowStart, timeZone),
    end: calendarDayOf(snapshot.reportingWindowEnd, timeZone),
  };

  const client = await prisma.client.findFirst({
    where: { id: snapshot.clientId, workspaceId: snapshot.workspaceId },
    select: { id: true },
  });
  const requirement = await loadRequirement(snapshot.workspaceId, snapshot.clientId);
  const providers = requirement?.requiredProviders ?? [];
  const connections = client
    ? await loadClientConnections(snapshot.workspaceId, snapshot.clientId, providers)
    : [];
  const [currentRows, readiness] = await Promise.all([
    client
      ? loadWindowRows(snapshot.workspaceId, snapshot.clientId, providers, window, timeZone)
      : Promise.resolve([] as MetricRowInput[]),
    deriveReportingReadiness(snapshot.workspaceId, {
      since: window.start,
      until: window.end,
      clientId: snapshot.clientId,
    }),
  ]);
  const destination = requirement?.requireDestination
    ? await resolveDestination(snapshot.workspaceId)
    : null;

  const synthetic: GenerationContext = {
    workspaceId: snapshot.workspaceId,
    clientId: snapshot.clientId,
    clientName: "",
    requirement: requirement ?? {
      id: "missing",
      workspaceId: snapshot.workspaceId,
      clientId: snapshot.clientId,
      requiredProviders: [],
      requireDestination: false,
      reportingTimezone: null,
      reportingCurrency: null,
      configVersion: 0,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    window,
    comparisonWindow: comparisonWindowFor(window),
    connections,
    currentRows,
    previousRows: [],
    readiness,
    destination,
  };
  const currentState = buildDependencyState(synthetic);

  // Contract versions are compared explicitly: the stored state carries the
  // contract version at generation time, the current state the live one.
  const contractMatches = storedState.contractVersions?.metrics === METRIC_CONTRACT_VERSION
    && canonicalJson(storedState.contractVersions) === canonicalJson(currentState.contractVersions);
  const currentHash = computeDependencyHash(currentState);
  if (currentHash === snapshot.dependencyHash && contractMatches) {
    return { freshness: "CURRENT", staleReasons: [], dependencyHashMatches: true };
  }
  return {
    freshness: "STALE",
    staleReasons: [
      ...diffDependencyComponents(storedState, currentState),
      ...(contractMatches ? [] : ["contract_changed"]),
    ],
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
  requirement: RequirementRow;
  snapshot: (SnapshotMeta & { freshness: FreshnessResult; verification: VerificationResult }) | null;
  report: BlueprintReport | null;
  defaultWindow: ReportingWindow | null;
}> {
  const { workspaceId, clientId, now = new Date() } = params;
  const requirement = await loadRequirement(workspaceId, clientId);
  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId },
    select: { id: true, name: true },
  });
  if (!client) {
    throw new BlueprintInputError("Client not found in this workspace.", "client_not_found");
  }
  const defaultWindow = requirement?.reportingTimezone
    ? lastCompleteWeek(requirement.reportingTimezone, now)
    : null;
  const window = params.windowStart && params.windowEnd
    ? resolveExplicitWindow(params.windowStart, params.windowEnd)
    : defaultWindow;

  if (!window || !requirement) {
    return { requirement, snapshot: null, report: null, defaultWindow };
  }

  const timeZone = requirement.reportingTimezone ?? "UTC";
  const generationKey = computeGenerationKey(workspaceId, clientId, window, timeZone);
  const snapshot = await prisma.reportSnapshot.findFirst({
    where: { generationKey },
    orderBy: [{ sequence: "desc" }],
  });
  if (!snapshot) {
    return { requirement, snapshot: null, report: null, defaultWindow };
  }

  const freshness = await evaluateSnapshotFreshness(snapshot);
  const verification: VerificationResult = freshness.dependencyHashMatches
    ? { status: snapshot.verificationStatus as BlueprintVerificationLabel, reasons: snapshot.verificationReasons }
    : {
      status: "NOT_VERIFIED",
      reasons: [...snapshot.verificationReasons, "dependency_evidence_changed"],
    };

  return {
    requirement,
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
    defaultWindow,
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
