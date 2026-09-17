/**
 * Extended-backfill staging qualification: capacity scenarios, acceptance
 * gates, and infrastructure-fact bookkeeping.
 *
 * This module never activates execution. It models storage/query/worker
 * requirements from measured local constants, evaluates proposed acceptance
 * gates, and reports what is UNKNOWN until the owner supplies sanitized
 * production facts (see docs/EXTENDED_BACKFILL_STAGING_QUALIFICATION.md).
 * Unknown critical capacity fails closed: no gate passes on unknown inputs.
 */

export type FactConfidence = "measured-local" | "repo-config" | "official-docs" | "unknown";

export interface InfrastructureFact {
  readonly dimension: string;
  /** Sanitized value only; secrets must never appear here. */
  readonly knownValue: string | null;
  readonly source: string;
  readonly confidence: FactConfidence;
  readonly missingOwnerInput: string | null;
}

/**
 * Provisioned-vs-projected storage gate. Projected post-backfill storage
 * must remain below 60% of provisioned storage, leaving ~40% for growth,
 * WAL, vacuum, index maintenance, temporary operations, and recovery.
 * Unknown provisioned or current usage fails closed (unknown, never pass).
 */
export interface StorageGateInputs {
  readonly estimatedNewBytes: number | null;
  readonly provisionedBytes: number | null;
  readonly usedBytes: number | null;
  readonly headroomFraction?: number;
}

export interface StorageGateResult {
  readonly status: "pass" | "fail" | "unknown";
  readonly projectedBytes: number | null;
  readonly projectedFraction: number | null;
  readonly headroomFraction: number;
  readonly reason: string;
}

export function evaluateStorageGate(inputs: StorageGateInputs): StorageGateResult {
  const headroomFraction = inputs.headroomFraction ?? 0.6;
  if (
    inputs.estimatedNewBytes === null ||
    inputs.provisionedBytes === null ||
    inputs.usedBytes === null ||
    !Number.isFinite(inputs.estimatedNewBytes) ||
    !Number.isFinite(inputs.provisionedBytes) ||
    !Number.isFinite(inputs.usedBytes) ||
    inputs.provisionedBytes <= 0
  ) {
    return {
      status: "unknown",
      projectedBytes: null,
      projectedFraction: null,
      headroomFraction,
      reason: "Provisioned storage, current usage, or the estimate is unknown; cannot accept capacity.",
    };
  }
  const projectedBytes = inputs.usedBytes + Math.max(0, inputs.estimatedNewBytes);
  const projectedFraction = projectedBytes / inputs.provisionedBytes;
  if (projectedFraction < headroomFraction) {
    return {
      status: "pass",
      projectedBytes,
      projectedFraction,
      headroomFraction,
      reason: `Projected ${(projectedFraction * 100).toFixed(1)}% of provisioned storage is below the ${(headroomFraction * 100).toFixed(0)}% ceiling.`,
    };
  }
  return {
    status: "fail",
    projectedBytes,
    projectedFraction,
    headroomFraction,
    reason: `Projected ${(projectedFraction * 100).toFixed(1)}% of provisioned storage meets or exceeds the ${(headroomFraction * 100).toFixed(0)}% ceiling.`,
  };
}

export interface ServingMeasurement {
  readonly query: string;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly rowCount: number | null;
  readonly sequentialScan: boolean;
  readonly bounded: boolean;
  /**
   * Explicit opt-out for shapes where a full scan is the expected plan
   * (e.g. a full-range few-group aggregate must visit every row; no B-tree
   * avoids that without a precomputed rollup). Requires a written
   * justification and never applies silently.
   */
  readonly allowFullScan?: boolean;
  readonly fullScanJustification?: string;
}

export interface ServingGateResult {
  readonly query: string;
  readonly status: "pass" | "fail" | "unknown";
  readonly reason: string;
}

/** Proposed interactive gates (require owner acceptance; not pre-existing SLAs). */
export const PROPOSED_INTERACTIVE_P95_MS = 1500;
export const PROPOSED_PROGRESS_P95_MS = 500;

