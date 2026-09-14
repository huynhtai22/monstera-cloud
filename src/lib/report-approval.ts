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
import type { ReportReadinessStatus } from "./report-readiness";
import type { ReportApprovalSummary } from "./report-lifecycle";

export class ReportApprovalError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "unauthorized"
      | "workspace_mismatch"
      | "client_mismatch"
      | "snapshot_not_found"
      | "data_not_ready"
      | "superseded_snapshot"
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

type DbApprovalWithRelations = {
  id: string;
  workspaceId: string;
  clientId: string;
  snapshotId: string;
  approvedByUserId: string;
  approvedAt: Date;
  snapshot?: {
    generationKey: string;
    sequence: number;
    datasetFingerprint: string;
    dependencyHash: string;
  } | null;
  approvedByUser?: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
};

function toReportApprovalSummary(
  record: DbApprovalWithRelations,
  fallbackSnapshot?: {
    generationKey: string;
    sequence: number;
    datasetFingerprint: string;
    dependencyHash: string;
  },
): ReportApprovalSummary {
  const snap = record.snapshot ?? fallbackSnapshot;
  return {
    id: record.id,
    snapshotId: record.snapshotId,
    generationKey: snap?.generationKey ?? "",
    sequence: snap?.sequence ?? 1,
    datasetFingerprint: snap?.datasetFingerprint ?? "",
    dependencyHash: snap?.dependencyHash ?? "",
    approvedByUserId: record.approvedByUserId,
    approvedByUserName: record.approvedByUser?.name ?? null,
    approvedByUserEmail: record.approvedByUser?.email ?? null,
    approvedAt: record.approvedAt.toISOString(),
  };
}

function isPrismaUniqueConstraintError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const code = (err as { code?: string }).code;
    return code === "P2002";
  }
  return false;
}

/**
 * Extract durable dataStatus from a snapshot's captured evidence, with safe legacy fallback.
 * Legacy snapshots without explicit dataStatus are NOT silently classified as ready.
 */
export function getSnapshotDataStatus(snapshot: {
  readinessStatus: string;
  readinessEvidence: unknown;
}): ReportReadinessStatus {
  const evidence = snapshot.readinessEvidence as {
    outcome?: {
      dataStatus?: ReportReadinessStatus;
      status?: ReportReadinessStatus;
      blockers?: Array<{ code: string }>;
    };
    dependencyEvidence?: {
      outcome?: {
        dataStatus?: ReportReadinessStatus;
        status?: ReportReadinessStatus;
        blockers?: Array<{ code: string }>;
      };
    };
  } | null;

  const outcome = evidence?.outcome ?? evidence?.dependencyEvidence?.outcome;
  if (outcome?.dataStatus) {
    const blockers = outcome.blockers ?? [];
    const dataBlockers = blockers.filter((b) => !b.code.startsWith("DESTINATION_"));
    if (dataBlockers.length > 0) {
      return "NOT_READY";
    }
    return outcome.dataStatus;
  }

  // Backfill / legacy fallback:
  // "Do not silently classify old snapshots as ready."
  if (snapshot.readinessStatus === "READY" && (!outcome?.blockers || outcome.blockers.length === 0)) {
    return "READY";
  }

  if (snapshot.readinessStatus === "NOT_READY") return "NOT_READY";
  if (snapshot.readinessStatus === "WARNING") return "WARNING";
  return "UNKNOWN";
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

  // 2. Fetch the snapshot and verify tenant boundary
  const snapshot = await prisma.reportSnapshot.findUnique({
    where: { id: snapshotId },
    include: {
      client: { select: { id: true, workspaceId: true } },
    },
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
  const existing = await prisma.reportSnapshotApproval.findUnique({
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
  const dataStatus = getSnapshotDataStatus(snapshot);
  if (dataStatus !== "READY") {
    throw new ReportApprovalError(
      `Cannot approve report: snapshot captured data status is "${dataStatus}" (must be "READY")`,
      "data_not_ready",
      409,
    );
  }

  // 5. Validate that snapshot has not been superseded by a newer sequence
  const newerSnapshot = await prisma.reportSnapshot.findFirst({
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

  // 6. Persist approval and audit event atomically.
  // Catch P2002 unique constraint violations so concurrent duplicate requests safely resolve.
  try {
    const created = await prisma.$transaction(async (tx) => {
      const approval = await tx.reportSnapshotApproval.create({
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
            approvalId: approval.id,
            snapshotId: snapshot.id,
            clientId: snapshot.clientId,
            generationKey: snapshot.generationKey,
            sequence: snapshot.sequence,
          },
        },
      });

      return approval;
    });

    return {
      approval: toReportApprovalSummary(created, snapshot),
      created: true,
    };
  } catch (err: unknown) {
    if (isPrismaUniqueConstraintError(err)) {
      const raced = await prisma.reportSnapshotApproval.findUnique({
        where: {
          workspaceId_snapshotId: {
            workspaceId,
            snapshotId: snapshot.id,
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
      if (raced) {
        return {
          approval: toReportApprovalSummary(raced, snapshot),
          created: false,
        };
      }
    }
    throw err;
  }
}

/**
 * Fetch the active approval for an exact snapshot, if any exists.
 */
export async function getSnapshotApproval(
  workspaceId: string,
  snapshotId: string,
): Promise<ReportApprovalSummary | null> {
  const record = await prisma.reportSnapshotApproval.findUnique({
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

  if (!record) return null;
  return toReportApprovalSummary(record);
}

/**
 * Fetch the latest approval for a report generationKey in this workspace.
 */
export async function getLatestReportApproval(
  workspaceId: string,
  generationKey: string,
): Promise<ReportApprovalSummary | null> {
  const record = await prisma.reportSnapshotApproval.findFirst({
    where: {
      workspaceId,
      snapshot: {
        generationKey,
      },
    },
    orderBy: {
      snapshot: {
        sequence: "desc",
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

  if (!record) return null;
  return toReportApprovalSummary(record);
}
