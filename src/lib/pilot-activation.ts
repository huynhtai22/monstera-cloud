import type { SourceHealthState } from "@/lib/source-health";

export const DASHBOARD_REVIEWED_ACTION = "onboarding.dashboard_reviewed";
export const DASHBOARD_REVIEWED_RESOURCE = "workspace_activation";

export type PilotActivationStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "ready_to_review"
  | "activated";

export type PilotActivationStep =
  | "connect_source"
  | "import_data"
  | "fix_source"
  | "review_dashboard"
  | "complete";

export interface PilotActivationState {
  status: PilotActivationStatus;
  currentStep: PilotActivationStep;
  trialEndsAt: string | null;
  sourceConnectionId: string | null;
  rows7d: number;
  dataThroughDate: string | null;
  dashboardReviewedAt: string | null;
  blockers: string[];
}

export interface PilotActivationSource {
  id: string;
  state: SourceHealthState;
  lastSyncAt?: Date | string | null;
}

export interface PilotActivationInput {
  workspaceStatus: string;
  subscriptionEndsAt: Date | string | null;
  sources: PilotActivationSource[];
  rows7d: number;
  dataThroughDate: Date | string | null;
  dashboardReviewedAt: Date | string | null;
  latestImport?: {
    status: string;
    approximateRows: number;
  } | null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function dashboardReviewAuditId(workspaceId: string): string {
  return `pilot-dashboard-reviewed-${workspaceId}`;
}

export function trialDaysRemaining(trialEndsAt: string | null, now = new Date()): number | null {
  if (!trialEndsAt) return null;
  const end = new Date(trialEndsAt);
  if (Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
}

/**
 * Derive onboarding state from durable workspace facts. Browser state and
 * redirects are deliberately excluded from this calculation.
 */
export function derivePilotActivation(input: PilotActivationInput): PilotActivationState {
  const rows7d = Math.max(0, Math.floor(input.rows7d));
  const trialEndsAt = input.workspaceStatus === "PILOT" ? toIso(input.subscriptionEndsAt) : null;
  const dashboardReviewedAt = toIso(input.dashboardReviewedAt);
  const dataThroughDate = toIso(input.dataThroughDate);
  const firstSource = input.sources[0] ?? null;
  const blockingSource = input.sources.find((source) =>
    ["error", "partial", "stale", "disconnected", "unknown"].includes(source.state),
  );

  if (rows7d > 0 && dashboardReviewedAt) {
    return {
      status: "activated",
      currentStep: "complete",
      trialEndsAt,
      sourceConnectionId: blockingSource?.id ?? firstSource?.id ?? null,
      rows7d,
      dataThroughDate,
      dashboardReviewedAt,
      blockers: [],
    };
  }

  if (!firstSource) {
    return {
      status: "not_started",
      currentStep: "connect_source",
      trialEndsAt,
      sourceConnectionId: null,
      rows7d,
      dataThroughDate,
      dashboardReviewedAt,
      blockers: [],
    };
  }

  // One usable source with recent data is enough to enter the review step.
  // A secondary connection that needs attention remains visible elsewhere on
  // the dashboard, but it must not prevent a pilot from reaching activation.
  if (rows7d > 0) {
    return {
      status: "ready_to_review",
      currentStep: "review_dashboard",
      trialEndsAt,
      sourceConnectionId: firstSource.id,
      rows7d,
      dataThroughDate,
      dashboardReviewedAt,
      blockers: [],
    };
  }

  if (blockingSource) {
    const blocker = blockingSource.state === "stale"
      ? "stale_data"
      : blockingSource.state === "partial"
        ? "partial_import"
        : "source_authorization_failed";
    return {
      status: "blocked",
      currentStep: "fix_source",
      trialEndsAt,
      sourceConnectionId: blockingSource.id,
      rows7d,
      dataThroughDate,
      dashboardReviewedAt,
      blockers: [blocker],
    };
  }

  const importFailed = input.latestImport?.status === "failed";
  const zeroRowImport =
    input.latestImport?.status === "completed" && input.latestImport.approximateRows === 0;
  const hasCompletedSourceSync = input.sources.some((source) => Boolean(source.lastSyncAt));
  const blocker = importFailed
    ? "import_failed"
    : zeroRowImport || hasCompletedSourceSync
      ? "zero_recent_rows"
      : null;
  return {
    status: blocker ? "blocked" : "in_progress",
    currentStep: "import_data",
    trialEndsAt,
    sourceConnectionId: firstSource.id,
    rows7d,
    dataThroughDate,
    dashboardReviewedAt,
    blockers: blocker ? [blocker] : [],
  };
}

export function pilotActivationSortRank(state: PilotActivationState, now = new Date()): number {
  const expired = state.trialEndsAt ? new Date(state.trialEndsAt).getTime() <= now.getTime() : false;
  if (expired || state.status === "blocked") return 0;
  if (state.status === "not_started" || state.status === "in_progress") return 1;
  if (state.status === "ready_to_review") return 2;
  return 3;
}
