/**
 * Shared Warehouse execution boundary for provider-aware backfill.
 *
 * Single canonical policy used by:
 * - POST /api/data-explorer/warehouse/import-batch (generic multi-item execution)
 * - POST /api/data-explorer/warehouse/import (single-item execution)
 * - OAuth automatic Warehouse enqueueing (initial/catchup)
 *
 * Rules:
 * - Capability is checked before any date arithmetic.
 * - Raw requested ranges are evaluated before any plan/product clamp.
 * - Meta/Google generic execution over 30 inclusive days fails closed.
 * - Unavailable ingestion (including zero-day automatic windows) skips
 *   automatic enqueueing without failing OAuth.
 * - Extended 24-month planning remains planning-only; no route enables it.
 */

import {
  getHistoricalIngestionCapability,
  type HistoricalIngestionProvider,
} from "./historical-ingestion-capabilities";
import { HistoricalBackfillPlanningError } from "./historical-backfill-plan";
import { getCanonicalDateRange } from "./warehouse-date-range";

/** Generic single-request ceiling for Meta/Google Warehouse execution. */
export const WAREHOUSE_GENERIC_EXECUTION_MAX_DAYS = 30;

/** Structured skip reason recorded when automatic ingestion is unavailable. */
export const WAREHOUSE_AUTOMATIC_SKIP_REASON = "historical_ingestion_unavailable" as const;

/** Stable error code for oversized generic execution. */
export const WAREHOUSE_CHUNKING_NOT_IMPLEMENTED_CODE = "REQUEST_CHUNKING_NOT_IMPLEMENTED" as const;

/**
 * Canonical set of providers whose generic Warehouse execution is bounded to
 * a single 30-day request. OAuth may queue its approved 90-day window as
 * three newest-first 30-day slices; every other generic request must fail
 * closed until a resumable chunk dispatcher exists.
 *
 * Centralized here so routes never duplicate provider lists or scattered
 * string comparisons.
 */
const CHUNK_GUARDED_WAREHOUSE_PROVIDERS: ReadonlySet<HistoricalIngestionProvider> = new Set([
  "meta_ads",
  "google_ads",
]);

export function isChunkGuardedWarehouseProvider(provider: string): boolean {
  return (CHUNK_GUARDED_WAREHOUSE_PROVIDERS as ReadonlySet<string>).has(provider);
}

/**
 * Whether automatic Warehouse enqueueing is allowed for a provider.
 * Checked before any date arithmetic. Fails closed for unknown providers,
 * unavailable ingestion, and zero/non-positive automatic windows.
 */
export function isAutomaticWarehouseIngestionAvailable(provider?: string | null): boolean {
  if (!provider) return false;
  const capability = getHistoricalIngestionCapability(provider);
  if (!capability) return false;
  if (capability.warehouseIngestion !== "implemented") return false;
  if (capability.historicalBackfill === "unavailable") return false;
  if (capability.readiness === "unavailable") return false;
  const automaticDays = capability.defaultAutomaticBackfill?.days;
  if (!Number.isSafeInteger(automaticDays) || (automaticDays as number) <= 0) return false;
  const requestSpan = capability.maximumRequestSpan?.days;
  if (!Number.isSafeInteger(requestSpan) || (requestSpan as number) <= 0) return false;
  return true;
}

export interface WarehouseExecutionRange {
  readonly since: string;
  readonly until: string;
  readonly days: number;
}

export interface OversizedExecutionDetails {
  readonly code: typeof WAREHOUSE_CHUNKING_NOT_IMPLEMENTED_CODE;
  readonly provider: string;
  readonly requestedRange: WarehouseExecutionRange;
  readonly maxExecutableDays: number;
}

/**
 * Validates an executable raw Warehouse range using inclusive calendar-day
 * semantics. Operates on the original requested range before any plan or
 * subscription clamp can shorten it.
 *
 * Throws HistoricalBackfillPlanningError with codes:
 * - INVALID_DATE_RANGE for malformed or reversed dates
 * - UNSUPPORTED_CONNECTOR when no canonical capability exists
 * - WAREHOUSE_INGESTION_UNAVAILABLE when ingestion is unavailable
 * - REQUEST_CHUNKING_NOT_IMPLEMENTED for oversized Meta/Google execution
 */
