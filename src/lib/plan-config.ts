/**
 * Central plan configuration for Monstera Cloud.
 * All quota limits, sync intervals, and priority values live here.
 * Import this file from any API route that needs plan-aware enforcement.
 */

export type PlanName = 'free' | 'starter' | 'professional' | 'enterprise';

export interface PlanLimits {
  /** Maximum number of pipelines a user can create */
  maxPipelines: number;
  /** Minimum ms between pipeline syncs (cooldown window) */
  syncIntervalMs: number;
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
}

export const PLAN_LIMITS: Record<PlanName, PlanLimits> = {
  free: {
    maxPipelines: 1,
    syncIntervalMs: 7 * 24 * 60 * 60 * 1000,   // 1 week
    tiktokReportCooldownMs: 60 * 60 * 1000,      // 1 hour cooldown on reports
    metaReportCooldownMs: 60 * 60 * 1000,        // 1 hour cooldown
    googleReportCooldownMs: 60 * 60 * 1000,      // 1 hour cooldown
    priority: 1,
    syncLabel: 'Weekly',
  },
  starter: {
    maxPipelines: 5,
    syncIntervalMs: 24 * 60 * 60 * 1000,         // 1 day
    tiktokReportCooldownMs: 15 * 60 * 1000,       // 15 min cooldown
    metaReportCooldownMs: 15 * 60 * 1000,         // 15 min cooldown
    googleReportCooldownMs: 15 * 60 * 1000,       // 15 min cooldown
    priority: 2,
    syncLabel: 'Daily',
  },
  professional: {
    maxPipelines: 15,
    syncIntervalMs: 60 * 60 * 1000,              // 1 hour
    tiktokReportCooldownMs: 15 * 60 * 1000,      // 15 min cooldown
    metaReportCooldownMs: 15 * 60 * 1000,        // 15 min cooldown
    googleReportCooldownMs: 15 * 60 * 1000,      // 15 min cooldown
    priority: 3,
    syncLabel: 'Hourly',
  },
  enterprise: {
    maxPipelines: Infinity,
    syncIntervalMs: 15 * 60 * 1000,              // 15 min
    tiktokReportCooldownMs: 5 * 60 * 1000,       // 5 min cooldown
    metaReportCooldownMs: 5 * 60 * 1000,         // 5 min cooldown
    googleReportCooldownMs: 5 * 60 * 1000,       // 5 min cooldown
    priority: 4,
    syncLabel: 'Real-time',
  },
};

/**
 * Resolve plan limits — defaults to 'free' for unknown plan strings.
 */
export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan as PlanName] ?? PLAN_LIMITS.free;
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
