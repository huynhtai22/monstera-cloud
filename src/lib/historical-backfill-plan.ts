import { createHash } from "node:crypto";
import { getCanonicalDateRange } from "./warehouse-date-range";
import {
  getHistoricalIngestionCapability,
  type HistoricalIngestionProvider,
  type LimitClassification,
} from "./historical-ingestion-capabilities";

export interface CalendarRange {
  readonly since: string;
  readonly until: string;
  readonly days: number;
}

export interface HistoricalBackfillChunk extends CalendarRange {
  readonly id: string;
  readonly ordinal: number;
}

export interface HistoricalBackfillClampReason {
  readonly kind: LimitClassification;
  readonly limitDays?: number;
  readonly limitMonths?: number;
  readonly message: string;
}

export interface HistoricalBackfillPlan {
  readonly provider: HistoricalIngestionProvider;
  readonly capabilityStatus: "production-ready" | "limited" | "unavailable";
  readonly requestedRange: CalendarRange;
  readonly planPermittedRange: CalendarRange;
  readonly effectiveRange: CalendarRange;
  readonly clamped: boolean;
  readonly clampReasons: readonly HistoricalBackfillClampReason[];
  readonly chunks: readonly HistoricalBackfillChunk[];
  readonly chunkCount: number;
  /** Planning is intentionally separate from authorization to execute it. */
  readonly executionAllowed: boolean;
  readonly executionBlockers: readonly string[];
}

export class HistoricalBackfillPlanningError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "HistoricalBackfillPlanningError";
  }
}

export interface PlanHistoricalBackfillOptions {
  readonly provider: string;
  readonly since: string;
  readonly until: string;
  /** Explicit reference date makes provider lookback evaluation deterministic. */
  readonly asOf: string;
  /** An already-authorized product/plan range, distinct from a provider allowance. */
  readonly planMaximumDays?: number;
  /** `execute` is a guard for a future worker; this function never executes. */
  readonly execution?: "plan" | "execute";
}

const DAY_MS = 86_400_000;

function rangeFromInclusiveDates(since: string, until: string): CalendarRange {
  const canonical = getCanonicalDateRange(since, until);
  return {
    since: canonical.since,
    until: canonical.until,
    days: Math.round((canonical.endUtc.getTime() - canonical.startUtc.getTime()) / DAY_MS) + 1,
  };
}

