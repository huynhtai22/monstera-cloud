/**
 * Central plan configuration for Monstera Cloud.
 * All quota limits, sync intervals, and priority values live here.
 * Import this file from any API route that needs plan-aware enforcement.
 */

export type PlanName = 'free' | 'pilot' | 'starter' | 'professional' | 'enterprise';

/**
 * True when the user has an active paid tier (anything other than free).
 * Used for post-login routing; keep in sync with webhook `user.plan` values.
 */
export function isPaidSubscriptionPlan(plan: string | undefined | null): boolean {
  if (plan == null || plan === "") return false;
  const p = plan.toLowerCase().trim();
  if (p === "free") return false;
  return (
    p === "pilot" ||
    p === "starter" ||
    p === "professional" ||
    p === "enterprise" ||
    /** legacy / informal */
    p === "pro"
  );
}

export interface PlanLimits {
  /** Maximum number of pipelines a user can create */
  maxPipelines: number;
  /** Maximum licensed user seats per workspace */
  maxSeats: number;
  /** Maximum connected ad accounts and shops per workspace */
  maxConnections: number;
  /** Maximum queries/refreshes per month */
  maxQueriesPerMonth: number;
  /** Minimum ms between pipeline syncs (cooldown window) */
  syncIntervalMs: number;
  /** Free tier: max calendar days of report history (ad APIs); paid tiers omit = unlimited */
  maxHistoryDays?: number;
  /** Minimum ms between TikTok report requests (anti-burst cache TTL) */
  tiktokReportCooldownMs: number;
  /** Minimum ms between Meta Ads report requests */
  metaReportCooldownMs: number;
  /** Minimum ms between Google Ads report requests */
  googleReportCooldownMs: number;
  /** Job queue priority — higher = processed first */
  priority: number;
  /** Human-readable sync cadence label */
  syncLabel: string;
  /** Data Explorer: max date range in days per query */
  explorerMaxDateRangeDays: number;
  /** Data Explorer: max rows returned per query (pagination enforced) */
  explorerMaxRowsPerQuery: number;
}

export const PLAN_LIMITS: Record<PlanName, PlanLimits> = {
  free: {
    maxPipelines: 2,
    maxSeats: 1,
    maxConnections: 2,
    maxQueriesPerMonth: 100,
    syncIntervalMs: 60 * 1000,                    // TODO: restore to 24h — temporarily relaxed for testing
    maxHistoryDays: 14,
    tiktokReportCooldownMs: 60 * 60 * 1000,      // 1 hour cooldown on reports
    metaReportCooldownMs: 60 * 60 * 1000,        // 1 hour cooldown
    googleReportCooldownMs: 60 * 60 * 1000,      // 1 hour cooldown
    priority: 1,
    syncLabel: 'Daily',
    explorerMaxDateRangeDays: 30,                 // 30 days max per query
    explorerMaxRowsPerQuery: 500,                 // 500 rows per query
  },
  pilot: {
    maxPipelines: 25,
    maxSeats: 5,
    maxConnections: 25,
    maxQueriesPerMonth: 5000,
    syncIntervalMs: 24 * 60 * 60 * 1000,
    tiktokReportCooldownMs: 30 * 60 * 1000,
    metaReportCooldownMs: 30 * 60 * 1000,
    googleReportCooldownMs: 30 * 60 * 1000,
    priority: 3,
    syncLabel: 'Nightly + manual',
    explorerMaxDateRangeDays: 730,
    explorerMaxRowsPerQuery: 10_000,
  },
  starter: {
    maxPipelines: 5,
    maxSeats: 1,
    maxConnections: 5,
    maxQueriesPerMonth: 500,
    syncIntervalMs: 24 * 60 * 60 * 1000,         // 1 day
    tiktokReportCooldownMs: 30 * 60 * 1000,       // 30 min cooldown — clear gap vs Pro (10 min)
    metaReportCooldownMs: 30 * 60 * 1000,         // 30 min cooldown
    googleReportCooldownMs: 30 * 60 * 1000,       // 30 min cooldown
    priority: 2,
    syncLabel: 'Daily',
    explorerMaxDateRangeDays: 90,                 // 90 days max per query
    explorerMaxRowsPerQuery: 1000,                 // 1000 rows per query
  },
  professional: {
    maxPipelines: 15,
    maxSeats: 3,
    maxConnections: 20,
    maxQueriesPerMonth: 3000,
    syncIntervalMs: 60 * 60 * 1000,              // 1 hour
    tiktokReportCooldownMs: 10 * 60 * 1000,      // 10 min cooldown — 3x faster than Starter
    metaReportCooldownMs: 10 * 60 * 1000,        // 10 min cooldown
    googleReportCooldownMs: 10 * 60 * 1000,      // 10 min cooldown
    priority: 3,
    syncLabel: 'Nightly + manual',
    explorerMaxDateRangeDays: 365,                // 1 year max per query
    explorerMaxRowsPerQuery: 5000,               // 5000 rows per query
  },
  enterprise: {
    maxPipelines: Infinity,
    maxSeats: 10,
    maxConnections: 100,
    maxQueriesPerMonth: 50000,
    syncIntervalMs: 15 * 60 * 1000,              // 15 min
    tiktokReportCooldownMs: 5 * 60 * 1000,       // 5 min cooldown
    metaReportCooldownMs: 5 * 60 * 1000,         // 5 min cooldown
    googleReportCooldownMs: 5 * 60 * 1000,       // 5 min cooldown
    priority: 4,
    syncLabel: 'Nightly + manual',
    explorerMaxDateRangeDays: 730,                // 2 years max per query
    explorerMaxRowsPerQuery: 10000,              // 10000 rows per query
  },
};

