/**
 * Retention and Service Level Objective (SLO) contracts.
 * Defined in Sections 5, 8, 9 of docs/implementation-plans/agent-first-console.md.
 */

export const RETENTION_POLICY = {
  /** Detailed step-level execution traces retention in days */
  DETAILED_TRACES_RETENTION_DAYS: 30,
  /** Aggregate evidence snapshots retention in days */
  AGGREGATE_EVIDENCE_RETENTION_DAYS: 180,
  /** Case history and lifecycle transitions retention in days */
  CASE_HISTORY_RETENTION_DAYS: 180,
  /** Authorization revisions and revocations retention in days */
  AUTHORIZATION_HISTORY_RETENTION_DAYS: 180,
  /** Operation idempotency receipts and events retention in days */
  OPERATION_EVENTS_RETENTION_DAYS: 180,
} as const;

export const CONSOLE_PILOT_SLO = {
  /** Target dispatch evaluation window in minutes for scheduled daily checks */
  TARGET_DISPATCH_WINDOW_MINUTES: 60,
  /** Percentage of eligible daily checks that must complete within the dispatch window */
  TARGET_ON_TIME_PERCENTAGE: 95,
  /** Threshold in minutes after which a check is labeled SCHEDULER_DELAYED */
  MAX_DELAYED_CHECK_THRESHOLD_MINUTES: 60,
  /** Number of consecutive missed scheduler dispatch opportunities before operator alert */
  CONSECUTIVE_MISSED_DISPATCHES_FOR_ALERT: 2,
  /** Default retry backoff delays in milliseconds for transient data recovery */
  DEFAULT_RETRY_BACKOFF_MS: [1 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000] as const,
  /** Maximum retriable attempts allowed for a single recovery operation */
  MAX_RECOVERY_ATTEMPTS: 3,
} as const;

export interface CheckTimingEvaluation {
  scheduledSlot: Date;
  attemptedAt: Date;
  isDelayed: boolean;
  delayMinutes: number;
}

/**
 * Evaluates whether an evaluation execution satisfies pilot timeliness SLOs.
 */
export function evaluateCheckTiming(scheduledSlot: Date, attemptedAt: Date): CheckTimingEvaluation {
  const diffMs = attemptedAt.getTime() - scheduledSlot.getTime();
  const delayMinutes = Math.max(0, Math.floor(diffMs / (60 * 1000)));
  const isDelayed = delayMinutes > CONSOLE_PILOT_SLO.MAX_DELAYED_CHECK_THRESHOLD_MINUTES;

  return {
    scheduledSlot,
    attemptedAt,
    isDelayed,
    delayMinutes,
  };
}

/**
 * Determines if evidence has expired under retention policy.
 */
export function isEvidenceExpired(createdAt: Date, now: Date = new Date()): boolean {
  const ageMs = now.getTime() - createdAt.getTime();
  const maxAgeMs = RETENTION_POLICY.AGGREGATE_EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return ageMs > maxAgeMs;
}
