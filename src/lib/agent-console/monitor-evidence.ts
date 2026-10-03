/**
 * Canonical Monitor Evidence Evaluation Service (C3 Hardened).
 *
 * Implements the Metric and Evidence Contract from Section 7 of docs/implementation-plans/agent-first-console.md:
 * - Expected account rosters and complete account/date coverage projection across BOTH current and baseline windows.
 * - Authoritative freshness: enforced via persisted source health, successful import timestamps, and data-through coverage.
 * - Missing baseline data remains unknown and blocks comparison (never converts to a zero baseline).
 * - Row currency validation against confirmed account roster.
 * - Rejection of duplicate observations, overlapping breakdowns, and mixed grains.
 * - Validation of finite, non-negative numeric values.
 * - Enforcement of provider conversion definitions, attribution windows, and revenue basis before combining or calculating ratios.
 * - Full normalized precision fingerprinting incorporating all context (windows, scope, revision, metric definitions, provenance, zero receipts, calculation version) with deterministic secondary tie-breaking for tied rows.
 * - Authorized, workspace-scoped application service boundary (evaluateAndPersistMonitorEvidence) loading persisted entities and recording audit events.
 * - Explicit execution mode requirement ("live_production" | "local_test"); synthetic evidence is visibly tagged.
 */

import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  QualityGateCode,
  evaluateProviderCapability,
  PROVIDER_CAPABILITY_REGISTRY,
  type ExecutionMode,
  type RowGrain,
} from "./capabilities";
export type { RowGrain };
import {
  ExpectedAccountRoster,
  validateScopeAgainstRoster,
  buildCanonicalAccountId,
} from "./roster";
import {
  ConsoleTransaction,
  requireWorkspaceRole,
  appendConsoleEvent,
  AgentConsoleError,
  canonicalJsonStringify,
} from "./persistence";
import {
  resolveSourceHealthState,
  SOURCE_HEALTH_STALE_AFTER_MS,
} from "../source-health";

// ---------------------------------------------------------------------------
// 0. Verified Provenance Origins & Domain Validators
// ---------------------------------------------------------------------------

export const VALID_PROVENANCE_ORIGINS = [
  "provider_response",
  "provider_request",
  "account_config",
] as const;

export type ProvenanceOrigin = (typeof VALID_PROVENANCE_ORIGINS)[number];

/**
 * Validates cpaFloor independently from monetary CPA targets.
 * Must be a finite number >= 1. Defaults to 20 when omitted/null/undefined.
 */
export function validateCpaFloor(
  value: unknown,
): { valid: boolean; error?: string; floor: number } {
  if (value === undefined || value === null) {
    return { valid: true, floor: 20 };
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Number.isNaN(value) ||
    value < 1
  ) {
    return {
      valid: false,
      error: `Invalid cpaFloor: expected a finite number >= 1, received ${
        typeof value === "number" ? value : typeof value
      }`,
      floor: 20,
    };
  }
  return { valid: true, floor: value };
}

// ---------------------------------------------------------------------------
// 1. Exact Decimal Arithmetic Helper
// ---------------------------------------------------------------------------

/**
 * High-precision exact decimal representation for monetary and ratio values.
 * Stores values as scaled integers (micros = value * 1,000,000) to eliminate IEEE 754 floating point drift.
 */
export class ExactDecimal {
  public static readonly SCALE = BigInt(1_000_000);
  public static readonly SCALE_DECIMALS = 6;
  private readonly scaled: bigint;

  private constructor(scaled: bigint) {
    this.scaled = scaled;
  }

  public static zero(): ExactDecimal {
    return new ExactDecimal(BigInt(0));
  }

  public static fromNumber(val: number): ExactDecimal {
    if (!Number.isFinite(val)) {
      throw new Error(`Invalid non-finite number for ExactDecimal: ${val}`);
    }
    // Multiply by scale using fixed precision string to prevent float parsing artifacts
    const str = val.toFixed(ExactDecimal.SCALE_DECIMALS);
    return ExactDecimal.fromString(str);
  }

  public static fromString(val: string): ExactDecimal {
    const trimmed = val.trim();
    if (!trimmed || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new Error(`Invalid numeric string for ExactDecimal: '${val}'`);
    }
    const isNegative = trimmed.startsWith("-");
    const abs = isNegative ? trimmed.slice(1) : trimmed;
    const parts = abs.split(".");
    const whole = BigInt(parts[0]);
    let frac = parts[1] || "";
    if (frac.length > ExactDecimal.SCALE_DECIMALS) {
      frac = frac.slice(0, ExactDecimal.SCALE_DECIMALS);
    } else {
      frac = frac.padEnd(ExactDecimal.SCALE_DECIMALS, "0");
    }
    const total = whole * ExactDecimal.SCALE + BigInt(frac);
    return new ExactDecimal(isNegative ? -total : total);
  }

  public add(other: ExactDecimal): ExactDecimal {
    return new ExactDecimal(this.scaled + other.scaled);
  }

  public sub(other: ExactDecimal): ExactDecimal {
    return new ExactDecimal(this.scaled - other.scaled);
  }

  public isZero(): boolean {
    return this.scaled === BigInt(0);
  }

  public isPositive(): boolean {
    return this.scaled > BigInt(0);
  }

  public isNegative(): boolean {
    return this.scaled < BigInt(0);
  }

  public toNumber(): number {
    return Number(this.scaled) / Number(ExactDecimal.SCALE);
  }

  public toDisplayString(decimals = 2): string {
    const isNegative = this.scaled < BigInt(0);
    const abs = isNegative ? -this.scaled : this.scaled;
    const whole = abs / ExactDecimal.SCALE;
    const frac = abs % ExactDecimal.SCALE;
    // Round to requested decimals
    const divisor = BigInt(10) ** BigInt(ExactDecimal.SCALE_DECIMALS - decimals);
    const half = divisor / BigInt(2);
    let roundedFrac = (frac + half) / divisor;
    let roundedWhole = whole;
    const maxFrac = BigInt(10) ** BigInt(decimals);
    if (roundedFrac >= maxFrac) {
      roundedFrac -= maxFrac;
      roundedWhole += BigInt(1);
    }
    const fracStr = roundedFrac.toString().padStart(decimals, "0");
    return `${isNegative ? "-" : ""}${roundedWhole}.${fracStr}`;
  }

  public toExactString(): string {
    const isNegative = this.scaled < BigInt(0);
    const abs = isNegative ? -this.scaled : this.scaled;
    const whole = abs / ExactDecimal.SCALE;
    const frac = abs % ExactDecimal.SCALE;
    const fracStr = frac.toString().padStart(ExactDecimal.SCALE_DECIMALS, "0");
    return `${isNegative ? "-" : ""}${whole}.${fracStr}`;
  }

  public divide(other: ExactDecimal): { result: ExactDecimal | null; reason?: string } {
    if (other.isZero()) {
      return { result: null, reason: "ZERO_DENOMINATOR" };
    }
    const scaledResult = (this.scaled * ExactDecimal.SCALE) / other.scaled;
    return { result: new ExactDecimal(scaledResult) };
  }
}

// ---------------------------------------------------------------------------
// 2. Types & Interfaces
// ---------------------------------------------------------------------------

export interface TimeWindow {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
  daysCount: number;
  dates: string[]; // Ordered list of YYYY-MM-DD
}

export interface ComparisonWindows {
  currentWindow: TimeWindow;
  baselineWindow: TimeWindow;
  timezone: string;
  lagDays: number;
  asOfTimestamp: string;
}

export interface MetricInputRecord {
  id?: string;
  date: string | Date;
  platform: string;
  connectionId: string;
  accountId: string;
  level: string; // "campaign" | "account" | "ad" | "daily_order_rollup"
  entityId?: string;
  breakdownHash?: string;
  spend: number;
  conversions: number;
  revenue: number;
  currency?: string | null;
  rawData?: string | null;
}