function addUtcDays(dateOnly: string, days: number): string {
  const range = getCanonicalDateRange(dateOnly, dateOnly);
  return new Date(range.startUtc.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function subtractUtcCalendarMonths(dateOnly: string, months: number): string {
  const { startUtc } = getCanonicalDateRange(dateOnly, dateOnly);
  const year = startUtc.getUTCFullYear();
  const monthIndex = startUtc.getUTCMonth() - months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const targetLastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(startUtc.getUTCDate(), targetLastDay);
  return new Date(Date.UTC(targetYear, targetMonth, targetDay)).toISOString().slice(0, 10);
}

function trimToMostRecentDays(range: CalendarRange, days: number): CalendarRange {
  if (!Number.isSafeInteger(days) || days < 1) {
    throw new HistoricalBackfillPlanningError("INVALID_PLAN_LIMIT", "planMaximumDays must be a positive integer.");
  }
  if (range.days <= days) return range;
  return rangeFromInclusiveDates(addUtcDays(range.until, -(days - 1)), range.until);
}

function makeChunkId(provider: HistoricalIngestionProvider, since: string, until: string): string {
  const digest = createHash("sha256").update(`${provider}\u0000${since}\u0000${until}`).digest("hex");
  return `${provider}:${digest.slice(0, 24)}`;
}

function chunkNewestFirst(
  provider: HistoricalIngestionProvider,
  range: CalendarRange,
  maximumRequestDays: number,
): readonly HistoricalBackfillChunk[] {
  if (!Number.isSafeInteger(maximumRequestDays) || maximumRequestDays < 1) {
    throw new HistoricalBackfillPlanningError("INVALID_CAPABILITY_LIMIT", "Provider request span must be a positive integer.");
  }
  const chunks: HistoricalBackfillChunk[] = [];
  let latest = range.until;
  let ordinal = 0;
  while (latest >= range.since) {
    const earliestCandidate = addUtcDays(latest, -(maximumRequestDays - 1));
    const since = earliestCandidate < range.since ? range.since : earliestCandidate;
    const chunkRange = rangeFromInclusiveDates(since, latest);
    chunks.push({ ...chunkRange, ordinal, id: makeChunkId(provider, chunkRange.since, chunkRange.until) });
    latest = addUtcDays(since, -1);
    ordinal += 1;
  }
  return Object.freeze(chunks);
}

function executionBlockers(options: {
  readonly range: CalendarRange;
  readonly defaultAutomaticDays: number;
  readonly verification: "verified" | "unverified" | "not_applicable";
  readonly readiness: "production-ready" | "limited" | "unavailable";
}): readonly string[] {
  const blockers: string[] = [];
  if (options.range.days > options.defaultAutomaticDays) {
    if (options.verification !== "verified") blockers.push("provider_capability_unverified");
    if (options.readiness !== "production-ready") blockers.push("async_chunked_execution_not_implemented");
  }
  return Object.freeze(blockers);
}

/**
 * Creates a deterministic, inclusive, UTC-safe plan. It does not perform I/O,
 * mutate input, normalize accounts, or dispatch imports. Any clamp is explicit
 * in the returned plan; callers must decide whether a displayed clamp is
 * acceptable before they request execution.
 */
export function planHistoricalBackfill(options: PlanHistoricalBackfillOptions): HistoricalBackfillPlan {
  const capability = getHistoricalIngestionCapability(options.provider);
  if (!capability) {
    throw new HistoricalBackfillPlanningError("UNSUPPORTED_CONNECTOR", "No canonical historical ingestion capability exists for this provider.");
  }
  if (capability.warehouseIngestion === "unavailable") {
    throw new HistoricalBackfillPlanningError("WAREHOUSE_INGESTION_UNAVAILABLE", `${capability.provider} has no Warehouse ingestion worker.`);
  }

  let requestedRange: CalendarRange;
  let asOf: CalendarRange;
  try {
    requestedRange = rangeFromInclusiveDates(options.since, options.until);
    asOf = rangeFromInclusiveDates(options.asOf, options.asOf);
  } catch (error) {
    throw new HistoricalBackfillPlanningError(
      "INVALID_DATE_RANGE",
      error instanceof Error ? error.message : "Inputs must be strict YYYY-MM-DD calendar dates.",
    );
  }

  const reasons: HistoricalBackfillClampReason[] = [];
  const productMaximumDays = options.planMaximumDays ?? capability.maximumCustomerSelectableRange?.days;
  let planPermittedRange = requestedRange;
  if (productMaximumDays !== undefined && requestedRange.days > productMaximumDays) {
    planPermittedRange = trimToMostRecentDays(requestedRange, productMaximumDays);
    reasons.push({
      kind: options.planMaximumDays === undefined ? "product_plan" : "product_plan",
      limitDays: productMaximumDays,
      message: `Requested range exceeds the explicit product/plan limit of ${productMaximumDays} days.`,
    });
  }

  let effectiveRange = planPermittedRange;
  const lookback = capability.providerLookbackCeiling;
  if (lookback) {
    const earliestAllowed = subtractUtcCalendarMonths(asOf.since, lookback.months);
    if (effectiveRange.since < earliestAllowed) {
      if (effectiveRange.until < earliestAllowed) {
        throw new HistoricalBackfillPlanningError(
          "PROVIDER_LOOKBACK_EXCEEDED",
          `Requested range ends before the provider's ${lookback.months}-month daily-grain lookback ceiling.`,
        );
      }
      const since = earliestAllowed;
      effectiveRange = rangeFromInclusiveDates(since, effectiveRange.until);
      reasons.push({
        kind: lookback.classification,
        limitMonths: lookback.months,
        message: `Requested range begins before the provider's ${lookback.months}-month daily-grain lookback ceiling.`,
      });
    }
  }

  const blockers = executionBlockers({
    range: effectiveRange,
    defaultAutomaticDays: capability.defaultAutomaticBackfill.days,
    verification: capability.extendedExecutionVerification,
    readiness: capability.readiness,
  });
  if (options.execution === "execute" && blockers.length > 0) {
    throw new HistoricalBackfillPlanningError(
      "EXTENDED_EXECUTION_NOT_ALLOWED",
      `Execution is blocked: ${blockers.join(", ")}.`,
    );
  }

  const chunks = chunkNewestFirst(capability.provider, effectiveRange, capability.maximumRequestSpan.days);
  return Object.freeze({
    provider: capability.provider,
    capabilityStatus: capability.readiness,
    requestedRange,
    planPermittedRange,
    effectiveRange,
    clamped: reasons.length > 0,
    clampReasons: Object.freeze(reasons),
    chunks,
    chunkCount: chunks.length,
    executionAllowed: blockers.length === 0,
    executionBlockers: blockers,
  });
}