export class WarehouseOversizedExecutionError extends HistoricalBackfillPlanningError {
  readonly provider: string;
  readonly requestedRange: WarehouseExecutionRange;
  readonly maxExecutableDays: number;

  constructor(provider: string, requestedRange: WarehouseExecutionRange, maxExecutableDays: number) {
    super(
      WAREHOUSE_CHUNKING_NOT_IMPLEMENTED_CODE,
      `${provider} range ${requestedRange.since}..${requestedRange.until} spans ${requestedRange.days} days, exceeding the maximum executable span of ${maxExecutableDays} days. Extended checkpointed backfill is not yet enabled; general Warehouse execution is not enabled for multi-chunk ranges.`,
    );
    this.name = "WarehouseOversizedExecutionError";
    this.provider = provider;
    this.requestedRange = requestedRange;
    this.maxExecutableDays = maxExecutableDays;
  }
}

export function assertExecutableWarehouseRange(opts: {
  provider: string;
  since: string;
  until: string;
}): WarehouseExecutionRange {
  let canonical: ReturnType<typeof getCanonicalDateRange>;
  try {
    canonical = getCanonicalDateRange(opts.since, opts.until);
  } catch (error) {
    throw new HistoricalBackfillPlanningError(
      "INVALID_DATE_RANGE",
      error instanceof Error ? error.message : "Inputs must be strict YYYY-MM-DD calendar dates.",
    );
  }

  const capability = getHistoricalIngestionCapability(opts.provider);
  if (!capability) {
    throw new HistoricalBackfillPlanningError(
      "UNSUPPORTED_CONNECTOR",
      "No canonical historical ingestion capability exists for this provider.",
    );
  }
  if (capability.warehouseIngestion === "unavailable") {
    throw new HistoricalBackfillPlanningError(
      "WAREHOUSE_INGESTION_UNAVAILABLE",
      `${capability.provider} has no Warehouse ingestion worker.`,
    );
  }

  const days =
    Math.round((canonical.endUtc.getTime() - canonical.startUtc.getTime()) / 86_400_000) + 1;
  const range: WarehouseExecutionRange = { since: canonical.since, until: canonical.until, days };

  if (isChunkGuardedWarehouseProvider(capability.provider) && days > WAREHOUSE_GENERIC_EXECUTION_MAX_DAYS) {
    throw new WarehouseOversizedExecutionError(capability.provider, range, WAREHOUSE_GENERIC_EXECUTION_MAX_DAYS);
  }

  return range;
}

/** Builds the stable structured oversized-execution payload for route responses. */
export function toOversizedExecutionResponse(
  provider: string,
  range: WarehouseExecutionRange,
  maxExecutableDays: number = WAREHOUSE_GENERIC_EXECUTION_MAX_DAYS,
): {
  error: string;
  code: typeof WAREHOUSE_CHUNKING_NOT_IMPLEMENTED_CODE;
  provider: string;
  requestedRange: WarehouseExecutionRange;
  maxExecutableDays: number;
  hint: string;
} {
  return {
    error:
      `${provider} ranges over ${maxExecutableDays} days require the OAuth chunk dispatcher; general Warehouse execution is not enabled.`,
    code: WAREHOUSE_CHUNKING_NOT_IMPLEMENTED_CODE,
    provider,
    requestedRange: range,
    maxExecutableDays,
    hint: "Extended checkpointed backfill is not yet enabled. Request at most 30 inclusive days.",
  };
}

/** Extracts structured oversized-execution details from a thrown guard error. */
export function getOversizedExecutionDetails(error: unknown): OversizedExecutionDetails | null {
  if (error instanceof WarehouseOversizedExecutionError) {
    return {
      code: WAREHOUSE_CHUNKING_NOT_IMPLEMENTED_CODE,
      provider: error.provider,
      requestedRange: error.requestedRange,
      maxExecutableDays: error.maxExecutableDays,
    };
  }
  return null;
}
