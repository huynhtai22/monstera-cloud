/**
 * Report Snapshot Approval Queries
 *
 * Dedicated, decoupled queries for reading ReportSnapshotApproval records
 * without circular dependencies between Report Blueprint and Report Approval.
 */

import prisma from "@/lib/prisma";
import type { ReportApprovalSummary } from "./report-lifecycle";

export type DbApprovalWithRelations = {
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

export function toReportApprovalSummary(
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
