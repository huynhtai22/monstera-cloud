import type { ReadinessCode, ReportReadinessEvaluation } from "./report-readiness";

export type FreshnessStageKey = "source" | "warehouse" | "report" | "delivery";
export const FRESHNESS_STAGE_ORDER: FreshnessStageKey[] = ["source", "warehouse", "report", "delivery"];
// Exhaustive routing of canonical issues, NOT a second readiness evaluator.
export const FRESHNESS_ISSUE_STAGE: Record<ReadinessCode, FreshnessStageKey> = {
  SOURCE_MISSING: "source", SOURCE_DISCONNECTED: "source", SOURCE_RECONNECT_REQUIRED: "source",
  SOURCE_QUARANTINED: "source", SOURCE_UNVERIFIED: "source",
  SYNC_FAILED: "warehouse", SYNC_PARTIAL: "warehouse", DATA_STALE: "warehouse",
  REPORTING_WINDOW_INCOMPLETE: "warehouse", SYNC_IN_PROGRESS: "warehouse",
  CURRENCY_UNKNOWN: "report", TIMEZONE_UNKNOWN: "report", MIXED_CURRENCY: "report",
  TIMEZONE_CONFLICT: "report", CURRENCY_CONFLICT: "report", REQUIRED_PROVIDERS_INFERRED: "report",
  EVIDENCE_LIMIT_REACHED: "report", DESTINATION_UNAVAILABLE: "delivery",
  DESTINATION_UNVERIFIED: "delivery", DESTINATION_STALE: "delivery", DESTINATION_REQUIREMENTS_MISSING: "delivery",
};
export type FreshnessJourney = {
  status: ReportReadinessEvaluation["status"];
  evaluatedAt: string;
  window: ReportReadinessEvaluation["window"];
  lastSuccessfulSyncAt: string | null;
  dataThroughDate: string | null;
  deliveredAt: string | null;
  stages: Array<{ key: FreshnessStageKey; state: "passed" | "attention" | "unknown" | "waiting"; codes: ReadinessCode[]; href: string }>;
};

export function buildFreshnessJourney(evaluation: ReportReadinessEvaluation): FreshnessJourney {
  const codes = [...new Set([...evaluation.blockers, ...evaluation.warnings].map(i => i.code))].sort();
  const hrefs = { source: "/sources", warehouse: "/explorer", report: "/reports", delivery: "/exports" };
  let upstream = false;
  const stages: FreshnessJourney["stages"] = FRESHNESS_STAGE_ORDER.map(key => {
    const own = codes.filter(code => FRESHNESS_ISSUE_STAGE[code] === key);
    const state = evaluation.evidence.limited || (evaluation.status !== "READY" && codes.length === 0)
      ? "unknown" : own.length ? "attention" : upstream ? "waiting" : "passed";
    if (state !== "passed") upstream = true;
    return { key, state, codes: own, href: hrefs[key] };
  });
  const currentReceipts = evaluation.destination.receipts?.filter(r => r.current) ?? [];
  return {
    // Only the canonical evaluator may claim READY.
    status: evaluation.status, evaluatedAt: evaluation.evaluatedAt, window: evaluation.window,
    lastSuccessfulSyncAt: evaluation.latestSuccessfulSyncAt, dataThroughDate: evaluation.latestDataDate,
    deliveredAt: evaluation.destination.state === "verified"
      ? currentReceipts.map(r => r.retrievedAt).sort()[0] ?? null : null,
    stages,
  };
}

/** Stable incident identity: timestamps moving forward alone are not incidents. */
export function freshnessIncidentKey(journey: FreshnessJourney): string {
  return JSON.stringify({ status: journey.status, stages: journey.stages.map(s => ({ key: s.key, state: s.state, codes: s.codes })) });
}
