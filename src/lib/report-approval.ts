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
 * - Strictly rejects missing, cross-tenant, or stale snapshots with zero writes.
 * - Strictly rejects snapshots whose underlying data is not ready (blockers present).
 * - Never modifies ReportSnapshot row (snapshots are immutable).
 * - Never creates or modifies DestinationDeliveryReceipt.
 * - Zero provider, destination or external network calls.
 * - Emits AuditEvent on approval.
 */

import prisma from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/rbac";
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
  notes?: string | null;
};

export type ApproveReportSnapshotResult = {
  approval: ReportApprovalSummary;
  created: boolean;
};

/**
 * Record durable human approval for an exact ReportSnapshot.
 */
export async function approveReportSnapshot(
  input: ApproveReportSnapshotInput,
): Promise<ApproveReportSnapshotResult> {
  const { workspaceId, clientId, snapshotId, userId, notes } = input;

  if (!workspaceId || !clientId || !snapshotId || !userId) {
    throw new ReportApprovalError("workspaceId, clientId, snapshotId, and userId are required", "invalid_input", 400);
  }

  // 1. Authorize: Minimum role "member" (viewers rejected)
  await requireWorkspaceAccess({
    userId,
    workspaceId,
    minimumRole: "member",
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

  // 3. Check idempotency: If already approved for this exact snapshot in this workspace, return existing approval
  const existing = await prisma.reportSnapshotApproval.findUnique({
    where: {
      workspaceId_snapshotId: {
        workspaceId,
        snapshotId,
      },
    },
    include: {
      approvedBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (existing) {
    return {
      approval: {
        id: existing.id,
        snapshotId: existing.snapshotId,
        generationKey: existing.generationKey,
        sequence: existing.sequence,
        datasetFingerprint: existing.datasetFingerprint,
        dependencyHash: existing.dependencyHash,
        approvedByUserId: existing.approvedByUserId,
        approvedByUserName: existing.approvedBy?.name ?? null,
        approvedByUserEmail: existing.approvedBy?.email ?? null,
        approvedAt: existing.approvedAt.toISOString(),
        notes: existing.notes,
      },
      created: false,
    };
  }

  // 4. Validate data readiness:
  // Inspect stored readiness evidence to verify that data is ready to review.
  const evidence = snapshot.readinessEvidence as {
    outcome?: {
      status?: string;
      dataStatus?: string;
      blockers?: Array<{ code: string }>;
    };
    dependencyEvidence?: {
      outcome?: {
        status?: string;
        dataStatus?: string;
        blockers?: Array<{ code: string }>;
      };
    };
  } | null;

  const outcome = evidence?.outcome ?? evidence?.dependencyEvidence?.outcome;
  const dataStatus = outcome?.dataStatus;
  const blockers = outcome?.blockers ?? [];
  const dataBlockers = blockers.filter((b) => !b.code.startsWith("DESTINATION_"));

  // Reject if dataStatus is explicitly not READY or if there are non-destination data blockers
  if (dataStatus && dataStatus !== "READY") {
    throw new ReportApprovalError("Cannot approve report: data is not ready to review", "data_not_ready", 409);
  }
  if (dataBlockers.length > 0) {
    throw new ReportApprovalError("Cannot approve report: data has unresolved blockers", "data_not_ready", 409);
  }
  if (snapshot.readinessStatus === "NOT_READY" && !dataStatus) {
    throw new ReportApprovalError("Cannot approve report: readiness status is NOT_READY", "data_not_ready", 409);
  }

  // 5. Validate that snapshot has not been superseded by a newer sequence
  const newerSnapshot = await prisma.reportSnapshot.findFirst({
    where: {
      workspaceId: snapshot.workspaceId,
      clientId: snapshot.clientId,
      reportingWindowStart: snapshot.reportingWindowStart,
      reportingWindowEnd: snapshot.reportingWindowEnd,
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

  // 6. Persist approval and audit event atomically
  const created = await prisma.$transaction(async (tx) => {
    const approval = await tx.reportSnapshotApproval.create({
      data: {
        workspaceId,
        clientId,
        snapshotId: snapshot.id,
        generationKey: snapshot.generationKey,
        sequence: snapshot.sequence,
        datasetFingerprint: snapshot.datasetFingerprint,
        dependencyHash: snapshot.dependencyHash,
        approvedByUserId: userId,
        notes: notes ?? null,
      },
      include: {
        approvedBy: { select: { id: true, name: true, email: true } },
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
          datasetFingerprint: snapshot.datasetFingerprint,
          dependencyHash: snapshot.dependencyHash,
          notes: notes ?? null,
        },
      },
    });

    return approval;
  });

  return {
    approval: {
      id: created.id,
      snapshotId: created.snapshotId,
      generationKey: created.generationKey,
      sequence: created.sequence,
      datasetFingerprint: created.datasetFingerprint,
      dependencyHash: created.dependencyHash,
      approvedByUserId: created.approvedByUserId,
      approvedByUserName: created.approvedBy?.name ?? null,
      approvedByUserEmail: created.approvedBy?.email ?? null,
      approvedAt: created.approvedAt.toISOString(),
      notes: created.notes,
    },
    created: true,
  };
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
      approvedBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (!record) return null;

  return {
    id: record.id,
    snapshotId: record.snapshotId,
    generationKey: record.generationKey,
    sequence: record.sequence,
    datasetFingerprint: record.datasetFingerprint,
    dependencyHash: record.dependencyHash,
    approvedByUserId: record.approvedByUserId,
    approvedByUserName: record.approvedBy?.name ?? null,
    approvedByUserEmail: record.approvedBy?.email ?? null,
    approvedAt: record.approvedAt.toISOString(),
    notes: record.notes,
  };
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
      generationKey,
    },
    orderBy: [{ sequence: "desc" }, { approvedAt: "desc" }],
    include: {
      approvedBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (!record) return null;

  return {
    id: record.id,
    snapshotId: record.snapshotId,
    generationKey: record.generationKey,
    sequence: record.sequence,
    datasetFingerprint: record.datasetFingerprint,
    dependencyHash: record.dependencyHash,
    approvedByUserId: record.approvedByUserId,
    approvedByUserName: record.approvedBy?.name ?? null,
    approvedByUserEmail: record.approvedBy?.email ?? null,
    approvedAt: record.approvedAt.toISOString(),
    notes: record.notes,
  };
}
