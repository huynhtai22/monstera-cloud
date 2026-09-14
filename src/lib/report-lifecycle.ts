/**
 * Report Lifecycle Semantics (v1)
 *
 * Exposes three independent axes plus a descriptive summary label:
 * 1. dataStatus: Is this snapshot's data complete and safe for an operator to review?
 * 2. approvalStatus: Has this exact snapshot received human operator sign-off?
 * 3. deliveryStatus: Has this snapshot been delivered to an external destination (e.g. Sheets/Looker)?
 * 4. summaryLabel: A truthful composite summary that never masks unapproved delivery.
 */

export type ReportApprovalStatus = "NOT_APPROVED" | "APPROVED" | "OUTDATED";

export type ReportDeliveryStatus =
  | "NOT_DELIVERED"
  | "DELIVERED"
  | "FAILED"
  | "OUTDATED";

export type ReportLifecycle = {
  dataStatus: "READY" | "WARNING" | "NOT_READY" | "UNKNOWN";
  approvalStatus: ReportApprovalStatus;
  deliveryStatus: ReportDeliveryStatus;
  summaryLabel: string;
};

export type ReportLifecycleState =
  | "Not ready to review"
  | "Ready to review"
  | "Approved — ready to send"
  | "Delivered"
  | "Approval outdated"
  | "Delivery outdated"
  | "Delivered (unapproved)"
  | string;

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
};

export type DeriveLifecycleInput = {
  dataStatus: "READY" | "WARNING" | "NOT_READY" | "UNKNOWN";
  currentSnapshot: {
    id: string;
    generationKey: string;
    sequence: number;
    datasetFingerprint?: string;
    dependencyHash?: string;
    freshness?: { freshness: "CURRENT" | "STALE"; staleReasons?: string[] } | null;
    approvalFreshness?: { fresh: boolean; staleReasons?: string[] } | null;
  } | null;
  activeApproval: ReportApprovalSummary | null;
  latestReportApproval?: ReportApprovalSummary | null;
  destinationVerified?: boolean;
  destinationState?: "verified" | "unavailable" | "unverified" | "stale" | "failed";
  deliveryReceipts?: ReadonlyArray<{
    id?: string;
    destination?: string;
    retrievedAt?: string | Date;
    dataThroughDate?: string;
    current?: boolean;
    datasetFingerprint?: string;
  }>;
};

/**
 * Pure, deterministic function deriving the 3-axis ReportLifecycle.
 */
export function deriveReportLifecycle(input: DeriveLifecycleInput): ReportLifecycle {
  const dataStatus = input.dataStatus;

  // 1. Derive approvalStatus
  let approvalStatus: ReportApprovalStatus = "NOT_APPROVED";
  if (input.currentSnapshot) {
    if (input.activeApproval) {
      const isApprovalStale = input.currentSnapshot.approvalFreshness
        ? !input.currentSnapshot.approvalFreshness.fresh
        : (() => {
            const staleReasons = input.currentSnapshot.freshness?.staleReasons;
            const isReceiptOnlyChange =
              Array.isArray(staleReasons) &&
              staleReasons.length > 0 &&
              staleReasons.every((r) => r === "destination_evidence_changed");
            return input.currentSnapshot.freshness?.freshness === "STALE" && !isReceiptOnlyChange;
          })();

      if (
        isApprovalStale ||
        input.activeApproval.snapshotId !== input.currentSnapshot.id ||
        (input.currentSnapshot.dependencyHash &&
          input.activeApproval.dependencyHash &&
          input.activeApproval.dependencyHash !== input.currentSnapshot.dependencyHash)
      ) {
        approvalStatus = "OUTDATED";
      } else {
        approvalStatus = "APPROVED";
      }
    } else if (input.latestReportApproval) {
      // Historical approval exists for an earlier sequence
      approvalStatus = "OUTDATED";
    }
  } else if (input.latestReportApproval) {
    approvalStatus = "OUTDATED";
  }

  // 2. Derive deliveryStatus
  let deliveryStatus: ReportDeliveryStatus = "NOT_DELIVERED";
  const receipts = input.deliveryReceipts ?? [];
  const destinationVerified = input.destinationVerified ?? input.destinationState === "verified";
  const destinationFailed = input.destinationState === "failed";
  const destinationStale = input.destinationState === "stale";

  if (destinationFailed) {
    deliveryStatus = "FAILED";
  } else if (receipts.length > 0) {
    const isStale =
      input.currentSnapshot?.freshness?.freshness === "STALE" ||
      destinationStale ||
      receipts.some((r) => r.current === false) ||
      (Boolean(input.currentSnapshot?.datasetFingerprint) &&
        receipts.some(
          (r) => r.datasetFingerprint && r.datasetFingerprint !== input.currentSnapshot?.datasetFingerprint
        ));

    if (isStale) {
      deliveryStatus = "OUTDATED";
    } else {
      deliveryStatus = "DELIVERED";
    }
  } else if (destinationVerified) {
    if (input.currentSnapshot?.freshness?.freshness === "STALE" || destinationStale) {
      deliveryStatus = "OUTDATED";
    } else {
      deliveryStatus = "DELIVERED";
    }
  } else if (destinationStale) {
    deliveryStatus = "OUTDATED";
  }

  // 3. Derive summaryLabel
  let summaryLabel: string;
  if (dataStatus !== "READY") {
    summaryLabel = "Not ready to review";
  } else if (approvalStatus === "OUTDATED") {
    summaryLabel = "Approval outdated";
  } else if (approvalStatus === "APPROVED") {
    if (deliveryStatus === "DELIVERED") {
      summaryLabel = "Delivered";
    } else if (deliveryStatus === "OUTDATED") {
      summaryLabel = "Delivery outdated";
    } else {
      summaryLabel = "Approved — ready to send";
    }
  } else {
    // NOT_APPROVED
    if (deliveryStatus === "DELIVERED") {
      summaryLabel = "Delivered (unapproved)";
    } else if (deliveryStatus === "OUTDATED") {
      summaryLabel = "Delivery outdated";
    } else {
      summaryLabel = "Ready to review";
    }
  }

  return {
    dataStatus,
    approvalStatus,
    deliveryStatus,
    summaryLabel,
  };
}

/**
 * Backward compatibility wrapper returning the summary label.
 */
export function deriveReportLifecycleState(input: DeriveLifecycleInput): string {
  return deriveReportLifecycle(input).summaryLabel;
}