export interface ZeroActivityReceipt {
  canonicalAccountId: string;
  date: string;
  verifiedAt: string;
  receiptId: string;
  provider: string;
  workspaceId?: string;
}

export interface SourceHealthEvidence {
  connectionId: string;
  provider: string;
  status: string;
  lastError?: string | null;
  lastSyncAt?: Date | string | null;
  lastDataThrough?: Date | string | null;
  isSyncing?: boolean;
}

export interface EvaluateEvidenceInput {
  workspaceId: string;
  clientId?: string | null;
  responsibilityId?: string | null;
  roster: ExpectedAccountRoster;
  queriedIdentifiers: readonly string[];
  executionMode: ExecutionMode; // Strictly required!
  targetGrain?: RowGrain;
  records: readonly MetricInputRecord[];
  zeroActivityReceipts?: readonly ZeroActivityReceipt[];
  windows: ComparisonWindows;
  sourceHealthList?: readonly SourceHealthEvidence[];
  cpaFloor?: number; // Minimum conversion volume (default 20 suggested)
  revenueBasis?: "order_placed" | "order_completed" | "attributed_ad_gmv";
  validateProvenance?: boolean;
  expectedAttributionWindow?: string;
  expectedConversionAction?: string;
}

export const VALID_ENDPOINTS_BY_PROVIDER: Record<string, readonly string[]> = {
  tiktok_business: ["AUCTION_CAMPAIGN", "BASIC_REPORTING", "REPORTING_V1", "ad/report"],
  meta_ads: ["INSIGHTS_REPORT", "CAMPAIGN_INSIGHTS", "act_insights", "ad/report"],
  google_ads: ["SEARCH_STREAM", "GOOGLE_ADS_REPORT", "CAMPAIGN_PERFORMANCE", "ad/report"],
};

export interface WindowMetricSummary {
  window: TimeWindow;
  spend: number;
  exactSpend: string;
  conversions: number;
  revenue: number | null;
  exactRevenue: string | null;
  cpa: number | null;
  displayCpa: string | null;
  cpaReason?: string;
  roas: number | null;
  displayRoas: string | null;
  roasReason?: string;
  currency: string;
  isComplete: boolean;
}

export interface MetricComparisonResult {
  current: WindowMetricSummary;
  baseline: WindowMetricSummary;
  comparisonBlocked: boolean;
  comparisonBlockReason?: string;
  spendDelta: number | null;
  spendDeltaRatio: number | null; // undefined/null if baseline spend is 0 or comparison blocked
  conversionDelta: number | null;
  conversionDeltaRatio: number | null;
  cpaDelta: number | null;
  cpaDeltaRatio: number | null;
  isCpaBreached?: boolean;
}

export interface EvaluatedInventory {
  expectedAccounts: string[];
  currentExpectedDates: string[];
  currentPresentDates: string[];
  currentMissingDates: string[];
  baselineExpectedDates: string[];
  baselinePresentDates: string[];
  baselineMissingDates: string[];
  zeroReceiptDates: string[];
  accountDayCoverageRatio: number;
  totalExpectedAccountDays: number;
  totalPresentAccountDays: number;
}

export interface MonitorEvidenceEvaluationResult {
  valid: boolean;
  blockers: QualityGateCode[];
  reasons: string[];
  datasetFingerprint: string;
  grain: RowGrain;
  metrics?: MetricComparisonResult;
  inventory: EvaluatedInventory;
  actualSince: string;
  actualUntil: string;
  currencies: string[];
  timezones: string[];
  calculationVersion: number;
  provenance: Record<string, unknown>;
  citations: readonly string[];
  isSynthetic: boolean;
  snapshotPayload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 3. Timezone-Aware Complete-Day Window Calculator
// ---------------------------------------------------------------------------

/**
 * Computes eligible comparison windows for complete days in the specified timezone.
 * Excludes today (incomplete day) and provider lag days.
 * Enforces provider-required minimum lag.
 */
export function getEligibleComparisonWindows(
  asOf: Date,
  timezone: string,
  options: { lagDays?: number; windowDays?: number; providerLagDays?: number } = {},
): ComparisonWindows {
  const providerLag = options.providerLagDays ?? 1;
  const requestedLag = options.lagDays ?? providerLag;
  // Enforce provider-required minimum lag
  const lagDays = Math.max(requestedLag, providerLag);
  const windowDays = options.windowDays ?? 7;

  if (windowDays <= 0) {
    throw new Error(`windowDays must be positive, got ${windowDays}`);
  }
  if (lagDays < 0) {
    throw new Error(`lagDays cannot be negative, got ${lagDays}`);
  }

  // Verify valid IANA timezone
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error(`Invalid IANA timezone identifier: '${timezone}'`);
  }

  // Format asOf date into year-month-day in target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(asOf);
  const partMap: Record<string, string> = {};
  for (const p of parts) partMap[p.type] = p.value;

  const currentTzYear = parseInt(partMap.year, 10);
  const currentTzMonth = parseInt(partMap.month, 10); // 1-indexed
  const currentTzDay = parseInt(partMap.day, 10);

  // Construct anchor date at midnight UTC representing the calendar day in timezone
  const todayUtcAnchor = new Date(Date.UTC(currentTzYear, currentTzMonth - 1, currentTzDay));

  const toIsoDateString = (d: Date): string => {
    return d.toISOString().slice(0, 10);
  };

  const addDays = (base: Date, days: number): Date => {
    const copy = new Date(base.getTime());
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy;
  };

  // Current window:
  // Latest complete available day = today - (1 + lagDays)
  const currentUntilDate = addDays(todayUtcAnchor, -(1 + lagDays));
  const currentSinceDate = addDays(currentUntilDate, -(windowDays - 1));

