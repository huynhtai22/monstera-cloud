/**
 * Reliable ingestion — shared focus areas for instrumentation, UI, and alerts.
 * Human-readable checklist lives in /priorities.md (section 1).
 *
 * Related: `error-taxonomy.ts`, `connection-sync-state.ts`, pipeline run route.
 */

export const RELIABILITY_PILLARS = [
  "observable_syncs",
  "actionable_errors",
  "idempotent_runs",
  "alert_signal_to_noise",
] as const;

export type ReliabilityPillar = (typeof RELIABILITY_PILLARS)[number];

/** Pipeline / connection states we surface to users (align with DB and API). */
export const PIPELINE_HEALTH = ["healthy", "stale", "error"] as const;
export type PipelineHealthStatus = (typeof PIPELINE_HEALTH)[number];
