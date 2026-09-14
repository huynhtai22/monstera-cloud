/**
 * Report Lifecycle Semantics (v1)
 *
 * Distinct lifecycle states:
 * 1. "Not ready to review" — Data incomplete, unhealthy, or blocked.
 * 2. "Ready to review" — Complete, healthy data ready for operator review.
 * 3. "Approved — ready to send" — Human approval recorded for exact immutable snapshot, not yet delivered.
 * 4. "Delivered" — Human approval recorded AND verified destination delivery receipt exists.
 * 5. "Approval outdated" — Historical approval exists for this report, but current snapshot differs.
 */

import type { ReportReadinessStatus } from "./report-readiness";

export type ReportLifecycleState =
  | "Not ready to review"
  | "Ready to review"
  | "Approved — ready to send"
  | "Delivered"
  | "Approval outdated";

export type ReportApprovalSummary = {
  id: string;
  snapshotId: string;
  generationKey: string;
  sequence: number;
  datasetFingerprint: string;
  dependencyHash: string;
  approvedByUserId: string;
  approvedByUserName?: string | null;
  approvedByUserEmail?: string | null;
  approvedAt: string;
  notes?: string | null;
};

export type DeriveLifecycleInput = {
  dataStatus: ReportReadinessStatus;
  currentSnapshot: {
    id: string;
    generationKey: string;
    sequence: number;
    dependencyHash: string;
    freshness?: { freshness: "CURRENT" | "STALE" } | null;
  } | null;
  activeApproval: ReportApprovalSummary | null;
  latestReportApproval?: ReportApprovalSummary | null;
  destinationVerified?: boolean;
};

/**
 * Pure, deterministic function deriving the user-visible report lifecycle state.
 */
export function deriveReportLifecycleState(input: DeriveLifecycleInput): ReportLifecycleState {
  if (input.dataStatus !== "READY") {
    return "Not ready to review";
  }

  if (!input.currentSnapshot) {
    return "Ready to review";
  }

  // If the current snapshot is marked stale against current dependencies, any prior approval is outdated
  if (input.activeApproval && input.currentSnapshot.freshness?.freshness === "STALE") {
    return "Approval outdated";
  }

  // Check if historical approval exists for an older/different snapshot of this report
  const historicalApproval = input.latestReportApproval ?? input.activeApproval;
  if (
    historicalApproval &&
    (historicalApproval.snapshotId !== input.currentSnapshot.id ||
      historicalApproval.dependencyHash !== input.currentSnapshot.dependencyHash ||
      historicalApproval.sequence !== input.currentSnapshot.sequence)
  ) {
    return "Approval outdated";
  }

  // If approved for this exact snapshot
  const isApproved = Boolean(
    input.activeApproval &&
      input.activeApproval.snapshotId === input.currentSnapshot.id &&
      input.activeApproval.dependencyHash === input.currentSnapshot.dependencyHash
  );

  if (isApproved) {
    if (input.destinationVerified) {
      return "Delivered";
    }
    return "Approved — ready to send";
  }

  return "Ready to review";
}