  const currentDates: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    currentDates.push(toIsoDateString(addDays(currentSinceDate, i)));
  }

  // Baseline window immediately precedes current window
  const baselineUntilDate = addDays(currentSinceDate, -1);
  const baselineSinceDate = addDays(baselineUntilDate, -(windowDays - 1));

  const baselineDates: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    baselineDates.push(toIsoDateString(addDays(baselineSinceDate, i)));
  }

  return {
    currentWindow: {
      since: toIsoDateString(currentSinceDate),
      until: toIsoDateString(currentUntilDate),
      daysCount: windowDays,
      dates: currentDates,
    },
    baselineWindow: {
      since: toIsoDateString(baselineSinceDate),
      until: toIsoDateString(baselineUntilDate),
      daysCount: windowDays,
      dates: baselineDates,
    },
    timezone,
    lagDays,
    asOfTimestamp: asOf.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 4. Deterministic Dataset Fingerprinting with Full Normalized Precision
// ---------------------------------------------------------------------------

export interface DatasetFingerprintContext {
  workspaceId: string;
  responsibilityId?: string | null;
  scopeRevision?: number;
  rosterRevision?: number;
  accountScope: Array<{ canonicalId: string; currency: string; timezone: string }>;
  currentWindow: TimeWindow;
  baselineWindow: TimeWindow;
  timezone: string;
  grain: string;
  metricSemantics?: Record<string, unknown>;
  responsibilityConfig?: {
    cpaFloor?: number;
    expectedAttributionWindow?: string;
    expectedConversionAction?: string;
    revenueBasis?: string;
  };
  provenance: Record<string, unknown>;
  zeroReceipts: Array<{ canonicalAccountId: string; date: string; receiptId: string }>;
  calculationVersion: number;
}

/**
 * Computes an immutable SHA-256 fingerprint over full normalized precision rows,
 * tied-row deterministic ordering, and all context that influences the result.
 */
export function computeDatasetFingerprint(
  context: DatasetFingerprintContext,
  records: readonly MetricInputRecord[],
): string {
  // Sort records deterministically using primary keys and secondary tie-breakers
  const sortedRecords = [...records].map((r) => {
    const dateStr = typeof r.date === "string" ? r.date.slice(0, 10) : r.date.toISOString().slice(0, 10);
    const spendDec = ExactDecimal.fromNumber(r.spend || 0);
    const revDec = ExactDecimal.fromNumber(r.revenue || 0);
    return {
      id: r.id ?? "",
      platform: r.platform,
      connectionId: r.connectionId,
      accountId: r.accountId,
      level: r.level,
      entityId: r.entityId ?? "",
      breakdownHash: r.breakdownHash ?? "none",
      date: dateStr,
      spend: spendDec.toExactString(), // Full 6-decimal normalized precision
      conversions: r.conversions || 0,
      revenue: revDec.toExactString(),
      currency: r.currency ?? null,
      rawData: r.rawData ?? "",
    };
  }).sort((a, b) => {
    // Primary key
    const primaryA = `${a.platform}:${a.connectionId}:${a.accountId}:${a.level}:${a.entityId}:${a.date}:${a.breakdownHash}`;
    const primaryB = `${b.platform}:${b.connectionId}:${b.accountId}:${b.level}:${b.entityId}:${b.date}:${b.breakdownHash}`;
    const primaryCmp = primaryA.localeCompare(primaryB);
    if (primaryCmp !== 0) return primaryCmp;

    // Secondary tie-breakers for tied keys
    const tieA = `${a.spend}:${a.conversions}:${a.revenue}:${a.currency}:${a.id}:${a.rawData}`;
    const tieB = `${b.spend}:${b.conversions}:${b.revenue}:${b.currency}:${b.id}:${b.rawData}`;
    return tieA.localeCompare(tieB);
  });

  const sortedZeroReceipts = [...context.zeroReceipts].sort((a, b) => {
    const kA = `${a.canonicalAccountId}:${a.date}:${a.receiptId}`;
    const kB = `${b.canonicalAccountId}:${b.date}:${b.receiptId}`;
    return kA.localeCompare(kB);
  });

  const sortedAccountScope = [...context.accountScope].sort((a, b) => {
    return a.canonicalId.localeCompare(b.canonicalId);
  });

  // Exclude incidental runtime timestamps (such as asOfTimestamp) from deterministic dataset identity
  const sanitizedProvenance = { ...context.provenance };
  delete (sanitizedProvenance as Record<string, unknown>).asOfTimestamp;

  const canonicalPayload = canonicalJsonStringify({
    workspaceId: context.workspaceId,
    responsibilityId: context.responsibilityId ?? null,
    scopeRevision: context.scopeRevision ?? 0,
    rosterRevision: context.rosterRevision ?? 0,
    accountScope: sortedAccountScope,
    currentWindow: context.currentWindow,
    baselineWindow: context.baselineWindow,
    timezone: context.timezone,
    grain: context.grain,
    metricSemantics: context.metricSemantics ?? {},
    responsibilityConfig: context.responsibilityConfig ?? {},
    provenance: sanitizedProvenance,
    zeroReceipts: sortedZeroReceipts,
    calculationVersion: context.calculationVersion,
    recordCount: sortedRecords.length,
    records: sortedRecords,
  });

  return crypto.createHash("sha256").update(canonicalPayload).digest("hex");
}

// ---------------------------------------------------------------------------
// 5. Core Monitor Evidence Evaluation Service
// ---------------------------------------------------------------------------

/**
 * Evaluates monitor evidence for a workspace scope against expected account rosters.
 * Reconciles inventory across BOTH current and baseline windows, authoritative freshness,
 * metric integrity, finite values, and provider semantics.
 */
export function evaluateMonitorEvidence(
  input: EvaluateEvidenceInput,
): MonitorEvidenceEvaluationResult {
  const blockers: QualityGateCode[] = [];
  const reasons: string[] = [];

  const targetGrain: RowGrain = input.targetGrain ?? "campaign";
  const executionMode: ExecutionMode = input.executionMode;

  // 1. Enforce Explicit Execution Mode
  if (!executionMode || (executionMode !== "live_production" && executionMode !== "local_test")) {
    blockers.push("CHECK_UNAVAILABLE");
    reasons.push(
      "Execution mode must be explicitly provided as 'live_production' or 'local_test'. Implicit defaults are prohibited.",
    );
  }

  // 2. Roster and Scope Validation
  const scopeValidation = validateScopeAgainstRoster(input.roster, input.queriedIdentifiers);
  if (!scopeValidation.valid) {
    blockers.push(...scopeValidation.blockers);
    reasons.push(...scopeValidation.reasons);
  }

  // Authoritative scope confirmation verification
  if (!input.roster?.confirmedAt || !input.roster?.confirmedByUserId) {
    blockers.push("ROSTER_UNCONFIRMED");
    reasons.push(
      "Expected account roster is missing authoritative scope confirmation time or confirming actor. Unconfirmed draft scopes cannot be monitored.",
    );
  }

  const expectedAccounts = input.roster?.accounts ?? [];
  const currencies = Array.from(new Set(expectedAccounts.map((a) => a.currency).filter(Boolean)));
  const timezones = Array.from(new Set(expectedAccounts.map((a) => a.timezone).filter(Boolean)));

  // Reject any account with missing currency or timezone (no guessing USD or America/New_York)
  for (const account of expectedAccounts) {
    if (!account.currency || account.currency.trim() === "") {
      blockers.push("CURRENCY_UNKNOWN");
      reasons.push(`Account '${account.canonicalId}' has unknown or missing currency metadata; guessing is prohibited`);
    }
    if (!account.timezone || account.timezone.trim() === "") {
      blockers.push("TIMEZONE_UNKNOWN");
      reasons.push(`Account '${account.canonicalId}' has unknown or missing timezone metadata; guessing is prohibited`);
    }
  }

  if (currencies.length === 0) {
    blockers.push("CURRENCY_UNKNOWN");
    reasons.push("Expected account roster has no verified currency defined");
  } else if (currencies.length > 1) {
    blockers.push("CURRENCY_CONFLICT");
    reasons.push(
      `Mixed currencies detected across roster accounts (${currencies.join(", ")}); currency blending is strictly prohibited`,
    );
  }

  if (timezones.length === 0) {
    blockers.push("TIMEZONE_UNKNOWN");
    reasons.push("Expected account roster has no verified timezone defined");
  } else if (timezones.length > 1) {
    blockers.push("TIMEZONE_CONFLICT");
    reasons.push(
      `Mixed timezones detected across roster accounts (${timezones.join(", ")}); multi-timezone scopes must be evaluated in separate split scopes`,
    );
  }

  const primaryCurrency = currencies[0] || "";

  // Map expected account currencies: canonicalId -> currency
  const accountCurrencyMap = new Map<string, string>();
  for (const acc of expectedAccounts) {
    accountCurrencyMap.set(acc.canonicalId, acc.currency);
  }

  // 2b. Validate cpaFloor domain independently from monetary CPA targets
  const floorValidation = validateCpaFloor(input.cpaFloor);
  if (!floorValidation.valid) {
    blockers.push("METRIC_UNSUPPORTED");
    reasons.push(floorValidation.error!);
  }
  const effectiveCpaFloor = floorValidation.floor;

  // 3. Provider Capability & Semantics Verification
  let supportsRevenue = true;
  let supportsCpa = true;

  for (const account of expectedAccounts) {
    const capDef = PROVIDER_CAPABILITY_REGISTRY[account.provider];
    if (capDef) {
      if (!capDef.metricSemantics.revenue) supportsRevenue = false;
      if (!capDef.metricSemantics.cpa) supportsCpa = false;
    }

    const capEval = evaluateProviderCapability(account.provider, "query_metric_window", {
      executionMode,
      metricNames: ["spend", "conversions", "cpa"],
      currencySupplied: Boolean(account.currency),
      timezoneSupplied: Boolean(account.timezone),
    });

    if (!capEval.allowed) {
      blockers.push(...capEval.blockers);
      if (capEval.reason) reasons.push(capEval.reason);
    }
  }

  // 4. Complete Freshness Evidence & Data-Through Check for Every Scoped Connection
  const scopedConnectionIds = Array.from(new Set(expectedAccounts.map((a) => a.connectionId)));
  const healthConnectionIds = new Set((input.sourceHealthList ?? []).map((sh) => sh.connectionId));
  const missingHealthConnections = scopedConnectionIds.filter((id) => !healthConnectionIds.has(id));

  if (!input.sourceHealthList || input.sourceHealthList.length === 0 || missingHealthConnections.length > 0) {
    blockers.push("DATA_STALE");
    reasons.push(
      `Freshness evidence is incomplete: missing or unverified source health evidence for connection(s) [${
        missingHealthConnections.length > 0 ? missingHealthConnections.join(", ") : "all scoped connections"
      }]. Complete freshness evidence is required for every scoped connection.`,
    );
  }

  if (input.sourceHealthList !== undefined && input.sourceHealthList.length > 0) {
    const asOfTime = new Date(input.windows.asOfTimestamp);
    const staleBefore = new Date(asOfTime.getTime() - SOURCE_HEALTH_STALE_AFTER_MS);

    for (const sh of input.sourceHealthList) {
      if (!sh.lastSyncAt) {
        blockers.push("DATA_STALE");
        reasons.push(
          `Connection '${sh.connectionId}' has never completed a sync (lastSyncAt is missing); freshness is unproven`,
        );
      }
      const state = resolveSourceHealthState({
        connectionStatus: sh.status,
        lastError: sh.lastError,
        lastSyncAt: sh.lastSyncAt,
        isSyncing: sh.isSyncing,
        now: asOfTime,
        staleBefore,
      });

      if (state !== "fresh") {
        blockers.push("DATA_STALE");
        reasons.push(
          `Connection '${sh.connectionId}' (${sh.provider}) has operational health '${state}'. Datasets cannot be labeled fresh without authoritative proof.`,
        );
      }

      // Check data-through coverage
      if (sh.lastDataThrough) {
        const dataThroughIso =
          typeof sh.lastDataThrough === "string"
            ? sh.lastDataThrough.slice(0, 10)
            : sh.lastDataThrough.toISOString().slice(0, 10);
        if (dataThroughIso < input.windows.currentWindow.until) {
          blockers.push("DATA_STALE");
          reasons.push(
            `Connection '${sh.connectionId}' data-through (${dataThroughIso}) does not cover current window until (${input.windows.currentWindow.until})`,
          );
        }
      } else {
        blockers.push("DATA_STALE");
        reasons.push(
          `Connection '${sh.connectionId}' has no verified data-through timestamp; coverage is unproven`,
        );
      }
    }
  }

  // 5. Metric Record Integrity, Currency Mismatch, Finite Numbers & Duplicate Overlap
  const seenGrains = new Set<string>();
  const seenEntityObservations = new Set<string>();
  const entityBreakdowns = new Map<string, Set<string>>();
  const seenEndpoints = new Set<string>();
  const seenAttributionWindows = new Set<string>();
  const seenConversionActions = new Set<string>();
  const seenRevenueBases = new Set<string>();

  for (const r of input.records) {
    // Numeric validity
    if (!Number.isFinite(r.spend) || r.spend < 0) {
      blockers.push("METRIC_UNSUPPORTED");
      reasons.push(`Invalid non-finite or negative spend value: ${r.spend}`);
    }
    if (!Number.isFinite(r.conversions) || r.conversions < 0) {
      blockers.push("METRIC_UNSUPPORTED");
      reasons.push(`Invalid non-finite or negative conversions value: ${r.conversions}`);
    }
    if (!Number.isFinite(r.revenue) || r.revenue < 0) {
      blockers.push("METRIC_UNSUPPORTED");
      reasons.push(`Invalid non-finite or negative revenue value: ${r.revenue}`);
    }

    // Row currency validation against confirmed account currency
    const canonicalId = buildCanonicalAccountId(r.platform, r.connectionId, r.accountId);
    const expectedCurrency = accountCurrencyMap.get(canonicalId);
    if (expectedCurrency && r.currency && r.currency !== expectedCurrency) {
      blockers.push("CURRENCY_CONFLICT");
      reasons.push(
        `Row currency '${r.currency}' does not match confirmed account currency '${expectedCurrency}' for account ${canonicalId}`,
      );
    }

    seenGrains.add(r.level);

    // Duplicate observation check
    const dateStr = typeof r.date === "string" ? r.date.slice(0, 10) : r.date.toISOString().slice(0, 10);
    const bHash = r.breakdownHash ?? "none";
    const entityKey = `${canonicalId}:${r.level}:${r.entityId ?? ""}:${dateStr}`;
    const obsKey = `${entityKey}:${bHash}`;

    if (seenEntityObservations.has(obsKey)) {
      blockers.push("DUPLICATE_ACCOUNT");
      reasons.push(`Duplicate row observation detected for entity ${r.entityId} on ${dateStr}`);
    }
    seenEntityObservations.add(obsKey);

    // Overlapping breakdown check
    if (!entityBreakdowns.has(entityKey)) {
      entityBreakdowns.set(entityKey, new Set<string>());
    }
    const currentBreakdowns = entityBreakdowns.get(entityKey)!;
    currentBreakdowns.add(bHash);
    if (currentBreakdowns.size > 1) {
      blockers.push("GRAIN_AMBIGUOUS");
      reasons.push(
        `Overlapping breakdowns detected for entity '${r.entityId}' on ${dateStr} (${Array.from(currentBreakdowns).join(", ")}). Combining breakdown slices with totals is prohibited.`,
      );
    }

    // Mandatory Semantics & Provenance Enforcement at the Application Boundary
    if (input.validateProvenance !== false) {
      let parsedProv: Record<string, unknown> | null = null;
      if (r.rawData) {
        try {
          parsedProv = typeof r.rawData === "string" ? JSON.parse(r.rawData) : (r.rawData as Record<string, unknown>);
        } catch {
          parsedProv = null;
        }
      }

      if (!parsedProv || !parsedProv.endpoint || !parsedProv.grain) {
        blockers.push("SEMANTICS_UNKNOWN");
        reasons.push(
          `Row '${r.id ?? canonicalId}' on ${dateStr} is a legacy record lacking normalized provenance context (endpoint, grain). Historical rows without verified semantics remain unsuitable for monitor evaluation.`,
        );
      } else {
        const endpointStr = String(parsedProv.endpoint);
        seenEndpoints.add(endpointStr);
        const account = expectedAccounts.find((a) => a.canonicalId === canonicalId);
        const provider = account?.provider ?? r.platform;
        const validEndpoints = VALID_ENDPOINTS_BY_PROVIDER[provider] ?? ["AUCTION_CAMPAIGN", "BASIC_REPORTING", "REPORTING_V1", "ad/report"];
        if (!validEndpoints.includes(endpointStr)) {
          blockers.push("SEMANTICS_UNKNOWN");
          reasons.push(
            `Row '${r.id ?? canonicalId}' on ${dateStr} specifies unsupported endpoint '${endpointStr}' for provider '${provider}'`,
          );
        }

        if (parsedProv.grain !== targetGrain) {
          blockers.push("GRAIN_AMBIGUOUS");
          reasons.push(
            `Row '${r.id ?? canonicalId}' on ${dateStr} has provenance grain '${parsedProv.grain}' conflicting with target grain '${targetGrain}'`,
          );
        }

        // Provenance origin verification: semantic labels alone do not establish verification
        const originStr = typeof parsedProv.provenanceOrigin === "string" ? parsedProv.provenanceOrigin : "";
        if (!VALID_PROVENANCE_ORIGINS.includes(originStr as ProvenanceOrigin)) {
          blockers.push("SEMANTICS_UNKNOWN");
          reasons.push(
            `Row '${r.id ?? canonicalId}' on ${dateStr} has unverified provenance origin '${originStr || "missing"}'. Semantic labels alone do not establish verification without verified origin (provider_response, provider_request, account_config).`,
          );
        }

        // Attribution window validation
        if (!parsedProv.attributionWindow || typeof parsedProv.attributionWindow !== "string" || parsedProv.attributionWindow.trim() === "") {
          blockers.push("SEMANTICS_UNKNOWN");
          reasons.push(
            `Row '${r.id ?? canonicalId}' on ${dateStr} is missing required attribution window context`,
          );
        } else {
          seenAttributionWindows.add(parsedProv.attributionWindow);
          if (
            input.expectedAttributionWindow &&
            parsedProv.attributionWindow !== input.expectedAttributionWindow
          ) {
            blockers.push("SEMANTICS_UNKNOWN");
            reasons.push(
              `Row '${r.id ?? canonicalId}' on ${dateStr} has attribution window '${parsedProv.attributionWindow}' conflicting with expected '${input.expectedAttributionWindow}'`,
            );
          }
        }

        // Conversion action validation
        if (!parsedProv.conversionAction || typeof parsedProv.conversionAction !== "string" || parsedProv.conversionAction.trim() === "") {
          blockers.push("SEMANTICS_UNKNOWN");
          reasons.push(
            `Row '${r.id ?? canonicalId}' on ${dateStr} is missing required conversion action context`,
          );
        } else {
          seenConversionActions.add(parsedProv.conversionAction);
          if (
            input.expectedConversionAction &&
            parsedProv.conversionAction !== input.expectedConversionAction
          ) {
            blockers.push("SEMANTICS_UNKNOWN");
            reasons.push(
              `Row '${r.id ?? canonicalId}' on ${dateStr} has conversion action '${parsedProv.conversionAction}' conflicting with expected '${input.expectedConversionAction}'`,
            );
          }
        }

        // Availability validation
        if (!parsedProv.availability || (parsedProv.availability !== "final" && parsedProv.availability !== "complete")) {
          blockers.push("SEMANTICS_UNKNOWN");
          reasons.push(
            `Row '${r.id ?? canonicalId}' on ${dateStr} has non-final data availability '${String(parsedProv.availability)}'`,
          );
        }

        // Revenue basis validation when revenue > 0
        if (r.revenue > 0) {
          if (!parsedProv.revenueBasis || typeof parsedProv.revenueBasis !== "string" || parsedProv.revenueBasis.trim() === "") {
            blockers.push("SEMANTICS_UNKNOWN");
            reasons.push(
              `Row '${r.id ?? canonicalId}' on ${dateStr} has positive revenue but lacks required revenue basis context`,
            );
          } else {
            seenRevenueBases.add(parsedProv.revenueBasis);
          }
        }
      }
    }
  }

  // Cross-row semantics consistency checks
  if (seenAttributionWindows.size > 1) {
    blockers.push("SEMANTICS_UNKNOWN");
    reasons.push(
      `Incompatible attribution window definitions detected across rows in dataset: [${Array.from(seenAttributionWindows).join(", ")}]`,
    );
  }
  if (seenConversionActions.size > 1) {
    blockers.push("SEMANTICS_UNKNOWN");
    reasons.push(
      `Incompatible conversion action definitions detected across rows in dataset: [${Array.from(seenConversionActions).join(", ")}]`,
    );
  }
  if (seenRevenueBases.size > 1) {
    blockers.push("SEMANTICS_UNKNOWN");
    reasons.push(
      `Incompatible revenue basis definitions detected across rows in dataset: [${Array.from(seenRevenueBases).join(", ")}]`,
    );
  }

  if (seenGrains.size > 1) {
    blockers.push("GRAIN_AMBIGUOUS");
    reasons.push(
      `Mixed row grains detected in dataset: [${Array.from(seenGrains).join(", ")}]. Aggregating multiple grain levels into a single metric is prohibited.`,
    );
  } else if (seenGrains.size === 1) {
    const actualGrain = Array.from(seenGrains)[0];
    if (actualGrain !== targetGrain && !(targetGrain === "campaign" && actualGrain === "account")) {
      blockers.push("GRAIN_AMBIGUOUS");
      reasons.push(`Requested target grain '${targetGrain}' does not match record grain '${actualGrain}'`);
    }
  }

  // 6. Complete Coverage Projection Across BOTH Current and Baseline Windows
  const currentDates = input.windows.currentWindow.dates;
  const baselineDates = input.windows.baselineWindow.dates;

  // Zero-activity receipts map with authoritative source, scope and date verification
  const validZeroReceiptsMap = new Set<string>();
  const expectedCanonicalIds = new Set(expectedAccounts.map((a) => a.canonicalId));

  for (const z of input.zeroActivityReceipts ?? []) {
    const isScopeValid = expectedCanonicalIds.has(z.canonicalAccountId);
    const isDateValid = currentDates.includes(z.date) || baselineDates.includes(z.date);
    const matchingAccount = expectedAccounts.find((a) => a.canonicalId === z.canonicalAccountId);
    const providerDef = matchingAccount ? PROVIDER_CAPABILITY_REGISTRY[matchingAccount.provider] : null;
    const supportsZeroDay = providerDef?.zeroDayProofSupported ?? false;

    if (isScopeValid && isDateValid && supportsZeroDay && z.receiptId && z.receiptId.trim() !== "") {
      validZeroReceiptsMap.add(`${z.canonicalAccountId}:${z.date}`);
    }
  }

  interface AccountDateAggregation {
    spend: ExactDecimal;
    conversions: number;
    revenue: ExactDecimal;
    recordCount: number;
  }

  const recordMap = new Map<string, AccountDateAggregation>();
  for (const r of input.records) {
    const dateStr = typeof r.date === "string" ? r.date.slice(0, 10) : r.date.toISOString().slice(0, 10);
    const canonicalId = buildCanonicalAccountId(r.platform, r.connectionId, r.accountId);
    const key = `${canonicalId}:${dateStr}`;

    const existing = recordMap.get(key) ?? {
      spend: ExactDecimal.zero(),
      conversions: 0,
      revenue: ExactDecimal.zero(),
      recordCount: 0,
    };

    existing.spend = existing.spend.add(ExactDecimal.fromNumber(r.spend || 0));
    existing.conversions += r.conversions || 0;
    existing.revenue = existing.revenue.add(ExactDecimal.fromNumber(r.revenue || 0));
    existing.recordCount += 1;
    recordMap.set(key, existing);
  }

  const currentMissingDatesSet = new Set<string>();
  const currentPresentDatesSet = new Set<string>();
  const baselineMissingDatesSet = new Set<string>();
  const baselinePresentDatesSet = new Set<string>();
  const zeroReceiptDatesSet = new Set<string>();

  let totalExpectedAccountDays = 0;
  let totalPresentAccountDays = 0;

  for (const account of expectedAccounts) {
    const providerDef = PROVIDER_CAPABILITY_REGISTRY[account.provider];
    const supportsZeroDay = providerDef?.zeroDayProofSupported ?? false;

    // Check Current Window
    for (const d of currentDates) {
      totalExpectedAccountDays += 1;
      const key = `${account.canonicalId}:${d}`;
      const hasRecords = recordMap.has(key);
      const hasZeroReceipt = validZeroReceiptsMap.has(key);

      if (hasRecords) {
        currentPresentDatesSet.add(d);
        totalPresentAccountDays += 1;
      } else if (hasZeroReceipt && supportsZeroDay) {
        currentPresentDatesSet.add(d);
        zeroReceiptDatesSet.add(d);
        totalPresentAccountDays += 1;
      } else {
        currentMissingDatesSet.add(d);
      }
    }

    // Check Baseline Window
    for (const d of baselineDates) {
      totalExpectedAccountDays += 1;
      const key = `${account.canonicalId}:${d}`;
      const hasRecords = recordMap.has(key);
      const hasZeroReceipt = validZeroReceiptsMap.has(key);

      if (hasRecords) {
        baselinePresentDatesSet.add(d);
        totalPresentAccountDays += 1;
      } else if (hasZeroReceipt && supportsZeroDay) {
        baselinePresentDatesSet.add(d);
        zeroReceiptDatesSet.add(d);
        totalPresentAccountDays += 1;
      } else {
        baselineMissingDatesSet.add(d);
      }
    }
  }

  const isCurrentComplete = currentMissingDatesSet.size === 0;
  const isBaselineComplete = baselineMissingDatesSet.size === 0;

  if (!isCurrentComplete) {
    blockers.push("WINDOW_INCOMPLETE");
    reasons.push(
      `Current evaluation window [${input.windows.currentWindow.since}..${input.windows.currentWindow.until}] is incomplete. Missing ${currentMissingDatesSet.size} dates: [${Array.from(currentMissingDatesSet).sort().join(", ")}].`,
    );
  }

  if (!isBaselineComplete) {
    blockers.push("WINDOW_INCOMPLETE");
    reasons.push(
      `Baseline evaluation window [${input.windows.baselineWindow.since}..${input.windows.baselineWindow.until}] is incomplete. Missing ${baselineMissingDatesSet.size} dates: [${Array.from(baselineMissingDatesSet).sort().join(", ")}]. Missing baseline data must remain unknown and blocks comparison; it can never be treated as zero.`,
    );
  }

  // 7. Exact Metric Aggregation (Current vs Baseline)
  const aggregateWindow = (dates: string[], isWindowComplete: boolean): WindowMetricSummary => {
    let windowSpend = ExactDecimal.zero();
    let windowConversions = 0;
    let windowRevenue = ExactDecimal.zero();

    for (const account of expectedAccounts) {
      for (const d of dates) {
        const key = `${account.canonicalId}:${d}`;
        const agg = recordMap.get(key);
        if (agg) {
          windowSpend = windowSpend.add(agg.spend);
          windowConversions += agg.conversions;
          windowRevenue = windowRevenue.add(agg.revenue);
        }
      }
    }

    const cpaFloor = effectiveCpaFloor;

    let cpa: number | null = null;
    let displayCpa: string | null = null;
    let cpaReason: string | undefined = undefined;

    if (!supportsCpa) {
      cpa = null;
      cpaReason = "METRIC_UNSUPPORTED";
    } else if (windowConversions === 0) {
      cpa = null;
      cpaReason = windowSpend.isPositive()
        ? "ZERO_DENOMINATOR_SPEND_WITHOUT_CONVERSIONS"
        : "ZERO_DENOMINATOR";
    } else if (windowConversions < cpaFloor) {
      const div = windowSpend.divide(ExactDecimal.fromNumber(windowConversions));
      cpa = div.result ? div.result.toNumber() : null;
      displayCpa = div.result ? div.result.toDisplayString(2) : null;
      cpaReason = `LOW_CONVERSION_VOLUME_BELOW_FLOOR_${cpaFloor}`;
    } else {
      const div = windowSpend.divide(ExactDecimal.fromNumber(windowConversions));
      cpa = div.result ? div.result.toNumber() : null;
      displayCpa = div.result ? div.result.toDisplayString(2) : null;
    }

    let roas: number | null = null;
    let displayRoas: string | null = null;
    let roasReason: string | undefined = undefined;
    let finalRevenue: number | null = windowRevenue.toNumber();
    let exactRevenue: string | null = windowRevenue.toDisplayString(2);

    if (!supportsRevenue) {
      finalRevenue = null;
      exactRevenue = null;
      roas = null;
      roasReason = "REVENUE_SEMANTICS_UNSUPPORTED";
    } else if (windowSpend.isZero()) {
      roas = null;
      roasReason = "ZERO_DENOMINATOR";
    } else {
      const div = windowRevenue.divide(windowSpend);
      roas = div.result ? div.result.toNumber() : null;
      displayRoas = div.result ? div.result.toDisplayString(2) : null;
    }

    return {
      window: {
        since: dates[0] ?? "",
        until: dates[dates.length - 1] ?? "",
        daysCount: dates.length,
        dates,
      },
      spend: windowSpend.toNumber(),
      exactSpend: windowSpend.toDisplayString(2),
      conversions: windowConversions,
      revenue: finalRevenue,
      exactRevenue,
      cpa,
      displayCpa,
      cpaReason,
      roas,
      displayRoas,
      roasReason,
      currency: primaryCurrency,
      isComplete: isWindowComplete,
    };
  };

  const currentSummary = aggregateWindow(currentDates, isCurrentComplete);
  const baselineSummary = aggregateWindow(baselineDates, isBaselineComplete);

  // Requirement 1: A missing baseline must block comparison, never become a zero baseline!
  let comparisonBlocked = false;
  let comparisonBlockReason: string | undefined = undefined;

  let spendDelta: number | null = null;
  let spendDeltaRatio: number | null = null;
  let conversionDelta: number | null = null;
  let conversionDeltaRatio: number | null = null;
  let cpaDelta: number | null = null;
  let cpaDeltaRatio: number | null = null;

  if (!isBaselineComplete) {
    comparisonBlocked = true;
    comparisonBlockReason = "BASELINE_WINDOW_INCOMPLETE";
  } else if (!isCurrentComplete) {
    comparisonBlocked = true;
    comparisonBlockReason = "CURRENT_WINDOW_INCOMPLETE";
  } else {
    // Valid comparison
    spendDelta = currentSummary.spend - baselineSummary.spend;
    spendDeltaRatio = baselineSummary.spend > 0 ? spendDelta / baselineSummary.spend : null;

    conversionDelta = currentSummary.conversions - baselineSummary.conversions;
    conversionDeltaRatio =
      baselineSummary.conversions > 0 ? conversionDelta / baselineSummary.conversions : null;

    if (currentSummary.cpa !== null && baselineSummary.cpa !== null) {
      cpaDelta = currentSummary.cpa - baselineSummary.cpa;
      cpaDeltaRatio = baselineSummary.cpa > 0 ? cpaDelta / baselineSummary.cpa : null;
    }
  }

  const metricComparison: MetricComparisonResult = {
    current: currentSummary,
    baseline: baselineSummary,
    comparisonBlocked,
    comparisonBlockReason,
    spendDelta,
    spendDeltaRatio,
    conversionDelta,
    conversionDeltaRatio,
    cpaDelta,
    cpaDeltaRatio,
  };

  // 8. Full Normalized Precision Dataset Fingerprint
  const isSynthetic = executionMode === "local_test";
  const uniqueBlockers = Array.from(new Set(blockers));

  const provenance = {
    responsibilityId: input.responsibilityId,
    scopeRevision: input.roster?.revision ?? 0,
    accountScope: expectedAccounts.map((a) => a.canonicalId),
    currentSince: input.windows.currentWindow.since,
    currentUntil: input.windows.currentWindow.until,
    baselineSince: input.windows.baselineWindow.since,
    baselineUntil: input.windows.baselineWindow.until,
    calculationVersion: 1,
    targetGrain,
    executionMode,
    isSyntheticTest: isSynthetic,
    currencies,
    timezones,
    lagDays: input.windows.lagDays,
    asOfTimestamp: input.windows.asOfTimestamp,
    supportsRevenue,
    supportsCpa,
    valid: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
  };

  const fingerprintContext: DatasetFingerprintContext = {
    workspaceId: input.workspaceId,
    responsibilityId: input.responsibilityId,
    scopeRevision: input.roster?.revision ?? 0,
    rosterRevision: input.roster?.revision ?? 0,
    accountScope: expectedAccounts.map((a) => ({
      canonicalId: a.canonicalId,
      currency: a.currency,
      timezone: a.timezone,
    })),
    currentWindow: input.windows.currentWindow,
    baselineWindow: input.windows.baselineWindow,
    timezone: input.windows.timezone,
    grain: targetGrain,
    metricSemantics: {
      supportsRevenue,
      supportsCpa,
      revenueBasis: input.revenueBasis ?? "order_completed",
    },
    responsibilityConfig: {
      cpaFloor: input.cpaFloor,
      expectedAttributionWindow: input.expectedAttributionWindow,
      expectedConversionAction: input.expectedConversionAction,
      revenueBasis: input.revenueBasis,
    },
    provenance,
    zeroReceipts: (input.zeroActivityReceipts ?? []).map((z) => ({
      canonicalAccountId: z.canonicalAccountId,
      date: z.date,
      receiptId: z.receiptId,
    })),
    calculationVersion: 1,
  };

  const datasetFingerprint = computeDatasetFingerprint(fingerprintContext, input.records);

  const coverageRatio =
    totalExpectedAccountDays > 0 ? totalPresentAccountDays / totalExpectedAccountDays : 1.0;

  const evaluatedInventory: EvaluatedInventory = {
    expectedAccounts: expectedAccounts.map((a) => a.canonicalId),
    currentExpectedDates: currentDates,
    currentPresentDates: Array.from(currentPresentDatesSet).sort(),
    currentMissingDates: Array.from(currentMissingDatesSet).sort(),
    baselineExpectedDates: baselineDates,
    baselinePresentDates: Array.from(baselinePresentDatesSet).sort(),
    baselineMissingDates: Array.from(baselineMissingDatesSet).sort(),
    zeroReceiptDates: Array.from(zeroReceiptDatesSet).sort(),
    accountDayCoverageRatio: coverageRatio,
    totalExpectedAccountDays,
    totalPresentAccountDays,
  };

  const citations = input.records
    .slice(0, 50)
    .map(
      (r) =>
        `${r.platform}/${r.accountId}/${typeof r.date === "string" ? r.date.slice(0, 10) : r.date.toISOString().slice(0, 10)}:${r.spend}:${r.conversions}`,
    );

  const snapshotPayload = {
    workspaceId: input.workspaceId,
    datasetFingerprint,
    grain: targetGrain,
    metrics: metricComparison,
    inventory: evaluatedInventory,
    actualSince: new Date(`${input.windows.currentWindow.since}T00:00:00.000Z`),
    actualUntil: new Date(`${input.windows.currentWindow.until}T23:59:59.999Z`),
    currencies,
    timezones,
    calculationVersion: 1,
    provenance,
    citations,
  };

  return {
    valid: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    reasons,
    datasetFingerprint,
    grain: targetGrain,
    metrics: metricComparison,
    inventory: evaluatedInventory,
    actualSince: input.windows.currentWindow.since,
    actualUntil: input.windows.currentWindow.until,
    currencies,
    timezones,
    calculationVersion: 1,
    provenance,
    citations,
    isSynthetic,
    snapshotPayload,
  };
}

// ---------------------------------------------------------------------------
// 6. Authorized Workspace-Scoped Application Service Boundary
// ---------------------------------------------------------------------------

export interface EvaluateAndPersistEvidenceInput {
  workspaceId: string;
  responsibilityId: string;
  actorUserId: string;
  executionMode: ExecutionMode; // Strictly required! Throws if missing.
  asOf?: Date;
  targetGrain?: RowGrain;
  cpaFloor?: number;
  authorizedPartitionKey?: string;
  revenueBasis?: "order_placed" | "order_completed" | "attributed_ad_gmv";
  lagDays?: number;
  expectedAttributionWindow?: string;
  expectedConversionAction?: string;
  validateProvenance?: boolean;
}


/**
 * Loads persisted responsibility, scope, connections, source health, and metrics from PostgreSQL.
 * Evaluates consistent dataset and persists immutable evidence snapshot in PostgreSQL under transaction.
 */
export async function evaluateAndPersistMonitorEvidence(
  tx: ConsoleTransaction,
  input: EvaluateAndPersistEvidenceInput,
): Promise<{ snapshot: any; evaluationResult: MonitorEvidenceEvaluationResult }> {
  // 1. Enforce Explicit Execution Mode
  if (!input.executionMode || (input.executionMode !== "live_production" && input.executionMode !== "local_test")) {
    throw new AgentConsoleError(
      "invalid_execution_mode",
      "Execution mode must be explicitly provided as 'live_production' or 'local_test'. Implicit defaults are prohibited.",
      400,
    );
  }

  // 2. Enforce Workspace Authorization
  await requireWorkspaceRole(tx, input.workspaceId, input.actorUserId, ["owner", "admin", "member"]);

  // 3. Load Responsibility
  const resp = await tx.agentResponsibility.findFirst({
    where: { id: input.responsibilityId, workspaceId: input.workspaceId },
  });
  if (!resp) {
    throw new AgentConsoleError("responsibility_not_found", "Responsibility not found in workspace", 404);
  }
  if (resp.status !== "active") {
    throw new AgentConsoleError(
      "responsibility_not_active",
      `Responsibility is in '${resp.status}' status; cannot evaluate active monitor evidence`,
      400,
    );
  }

  // 4. Load Active Policy Authorization for Scope Confirmation Metadata
  const activeAuth = await tx.agentAuthorization.findFirst({
    where: {
      workspaceId: input.workspaceId,
      responsibilityId: input.responsibilityId,
      policyRevision: resp.policyRevision,
      revokedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  // 5. Load Responsibility Scopes
  const scopeRows = await tx.agentResponsibilityScope.findMany({
    where: {
      workspaceId: input.workspaceId,
      responsibilityId: input.responsibilityId,
      scopeRevision: resp.scopeRevision,
    },
  });

  if (scopeRows.length === 0) {
    throw new AgentConsoleError("scope_empty", "Responsibility has no confirmed scope roster", 400);
  }

  // 6. Construct Expected Account Roster (No guessing USD or America/New_York)
  const accounts = scopeRows.map((s) => ({
    canonicalId: buildCanonicalAccountId(s.provider, s.connectionId, s.providerAccountId),
    connectionId: s.connectionId,
    providerAccountId: s.providerAccountId,
    provider: s.provider,
    accountName: s.accountName || s.providerAccountId,
    currency: s.currency || "", // Never substitute USD
    timezone: s.timezone || resp.timezone || "", // Never substitute America/New_York
    status: "active" as const,
  }));

  const primaryCurrency = accounts.find((a) => Boolean(a.currency))?.currency || "";
  const primaryTimezone = resp.timezone || accounts.find((a) => Boolean(a.timezone))?.timezone || "";

  const roster: ExpectedAccountRoster = {
    workspaceId: input.workspaceId,
    responsibilityId: input.responsibilityId,
    revision: resp.scopeRevision,
    confirmedAt: activeAuth ? activeAuth.createdAt.toISOString() : "",
    confirmedByUserId: activeAuth ? activeAuth.authorizingUserId : "",
    primaryCurrency,
    primaryTimezone,
    accounts,
  };

  // 7. Load Connections & Authoritative Source Health
  const connectionIds = Array.from(new Set(scopeRows.map((s) => s.connectionId)));
  const connections = await tx.connection.findMany({
    where: {
      workspaceId: input.workspaceId,
      id: { in: connectionIds },
    },
  });

  if (connections.length !== connectionIds.length) {
    throw new AgentConsoleError(
      "connection_missing",
      "One or more connections in confirmed scope were not found in workspace",
      400,
    );
  }

  const sourceHealthList: SourceHealthEvidence[] = connections.map((c) => ({
    connectionId: c.id,
    provider: c.provider,
    status: c.status,
    lastError: c.lastError,
    lastSyncAt: c.lastSyncAt,
    lastDataThrough: c.lastDataThrough,
  }));

  // 8. Derive Required Lag from Scoped Provider Registry & Calculate Windows
  const providerLagDays = Math.max(
    1,
    ...accounts.map((a) => {
      const cap = PROVIDER_CAPABILITY_REGISTRY[a.provider];
      return cap?.dataAvailabilityLagDays ?? 1;
    })
  );
  const effectiveLagDays = Math.max(input.lagDays ?? 1, providerLagDays);

  const asOf = input.asOf ?? new Date();
  const targetTimezone = roster.primaryTimezone || "UTC";
  const windows = getEligibleComparisonWindows(asOf, targetTimezone, {
    lagDays: effectiveLagDays,
    windowDays: 7,
  });

  // 9. Query CampaignMetric strictly constrained to exact authorized tuples and selected grain
  const targetGrain: RowGrain = input.targetGrain ?? "campaign";
  const dbRows = await tx.campaignMetric.findMany({
    where: {
      workspaceId: input.workspaceId,
      OR: accounts.map((a) => ({
        connectionId: a.connectionId,
        accountId: a.providerAccountId,
        platform: a.provider,
      })),
      level: targetGrain,
      date: {
        gte: new Date(`${windows.baselineWindow.since}T00:00:00.000Z`),
        lte: new Date(`${windows.currentWindow.until}T23:59:59.999Z`),
      },
    },
  });

  const records: MetricInputRecord[] = dbRows.map((r) => ({
    id: r.id,
    date: r.date.toISOString().slice(0, 10),
    platform: r.platform,
    connectionId: r.connectionId,
    accountId: r.accountId,
    level: r.level,
    entityId: r.entityId,
    breakdownHash: r.breakdownHash,
    spend: r.spend,
    conversions: r.conversions,
    revenue: r.revenue,
    currency: r.currency,
    rawData: r.rawData,
  }));

  const respConfig = (resp.configuration && typeof resp.configuration === "object")
    ? (resp.configuration as Record<string, unknown>)
    : {};

  // Validate denominator floor independently from monetary CPA target
  if (respConfig.cpaFloor !== undefined && respConfig.cpaFloor !== null) {
    const validated = validateCpaFloor(respConfig.cpaFloor);
    if (!validated.valid) {
      throw new AgentConsoleError(
        "invalid_configuration",
        validated.error!,
        400,
      );
    }
  }
  if (input.cpaFloor !== undefined && input.cpaFloor !== null) {
    const validated = validateCpaFloor(input.cpaFloor);
    if (!validated.valid) {
      throw new AgentConsoleError(
        "invalid_configuration",
        validated.error!,
        400,
      );
    }
  }

  const derivedCpaFloor = typeof respConfig.cpaFloor === "number"
    ? respConfig.cpaFloor
    : input.cpaFloor;

  // Expected definitions express customer configuration, not defaulted strings
  const derivedAttributionWindow = typeof respConfig.expectedAttributionWindow === "string"
    ? respConfig.expectedAttributionWindow
    : (typeof respConfig.attributionWindow === "string" ? respConfig.attributionWindow : input.expectedAttributionWindow);

  const derivedConversionAction = typeof respConfig.expectedConversionAction === "string"
    ? respConfig.expectedConversionAction
    : (typeof respConfig.conversionAction === "string" ? respConfig.conversionAction : input.expectedConversionAction);

  const derivedRevenueBasis: "order_placed" | "order_completed" | "attributed_ad_gmv" | undefined = (
    typeof respConfig.revenueBasis === "string" &&
    ["order_placed", "order_completed", "attributed_ad_gmv"].includes(respConfig.revenueBasis)
  )
    ? (respConfig.revenueBasis as "order_placed" | "order_completed" | "attributed_ad_gmv")
    : input.revenueBasis;

  // 10. Evaluate Evidence with Semantics & Provenance Enforcement (Mandatory at application boundary)
  const evalResult = evaluateMonitorEvidence({
    workspaceId: input.workspaceId,
    clientId: resp.clientId,
    responsibilityId: input.responsibilityId,
    roster,
    queriedIdentifiers: accounts.map((a) => a.canonicalId),
    executionMode: input.executionMode,
    targetGrain,
    records,
    windows,
    sourceHealthList,
    cpaFloor: derivedCpaFloor,
    revenueBasis: derivedRevenueBasis,
    validateProvenance: true, // Mandatory at application boundary, bypass prohibited
    expectedAttributionWindow: derivedAttributionWindow,
    expectedConversionAction: derivedConversionAction,
  });

  // 10. Persist Immutable Evidence Snapshot in PostgreSQL
  const snapshot = await tx.agentEvidenceSnapshot.create({
    data: {
      workspaceId: input.workspaceId,
      datasetFingerprint: evalResult.datasetFingerprint,
      grain: evalResult.grain,
      metrics: evalResult.metrics as unknown as Prisma.InputJsonValue,
      inventory: evalResult.inventory as unknown as Prisma.InputJsonValue,
      actualSince: new Date(`${evalResult.actualSince}T00:00:00.000Z`),
      actualUntil: new Date(`${evalResult.actualUntil}T23:59:59.999Z`),
      currencies: evalResult.currencies,
      timezones: evalResult.timezones,
      calculationVersion: evalResult.calculationVersion,
      provenance: evalResult.provenance as unknown as Prisma.InputJsonValue,
      citations: evalResult.citations as unknown as Prisma.InputJsonValue,
    },
  });

  // 11. Transactionally Record Audit Event
  await appendConsoleEvent(tx, {
    workspaceId: input.workspaceId,
    responsibilityId: input.responsibilityId,
    actorType: "user",
    actorUserId: input.actorUserId,
    type: "evidence_snapshot_recorded",
    payload: {
      snapshotId: snapshot.id,
      fingerprint: evalResult.datasetFingerprint,
      valid: evalResult.valid,
      blockers: evalResult.blockers,
      isSynthetic: evalResult.isSynthetic,
    },
  });

  return { snapshot, evaluationResult: evalResult };
}

// ---------------------------------------------------------------------------
// 7. Monitor Eligibility Projection
// ---------------------------------------------------------------------------

export interface MonitorEligibilityResult {
  eligible: boolean;
  status: "eligible" | "delayed" | "blocked";
  blockers: QualityGateCode[];
  reasons: string[];
  freshnessStatus: "fresh" | "stale" | "syncing" | "error";
  coverageComplete: boolean;
}

/**
 * Projects monitor eligibility without conflating monitor data checks with downstream delivery receipts.
 */
export function projectMonitorEligibility(
  evaluation: MonitorEvidenceEvaluationResult,
  options: {
    lastDataThrough?: string | null;
    isSchedulerDelayed?: boolean;
    sourceErrorCount?: number;
  } = {},
): MonitorEligibilityResult {
  const blockers: QualityGateCode[] = [...evaluation.blockers];
  const reasons: string[] = [...evaluation.reasons];

  if (options.isSchedulerDelayed) {
    blockers.push("SCHEDULER_DELAYED");
    reasons.push("Scheduler tick delayed past the 60-minute SLO threshold");
  }

  if ((options.sourceErrorCount ?? 0) > 0) {
    blockers.push("DATA_STALE");
    reasons.push(`${options.sourceErrorCount} source(s) report error state`);
  }

  const coverageComplete =
    evaluation.inventory.currentMissingDates.length === 0 &&
    evaluation.inventory.baselineMissingDates.length === 0;

  let status: "eligible" | "delayed" | "blocked" = "eligible";
  if (blockers.includes("SCHEDULER_DELAYED")) {
    status = "delayed";
  }
  if (blockers.some((b) => b !== "SCHEDULER_DELAYED")) {
    status = "blocked";
  }

  return {
    eligible: status === "eligible",
    status,
    blockers: Array.from(new Set(blockers)),
    reasons,
    freshnessStatus: blockers.includes("DATA_STALE") ? "stale" : "fresh",
    coverageComplete,
  };
}
