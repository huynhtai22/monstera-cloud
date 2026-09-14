/**
 * Report Approval Service (v1)
 *
 * Provides durable, tenant-scoped human approval for an exact, immutable ReportSnapshot.
 *
 * Semantics:
 * - References one exact ReportSnapshot.
 * - Authenticated workspace role: "member" or higher (viewers rejected).
 * - Tenant-scoped: enforces workspaceId and clientId matching.
 * - Idempotent: repeated approval of the exact same snapshot returns existing record with zero writes.
 * - Concurrent identical approvals result in exactly one approval and one audit event.
 * - Strictly rejects missing, cross-tenant, or stale snapshots with zero writes.
 * - Strictly rejects snapshots whose captured dataStatus is not READY.
 * - Never modifies ReportSnapshot row (snapshots are immutable).
 * - Never creates or modifies DestinationDeliveryReceipt.
 * - Zero provider, destination or external network calls.
 * - Emits AuditEvent atomically with the approval.
 */

import prisma from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/rbac";
import { extractSnapshotDataStatus } from "./report-readiness";
import { evaluateSnapshotApprovalFreshness } from "./report-blueprint";
import {
  getSnapshotApproval,
  getLatestReportApproval,
  toReportApprovalSummary,
} from "./report-snapshot-approvals";
import type { DbApprovalWithRelations } from "./report-snapshot-approvals";
import type { ReportApprovalSummary } from "./report-lifecycle";

export {
  getSnapshotApproval,
  getLatestReportApproval,
  toReportApprovalSummary,
};
export type { DbApprovalWithRelations };
export { extractSnapshotDataStatus as getSnapshotDataStatus } from "./report-readiness";

export class ReportApprovalError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "unauthorized"
      | "workspace_mismatch"
      | "client_mismatch"
      | "snapshot_not_found"
      | "data_not_ready"
      | "snapshot_stale"
      | "superseded_snapshot"
      | "snapshot_superseded"
      | "invalid_input",
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "ReportApprovalError";
  }
}

export type ApproveReportSnapshotInput = {
  workspaceId: string;
  clientId: string;
  snapshotId: string;
  userId: string;
};

export type ApproveReportSnapshotResult = {
  approval: ReportApprovalSummary;
  created: boolean;
};

function isPrismaUniqueConstraintError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const code = (err as { code?: string }).code;
    return code === "P2002";
  }
  return false;
}

/**
 * Record durable human approval for an exact ReportSnapshot.
 */
export async function approveReportSnapshot(
  input: ApproveReportSnapshotInput,
): Promise<ApproveReportSnapshotResult> {
  const { workspaceId, clientId, snapshotId, userId } = input;

  if (!workspaceId || !clientId || !snapshotId || !userId) {
    throw new ReportApprovalError("workspaceId, clientId, snapshotId, and userId are required", "invalid_input", 400);
  }

  // 1. Authorize: Minimum role "member" (viewers rejected)
  await requireWorkspaceAccess({
    userId,
    workspaceId,
    minimumRole: "member",
    operation: "approve_report_snapshot",
  });

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // 2. Fetch the snapshot inside RepeatableRead transaction
        const snapshot = await tx.reportSnapshot.findUnique({
          where: { id: snapshotId },
        });

        if (!snapshot) {
          throw new ReportApprovalError("Report snapshot not found", "snapshot_not_found", 404);
        }

        if (snapshot.workspaceId !== workspaceId) {
          throw new ReportApprovalError("Snapshot does not belong to this workspace", "workspace_mismatch", 403);
        }

        if (snapshot.clientId !== clientId) {
          throw new ReportApprovalError("Snapshot does not belong to this client", "client_mismatch", 400);
        }

        // 3. Fast-path check: If already approved for this exact snapshot in this workspace, return existing approval
        const existing = await tx.reportSnapshotApproval.findUnique({
          where: {
            workspaceId_snapshotId: {
              workspaceId,
              snapshotId,
            },
          },
          include: {
            snapshot: {
              select: {
                generationKey: true,
                sequence: true,
                datasetFingerprint: true,
                dependencyHash: true,
              },
            },
            approvedByUser: { select: { id: true, name: true, email: true } },
          },
        });

        if (existing) {
          return {
            approval: toReportApprovalSummary(existing, snapshot),
            created: false,
          };
        }

        // 4. Validate captured data readiness:
        const dataStatus = extractSnapshotDataStatus(snapshot);
        if (dataStatus !== "READY") {
          throw new ReportApprovalError(
            `Cannot approve report: snapshot captured data status is "${dataStatus}" (must be "READY")`,
            "data_not_ready",
            409,
          );
        }

        // 5. Validate that snapshot has not been superseded by a newer sequence
        const newerSnapshot = await tx.reportSnapshot.findFirst({
          where: {
            workspaceId: snapshot.workspaceId,
            clientId: snapshot.clientId,
            generationKey: snapshot.generationKey,
            sequence: { gt: snapshot.sequence },
          },
          select: { id: true },
        });
        if (newerSnapshot) {
          throw new ReportApprovalError(
            "Cannot approve report: a newer snapshot has already been generated for this reporting window",
            "superseded_snapshot",
            409,
          );
        }

        // 6. Verify dependency freshness inside this RepeatableRead transaction
        const freshness = await evaluateSnapshotApprovalFreshness(snapshot, tx);
        if (!freshness.fresh) {
          throw new ReportApprovalError(
            `Cannot approve report: snapshot is stale due to changed dependencies (${freshness.staleReasons.join(", ")})`,
            "snapshot_stale",
            409,
          );
        }

        // 7. Persist approval and audit event atomically
        const created = await tx.reportSnapshotApproval.create({
          data: {
            workspaceId,
            clientId: snapshot.clientId,
            snapshotId: snapshot.id,
            approvedByUserId: userId,
          },
          include: {
            snapshot: {
              select: {
                generationKey: true,
                sequence: true,
                datasetFingerprint: true,
                dependencyHash: true,
              },
            },
            approvedByUser: { select: { id: true, name: true, email: true } },
          },
        });

        await tx.auditEvent.create({
          data: {
            workspaceId,
            actorUserId: userId,
            action: "report_snapshot.approved",
            resource: "report_snapshot",
            resourceId: snapshot.id,
            metadata: {
              approvalId: created.id,
              snapshotId: snapshot.id,
              clientId: snapshot.clientId,
              generationKey: snapshot.generationKey,
              sequence: snapshot.sequence,
            },
          },
        });

        return {
          approval: toReportApprovalSummary(created, snapshot),
          created: true,
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 30_000 },
    );

    return result;
  } catch (err: unknown) {
    if (isPrismaUniqueConstraintError(err)) {
      const raced = await getSnapshotApproval(workspaceId, snapshotId);
      if (raced) {
        return {
          approval: raced,
          created: false,
        };
      }
    }
    throw err;
  }
}
