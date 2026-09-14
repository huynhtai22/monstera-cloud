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
 *
 * Concurrency contract (see approveReportSnapshot for details):
 * - pg_advisory_xact_lock(hashtext(generationKey)) — BLOCKING — serializes
 *   concurrent approvals and prevents concurrent blueprint generation from
 *   publishing a new snapshot while approval is evaluating the current one.
 * - SELECT ... FOR UPDATE on the Client row — blocks concurrent requirement
 *   and destination mutations until this approval commits.
 * - RepeatableRead isolation — all dependency reads see a single consistent
 *   DB snapshot taken at transaction start.
 * - Architectural boundary: warehouse data mutations (CampaignMetric ingest)
 *   do NOT acquire the generationKey advisory lock. Adding that coordination
 *   across meta-sync-lock.ts, connection-sync-lease.ts and all provider ingest
 *   paths requires a large cross-cutting change and is out of scope here.
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

/**
 * @internal TEST-ONLY seam for deterministic approval interleaving in race tests.
 * Never called by routes; not exposed through any API or Zod input.
 */
const approvalHooks: {
  afterFreshnessCheck?: (info: { snapshotId: string; generationKey: string }) => Promise<void>;
} = {};

/**
 * @internal TEST-ONLY. Install/remove deterministic approval test hooks.
 * Call with {} to clear after each test.
 */
export function _setApprovalTestHooks(hooks: {
  afterFreshnessCheck?: (info: { snapshotId: string; generationKey: string }) => Promise<void>;
}): void {
  approvalHooks.afterFreshnessCheck = hooks.afterFreshnessCheck;
}


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
 *
 * Concurrency mechanism:
 *   1. pg_advisory_xact_lock(hashtext(generationKey)) — BLOCKING — acquired
 *      first inside the RepeatableRead transaction. This is the SAME advisory
 *      key scope used by blueprint generation, which uses the non-blocking
 *      `pg_try_advisory_xact_lock`. The blocking form here serializes concurrent
 *      approval calls and prevents concurrent blueprint re-generation from
 *      publishing a new snapshot while this approval is evaluating the current one.
 *   2. SELECT ... FOR UPDATE on the Client row — blocks concurrent Client
 *      requirement/destination mutations until this approval commits.
 *   3. RepeatableRead isolation — all dependency reads see one consistent DB
 *      snapshot. Any configuration change that committed BEFORE this transaction
 *      started is detected by the freshness diff. Changes protected by the
 *      Client FOR UPDATE are blocked from committing until this tx commits.
 *
 * Architectural boundary (warehouse data):
 *   Warehouse metric ingest paths (meta-sync-lock.ts, connection-sync-lease.ts,
 *   all provider ingestion mappers) do NOT acquire the generationKey advisory
 *   lock. A warehouse write that commits AFTER this transaction's snapshot point
 *   but BEFORE this transaction commits is not visible to the freshness check
 *   within this transaction. Requiring all ingest paths to acquire this lock
 *   would require modifying a large number of unrelated ingestion paths and is
 *   intentionally out of scope. This boundary is documented, tested, and must
 *   not be papered over with false claims.
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

        // 3. Acquire blocking advisory lock on the generationKey.
        // Same advisory key as blueprint generation (hashtext(generationKey)).
        // Blueprint generation uses pg_try_advisory_xact_lock (non-blocking, boolean return);
        // this blocking form uses $executeRaw because pg_advisory_xact_lock returns void.
        // Lock is automatically released when this transaction commits or rolls back.
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${snapshot.generationKey}))`;

        // 4. Lock the Client row FOR UPDATE.
        // Blocks concurrent Client requirement/destination mutations from
        // committing until this approval transaction commits, ensuring
        // the freshness check reads the definitive current requirement state.
        // Using $queryRaw<[{id: string}]> to verify the client still exists and return its id.
        await tx.$queryRaw<[{ id: string }]>`
          SELECT id FROM "Client"
          WHERE id = ${clientId} AND "workspaceId" = ${workspaceId}
          FOR UPDATE`;

        // 5. Fast-path: If already approved for this exact snapshot, return idempotent result.
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

        // 6. Validate captured data readiness
        const dataStatus = extractSnapshotDataStatus(snapshot);
        if (dataStatus !== "READY") {
          throw new ReportApprovalError(
            `Cannot approve report: snapshot captured data status is "${dataStatus}" (must be "READY")`,
            "data_not_ready",
            409,
          );
        }

        // 7. Validate that snapshot has not been superseded by a newer sequence
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

        // 8. Verify dependency freshness inside this RepeatableRead transaction.
        // All dependency reads (Client requirements, dataset fingerprint, account
        // assignments, readiness evidence) see the same consistent DB snapshot.
        // Configuration mutations are blocked by the Client FOR UPDATE (step 4).
        // Concurrent blueprint generation is blocked by the advisory lock (step 3).
        // Warehouse data changes that committed before this transaction started
        // are correctly detected. The architectural boundary for concurrent
        // warehouse writes is documented in the module header.
        const freshness = await evaluateSnapshotApprovalFreshness(snapshot, tx);

        // TEST-ONLY: deterministic barrier for race condition tests.
        // In production approvalHooks is always empty ({}).
        await approvalHooks.afterFreshnessCheck?.({
          snapshotId: snapshot.id,
          generationKey: snapshot.generationKey,
        });

        if (!freshness.fresh) {
          throw new ReportApprovalError(
            `Cannot approve report: snapshot is stale due to changed dependencies (${freshness.staleReasons.join(", ")})`,
            "snapshot_stale",
            409,
          );
        }

        // 9. Persist approval and audit event atomically
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