/** Evaluates one serving measurement against the proposed gates. */
export function evaluateServingGate(
  measurement: ServingMeasurement,
  targets: { interactiveP95Ms?: number; progressP95Ms?: number } = {},
): ServingGateResult {
  const interactiveTarget = targets.interactiveP95Ms ?? PROPOSED_INTERACTIVE_P95_MS;
  const progressTarget = targets.progressP95Ms ?? PROPOSED_PROGRESS_P95_MS;
  if (measurement.p95Ms === null || measurement.rowCount === null) {
    return { query: measurement.query, status: "unknown", reason: "No measurement available." };
  }
  if (!measurement.bounded) {
    return { query: measurement.query, status: "fail", reason: "Response is not bounded; unbounded multi-million-row serialization is not permitted." };
  }
  if (measurement.sequentialScan) {
    if (measurement.allowFullScan === true && (measurement.fullScanJustification ?? "").trim().length > 0) {
      // Latency target still applies below.
    } else {
      return { query: measurement.query, status: "fail", reason: "Unexpected full-table sequential scan at representative scale." };
    }
  }
  const target = measurement.query === "job-progress-polling" ? progressTarget : interactiveTarget;
  if (measurement.p95Ms <= target) {
    return { query: measurement.query, status: "pass", reason: `p95 ${measurement.p95Ms}ms within ${target}ms.` };
  }
  return { query: measurement.query, status: "fail", reason: `p95 ${measurement.p95Ms}ms exceeds ${target}ms.` };
}

export interface CapacityScenarioInputs {
  readonly workspaces: number;
  readonly connectionsPerWorkspace: number;
  readonly entitiesPerConnectionPerDay: number;
  readonly days: number;
  /** Measured local row size including representative index overhead share. */
  readonly bytesPerRow: number;
  /** Provider calls per connection per day for the extended window (rolling refetch). */
  readonly providerCallsPerConnectionPerDay?: number;
  /** Chunks per connection for the window (731d / 30d slices). */
  readonly chunksPerConnection?: number;
}

export interface CapacityScenarioResult {
  readonly totalRows: number;
  readonly dailyRowGrowth: number;
  readonly monthlyRowGrowth: number;
  readonly tableBytes: number;
  readonly indexBytes: number;
  readonly totalBytes: number;
  readonly withHeadroomBytes: number;
  readonly expectedConcurrentJobs: number;
  readonly expectedProviderCalls: number;
  readonly estimatedJobDurationRange: { minMinutes: number; maxMinutes: number };
  readonly assumptions: string[];
}

/**
 * Measured CampaignMetric heap-tuple width (avg pg_column_size) on disposable
 * PostgreSQL 16 with synthetic narrow rows, 2026-09-17. Production rows carry
 * longer identifiers/names and run wider; scenario planning below keeps an
 * explicit bytesPerRow input so callers choose conservative values instead.
 */
export const MEASURED_CAMPAIGN_METRIC_ROW_BYTES = 272;

/**
 * Measured index/heap size ratio on the same dataset (many CampaignMetric
 * indexes: workspace/platform/date, connection/date, account/date, plus the
 * idempotency unique key). Narrow synthetic rows inflate the fraction;
 * production rows are heap-heavier. Conservative for capacity math.
 */
export const MEASURED_INDEX_OVERHEAD_FRACTION = 0.95;

function requirePositiveInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Capacity scenario ${name} must be a positive integer.`);
  }
}

/**
 * Deterministic capacity model. All outputs are labeled estimates: row
 * counts are exact arithmetic, storage extrapolates a measured local
 * constant, and durations assume a wide observed band (never a production
 * promise). Throws on invalid inputs rather than guessing.
 */
export function modelCapacityScenario(inputs: CapacityScenarioInputs): CapacityScenarioResult {
  requirePositiveInt(inputs.workspaces, "workspaces");
  requirePositiveInt(inputs.connectionsPerWorkspace, "connectionsPerWorkspace");
  requirePositiveInt(inputs.entitiesPerConnectionPerDay, "entitiesPerConnectionPerDay");
  requirePositiveInt(inputs.days, "days");
  if (!Number.isFinite(inputs.bytesPerRow) || inputs.bytesPerRow <= 0) {
    throw new Error("Capacity scenario bytesPerRow must be a measured positive number.");
  }
  const totalRows =
    inputs.workspaces * inputs.connectionsPerWorkspace * inputs.entitiesPerConnectionPerDay * inputs.days;
  const dailyRowGrowth =
    inputs.workspaces * inputs.connectionsPerWorkspace * inputs.entitiesPerConnectionPerDay;
  const monthlyRowGrowth = dailyRowGrowth * 30;
  const tableBytes = totalRows * inputs.bytesPerRow;
  const indexBytes = Math.round(tableBytes * MEASURED_INDEX_OVERHEAD_FRACTION);
  const totalBytes = tableBytes + indexBytes;
  const withHeadroomBytes = Math.round(totalBytes / 0.6);
  const chunksPerConnection = inputs.chunksPerConnection ?? Math.ceil(inputs.days / 30);
  const expectedProviderCalls =
    inputs.workspaces * inputs.connectionsPerWorkspace * chunksPerConnection;
  const expectedConcurrentJobs = Math.min(inputs.workspaces, 25);
  // Observed local band: ~2-8s per 30-day slice end-to-end in synthetic
  // qualification (instant executors excluded); production provider latency
  // is strictly larger and unmeasured here.
  const minutesPerChunkMin = 2 / 60;
  const minutesPerChunkMax = 8 / 60;
  return {
    totalRows,
    dailyRowGrowth,
    monthlyRowGrowth,
    tableBytes,
    indexBytes,
    totalBytes,
    withHeadroomBytes,
    expectedConcurrentJobs,
    expectedProviderCalls,
    estimatedJobDurationRange: {
      minMinutes: Math.round(chunksPerConnection * minutesPerChunkMin * 10) / 10,
      maxMinutes: Math.round(chunksPerConnection * minutesPerChunkMax * 10) / 10,
    },
    assumptions: [
      `Row counts are exact arithmetic over ${inputs.workspaces} workspaces x ${inputs.connectionsPerWorkspace} connections x ${inputs.entitiesPerConnectionPerDay} entities x ${inputs.days} days.`,
      `Storage extrapolates a measured local ${inputs.bytesPerRow} bytes/row plus ${(MEASURED_INDEX_OVERHEAD_FRACTION * 100).toFixed(0)}% index overhead; production row widths differ.`,
      `Durations assume a local synthetic band per 30-day slice; live provider latency is unmeasured and strictly larger.`,
      `withHeadroomBytes inverts the 60% ceiling (total / 0.6) to size the provision, not to predict usage.`,
    ],
  };
}

export const CAPACITY_SCENARIOS = {
  pilot: { workspaces: 5, connectionsPerWorkspace: 3, entitiesPerConnectionPerDay: 20, days: 731 },
  growth: { workspaces: 50, connectionsPerWorkspace: 5, entitiesPerConnectionPerDay: 50, days: 731 },
  highScale: { workspaces: 200, connectionsPerWorkspace: 8, entitiesPerConnectionPerDay: 100, days: 731 },
} as const;

export type QualificationRecommendation = "ready-for-staging" | "not-ready" | "blocked-missing-inputs";

export interface QualificationInputs {
  readonly storage: StorageGateResult;
  readonly serving: readonly ServingGateResult[];
  readonly workerInvariantsHold: boolean | null;
  readonly providerBudgetKnown: boolean;
  readonly metaLiveCleared: boolean;
  readonly missingOwnerInputs: readonly string[];
}

/**
 * Conservative release recommendation. Any unknown or failing gate, any
 * missing owner input, or any unverified worker invariant blocks staging
 * qualification. This function cannot recommend production activation.
 */
export function recommendQualification(inputs: QualificationInputs): {
  recommendation: QualificationRecommendation;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (inputs.missingOwnerInputs.length > 0) {
    reasons.push(`Missing owner inputs: ${inputs.missingOwnerInputs.join(", ")}.`);
  }
  if (inputs.storage.status !== "pass") {
    reasons.push(`Storage gate is ${inputs.storage.status}: ${inputs.storage.reason}`);
  }
  for (const gate of inputs.serving) {
    if (gate.status !== "pass") {
      reasons.push(`Serving gate ${gate.query} is ${gate.status}: ${gate.reason}`);
    }
  }
  if (inputs.workerInvariantsHold !== true) {
    reasons.push("Worker reliability invariants are not all verified.");
  }
  if (!inputs.providerBudgetKnown) {
    reasons.push("Provider budget (Google token tier/quota) is unknown.");
  }
  if (inputs.metaLiveCleared) {
    reasons.push("Meta live qualification must remain synthetic-only; unexpected clearance flag.");
  }
  if (reasons.length > 0) {
    const blocked = inputs.missingOwnerInputs.length > 0 || inputs.storage.status === "unknown";
    return { recommendation: blocked ? "blocked-missing-inputs" : "not-ready", reasons };
  }
  return { recommendation: "ready-for-staging", reasons: ["All measured gates pass; staging remains operator-gated and reversible."] };
}
