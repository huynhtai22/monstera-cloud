/**
 * Central plan configuration for Monstera Cloud.
 * All quota limits, sync intervals, and priority values live here.
 * Import this file from any API route that needs plan-aware enforcement.
 */

export type PlanName = 'free' | 'pilot' | 'starter' | 'professional' | 'enterprise';

/**
 * Whitelisted emails that automatically receive Agency Pro plan privileges.
 */
export const PRO_WHITELIST_EMAILS = [
  "huynhcamtai1234@gmail.com",
  "huynhtai@monsteracloud.com",
];

export function isWhitelistedProEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();
  return PRO_WHITELIST_EMAILS.includes(normalized);
}

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

/** Nightly Hobby cron can honor none vs daily; "hourly" is intent until an hourly cron exists. */
export type ScheduledRefresh = "none" | "daily" | "hourly";

/** Public self-serve rungs. Internal ids stay free/starter/professional for Paddle + Workspace.plan. */
export const SELF_SERVE_PLAN_IDS = ["free", "starter", "professional"] as const;
export type SelfServePlanId = (typeof SELF_SERVE_PLAN_IDS)[number];

export interface PlanLimits {
  /** Customer-facing rung name (Start / Studio / Agency / Pilot / Enterprise) */
  displayName: string;
  /** Maximum number of pipelines a user can create */
  maxPipelines: number;
  /**
   * Maximum licensed user seats per workspace.
   * Copy may say "unlimited"; enforcement still uses this cap (abuse ceiling).
   */
  maxSeats: number;
  /**
   * Maximum source Connection rows per workspace (ad accounts / shops).
   * Destinations (Sheets) are not counted. Unit is workspace-total, not accounts-per-source.
   */
  maxConnections: number;
  /** Maximum distinct source providers (e.g. meta_ads + google_ads = 2) */
  maxSourceProviders: number;
  /** Maximum workspaces owned by one user */
  maxWorkspaces: number;
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
  /** Scheduled warehouse refresh policy */
  scheduledRefresh: ScheduledRefresh;
  /** Looker Studio™ / Data Studio connector (API-key pull). Sheets JWT is always allowed. */
  allowLooker: boolean;
  /** Create workspace API keys (Looker connector + REST). Free cannot. */
  allowApiKeys: boolean;
  /** CSV / REST row export (`/api/export/rows`). Agency+ only. */
  allowCsvExport: boolean;
  /** Data Explorer: max date range in days per query */
  explorerMaxDateRangeDays: number;
  /** Data Explorer: max rows returned per query (pagination enforced) */
  explorerMaxRowsPerQuery: number;
}