/**
 * Resolve plan limits — defaults to 'free' for unknown plan strings.
 */
export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan as PlanName] ?? PLAN_LIMITS.free;
}

/** Clamp custom date range to plan max history (free = 14 days). */
export function clampTimeRangeToPlanMaxDays(
  plan: string,
  timeRange: { since: string; until: string }
): { since: string; until: string; clamped: boolean } {
  const maxDays = getPlanLimits(plan).maxHistoryDays;
  if (!maxDays) return { ...timeRange, clamped: false };
  const until = new Date(timeRange.until);
  const since = new Date(timeRange.since);
  if (Number.isNaN(until.getTime()) || Number.isNaN(since.getTime())) {
    return { ...timeRange, clamped: false };
  }
  const spanMs = until.getTime() - since.getTime();
  const maxMs = maxDays * 86400000;
  if (spanMs <= maxMs) return { ...timeRange, clamped: false };
  const newSince = new Date(until.getTime() - maxMs);
  return {
    since: newSince.toISOString().slice(0, 10),
    until: timeRange.until,
    clamped: true,
  };
}

/** Meta Insights: shorten long presets for free tier */
export function clampMetaDatePresetForPlan(plan: string, preset: string | undefined): string | undefined {
  const maxDays = getPlanLimits(plan).maxHistoryDays;
  if (!maxDays || !preset) return preset;
  const long = [
    "last_30d",
    "last_90d",
    "last_365d",
    "maximum",
    "data_maximum",
    "last_60d",
    "last_6m",
    "last_3m",
  ];
  return long.includes(preset) ? "last_14d" : preset;
}

/** Google Ads GAQL date literal — cap wide windows for free */
export function clampGoogleAdsDatePeriodForPlan(plan: string, datePeriod: string): string {
  const maxDays = getPlanLimits(plan).maxHistoryDays;
  if (!maxDays) return datePeriod;
  const long = [
    "LAST_30_DAYS",
    "LAST_90_DAYS",
    "LAST_180_DAYS",
    "LAST_365_DAYS",
    "LAST_14_MONTHS",
  ];
  return long.includes(datePeriod) ? "LAST_14_DAYS" : datePeriod;
}

/**
 * Derive a deterministic cron-minute offset (0–59) from a user ID.
 * Hashing ensures each user gets a different minute of the hour,
 * spreading load across the full 60-minute window instead of
 * letting all users burst at :00.
 *
 * Example: userId "abc123" → minute 37 → cron "37 * * * *"
 */
export function userCronOffset(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    // djb2-style hash — fast, good distribution, no dependencies
    hash = (hash * 31 + userId.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash) % 60;
}

/**
 * Returns a full cron expression for a user's staggered hourly sync.
 * The minute is deterministic from the user ID so it never changes.
 */
export function userSyncCron(userId: string): string {
  return `${userCronOffset(userId)} * * * *`;
}