export const PLAN_LIMITS: Record<PlanName, PlanLimits> = {
  free: {
    displayName: "Start",
    maxPipelines: 2,
    maxSeats: 1,
    maxConnections: 1,
    maxSourceProviders: 1,
    maxWorkspaces: 1,
    maxQueriesPerMonth: 100,
    // Public Free-plan promise: one scheduled sync per 24 hours.
    syncIntervalMs: 24 * 60 * 60 * 1000,
    maxHistoryDays: 14,
    tiktokReportCooldownMs: 60 * 60 * 1000,      // 1 hour cooldown on reports
    metaReportCooldownMs: 60 * 60 * 1000,        // 1 hour cooldown
    googleReportCooldownMs: 60 * 60 * 1000,      // 1 hour cooldown
    priority: 1,
    syncLabel: "Daily",
    scheduledRefresh: "daily",
    allowLooker: false,
    allowApiKeys: false,
    allowCsvExport: false,
    explorerMaxDateRangeDays: 30,                 // 30 days max per query
    explorerMaxRowsPerQuery: 500,                 // 500 rows per query
  },
  pilot: {
    displayName: "Pilot",
    maxPipelines: 25,
    maxSeats: 5,
    maxConnections: 25,
    maxSourceProviders: 4,
    maxWorkspaces: 5,
    maxQueriesPerMonth: 5000,
    syncIntervalMs: 24 * 60 * 60 * 1000,
    tiktokReportCooldownMs: 30 * 60 * 1000,
    metaReportCooldownMs: 30 * 60 * 1000,
    googleReportCooldownMs: 30 * 60 * 1000,
    priority: 3,
    syncLabel: "Nightly + manual",
    scheduledRefresh: "daily",
    allowLooker: true,
    allowApiKeys: true,
    allowCsvExport: true,
    explorerMaxDateRangeDays: 730,
    explorerMaxRowsPerQuery: 10_000,
  },
  starter: {
    displayName: "Studio",
    maxPipelines: 5,
    maxSeats: 50,
    maxConnections: 6,
    maxSourceProviders: 2,
    maxWorkspaces: 1,
    maxQueriesPerMonth: 500,
    syncIntervalMs: 24 * 60 * 60 * 1000,         // 1 day
    tiktokReportCooldownMs: 30 * 60 * 1000,       // 30 min cooldown — clear gap vs Agency (10 min)
    metaReportCooldownMs: 30 * 60 * 1000,         // 30 min cooldown
    googleReportCooldownMs: 30 * 60 * 1000,       // 30 min cooldown
    priority: 2,
    syncLabel: "Daily + on-demand",
    scheduledRefresh: "daily",
    allowLooker: true,
    allowApiKeys: true,
    allowCsvExport: false,
    explorerMaxDateRangeDays: 90,                 // 90 days max per query
    explorerMaxRowsPerQuery: 1000,                 // 1000 rows per query
  },
  professional: {
    displayName: "Agency",
    maxPipelines: 15,
    maxSeats: 50,
    maxConnections: 15,
    maxSourceProviders: 4,
    maxWorkspaces: 3,
    maxQueriesPerMonth: 3000,
    syncIntervalMs: 60 * 60 * 1000,              // 1 hour
    tiktokReportCooldownMs: 10 * 60 * 1000,      // 10 min cooldown — 3x faster than Studio
    metaReportCooldownMs: 10 * 60 * 1000,        // 10 min cooldown
    googleReportCooldownMs: 10 * 60 * 1000,      // 10 min cooldown
    priority: 3,
    syncLabel: "Daily + on-demand",
    scheduledRefresh: "hourly",
    allowLooker: true,
    allowApiKeys: true,
    allowCsvExport: true,
    explorerMaxDateRangeDays: 365,                // 1 year max per query
    explorerMaxRowsPerQuery: 5000,               // 5000 rows per query
  },
  enterprise: {
    displayName: "Enterprise",
    maxPipelines: Infinity,
    maxSeats: 50,
    maxConnections: 100,
    maxSourceProviders: 10,
    maxWorkspaces: 20,
    maxQueriesPerMonth: 50000,
    syncIntervalMs: 15 * 60 * 1000,              // 15 min
    tiktokReportCooldownMs: 5 * 60 * 1000,       // 5 min cooldown
    metaReportCooldownMs: 5 * 60 * 1000,         // 5 min cooldown
    googleReportCooldownMs: 5 * 60 * 1000,       // 5 min cooldown
    priority: 4,
    syncLabel: "Nightly + manual",
    scheduledRefresh: "hourly",
    allowLooker: true,
    allowApiKeys: true,
    allowCsvExport: true,
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

export function getPlanDisplayName(plan: string): string {
  return getPlanLimits(plan).displayName;
}

/** Scheduled warehouse cron should skip workspaces on `scheduledRefresh: "none"` (Start/free). */
export function workspaceAllowsScheduledRefresh(plan: string): boolean {
  return getPlanLimits(plan).scheduledRefresh !== "none";
}

/** Next public rung for upgrade CTAs. */
export function suggestedUpgradePlan(plan: string): SelfServePlanId {
  if (plan === "starter" || plan === "professional" || plan === "enterprise" || plan === "pilot") {
    return "professional";
  }
  return "starter";
}

/**
 * Default workspace plan for self-serve signup / first workspace.
 * Pilot remains invite-only (`invitation.plan`). PRO_WHITELIST_EMAILS still get Agency.
 */
export function defaultSignupWorkspacePlan(email?: string | null): {
  plan: "free" | "professional";
  status: "PILOT" | "ACTIVE";
} {
  if (isWhitelistedProEmail(email)) {
    return { plan: "professional", status: "ACTIVE" };
  }
  return { plan: "free", status: "PILOT" };
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

// ── Dual Currency Pricing Matrices (USD & VND PPP) ───────────────────────────

export interface PlanPriceConfig {
  usdMonthly: number;
  usdAnnualMonthly: number; // Effective monthly price when billed annually
  vndMonthly: number;       // VND per month
  vndAnnualMonthly: number; // Effective VND per month when billed annually
}

export const PLAN_PRICING: Record<PlanName, PlanPriceConfig> = {
  free: {
    usdMonthly: 0,
    usdAnnualMonthly: 0,
    vndMonthly: 0,
    vndAnnualMonthly: 0,
  },
  pilot: {
    usdMonthly: 0,
    usdAnnualMonthly: 0,
    vndMonthly: 0,
    vndAnnualMonthly: 0,
  },
  starter: {
    usdMonthly: 59,
    usdAnnualMonthly: 49, // $588/year
    vndMonthly: 990_000,
    vndAnnualMonthly: 790_000, // 9,480,000 đ/year
  },
  professional: {
    usdMonthly: 149,
    usdAnnualMonthly: 129, // $1,548/year
    vndMonthly: 1_490_000,
    vndAnnualMonthly: 1_241_667,
  },
  enterprise: {
    usdMonthly: 199,
    usdAnnualMonthly: 159, // $1,908/year
    vndMonthly: 2_490_000,
    vndAnnualMonthly: 1_990_000, // 23,880,000 đ/year
  },
};

/** Checkout uses exact annual totals rather than multiplying a rounded monthly display amount. */
export const PLAN_VND_ANNUAL_TOTALS: Partial<Record<PlanName, number>> = {
  professional: 14_900_000,
};

export function formatPlanPrice(
  plan: PlanName,
  currency: 'USD' | 'VND',
  isAnnual: boolean
): { amount: number; formatted: string; billingCycleText: string } {
  const cfg = PLAN_PRICING[plan] ?? PLAN_PRICING.free;
  if (currency === 'VND') {
    const amount = isAnnual ? cfg.vndAnnualMonthly : cfg.vndMonthly;
    return {
      amount,
      formatted: `${amount.toLocaleString('vi-VN')} đ`,
      billingCycleText: isAnnual ? '/tháng (thanh toán năm)' : '/tháng',
    };
  }
  const amount = isAnnual ? cfg.usdAnnualMonthly : cfg.usdMonthly;
  return {
    amount,
    formatted: `$${amount}`,
    billingCycleText: isAnnual ? '/mo (billed annually)' : '/mo',
  };
}
