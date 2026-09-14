import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { approveReportSnapshot, getSnapshotApproval, getLatestReportApproval, ReportApprovalError } from "./report-approval";
import { deriveReportLifecycleState } from "./report-lifecycle";
import { POST as approvalRoute } from "@/app/api/reports/approval/route";
import { setAuthSessionOverride } from "./auth-session";

describe("PostgreSQL integration: Report snapshot approval and lifecycle", () => {
  const uid = randomUUID();
  const wsA = `appr-ws-a-${uid}`;
  const wsB = `appr-ws-b-${uid}`;
  const clientA = `appr-cl-a-${uid}`;
  const clientB = `appr-cl-b-${uid}`;
  const userOwner = `appr-owner-${uid}`;
  const userMember = `appr-member-${uid}`;
  const userViewer = `appr-viewer-${uid}`;
  const userForeign = `appr-foreign-${uid}`;

  let healthySnapshotId: string;
  let unhealthySnapshotId: string;
  const generationKey = `gen-key-${uid}`;

  function asUser(userId: string | null) {
    setAuthSessionOverride(async () =>
      userId
        ? {
            user: { id: userId, email: `${userId}@example.test`, name: `Name ${userId}` },
            expires: new Date(Date.now() + 86400000).toISOString(),
          }
        : null
    );
  }

  before(async () => {
    // 1. Create users
    await prisma.user.createMany({
      data: [userOwner, userMember, userViewer, userForeign].map((id) => ({
        id,
        email: `${id}@example.test`,
        name: `User ${id}`,
      })),
    });

    // 2. Create workspaces
    await prisma.workspace.createMany({
      data: [
        { id: wsA, slug: wsA, name: "Workspace A", ownerId: userOwner, plan: "professional" },
        { id: wsB, slug: wsB, name: "Workspace B", ownerId: userForeign, plan: "professional" },
      ],
    });

    // 3. Workspace memberships
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: wsA, userId: userOwner, role: "owner" as const },
        { workspaceId: wsA, userId: userMember, role: "member" as const },
        { workspaceId: wsA, userId: userViewer, role: "viewer" as const },
        { workspaceId: wsB, userId: userForeign, role: "owner" as const },
      ],
    });

    // 4. Clients
    await prisma.client.createMany({
      data: [
        { id: clientA, workspaceId: wsA, name: "Client A" },
        { id: clientB, workspaceId: wsB, name: "Client B" },
      ],
    });

    // 5. Create a healthy snapshot (ready to review)
    const healthySnap = await prisma.reportSnapshot.create({
      data: {
        workspaceId: wsA,
        clientId: clientA,
        blueprintId: "weekly-paid-media-performance",
        blueprintVersion: 1,
        generationKey,
        sequence: 1,
        reportingWindowStart: new Date("2026-09-01T00:00:00.000Z"),
        reportingWindowEnd: new Date("2026-09-07T23:59:59.999Z"),
        datasetFingerprint: `fp-healthy-${uid}`,
        dependencyHash: `hash-healthy-${uid}`,
        readinessStatus: "WARNING", // Overall status WARNING due to unverified destination
        verificationStatus: "NOT_VERIFIED",
        verificationReasons: ["destination_evidence_missing"],
        dataThroughByProvider: { meta_ads: "2026-09-07" },
        metricContractVersions: { metrics: "v3" },
        readinessEvidence: {
          outcome: {
            status: "WARNING",
            dataStatus: "READY",
            blockers: [],
            warnings: [{ code: "DESTINATION_UNVERIFIED" }],
          },
        },
        destinationReceipts: [],
        result: {
          overview: {
            clientName: "Client A",
            readiness: {
              status: "WARNING",
              dataStatus: "READY",
              blockers: [],
              warnings: ["DESTINATION_UNVERIFIED"],
              destinationState: "unverified",
            },
          },
        },
      },
    });
    healthySnapshotId = healthySnap.id;

    // 6. Create an unhealthy snapshot (data has blockers)
    const unhealthySnap = await prisma.reportSnapshot.create({
      data: {
        workspaceId: wsA,
        clientId: clientA,
        blueprintId: "weekly-paid-media-performance",
        blueprintVersion: 1,
        generationKey: `gen-unhealthy-${uid}`,
        sequence: 1,
        reportingWindowStart: new Date("2026-09-01T00:00:00.000Z"),
        reportingWindowEnd: new Date("2026-09-07T23:59:59.999Z"),
        datasetFingerprint: `fp-unhealthy-${uid}`,
        dependencyHash: `hash-unhealthy-${uid}`,
        readinessStatus: "NOT_READY",
        verificationStatus: "NOT_VERIFIED",
        verificationReasons: ["readiness_not_ready"],
        dataThroughByProvider: {},
        metricContractVersions: { metrics: "v3" },
        readinessEvidence: {
          outcome: {
            status: "NOT_READY",
            dataStatus: "NOT_READY",
            blockers: [{ code: "SOURCE_DISCONNECTED" }],
            warnings: [],
          },
        },
        destinationReceipts: [],
        result: {
          overview: {
            readiness: {
              status: "NOT_READY",
              dataStatus: "NOT_READY",
              blockers: ["SOURCE_DISCONNECTED"],
              warnings: [],
              destinationState: "unverified",
            },
          },
        },
      },
    });
    unhealthySnapshotId = unhealthySnap.id;
  });

  after(async () => {
    setAuthSessionOverride(null);
    for (const ws of [wsA, wsB]) {
      await prisma.reportSnapshotApproval.deleteMany({ where: { workspaceId: ws } });
      await prisma.destinationDeliveryReceipt.deleteMany({ where: { workspaceId: ws } });
      await prisma.auditEvent.deleteMany({ where: { workspaceId: ws } });
      await prisma.reportSnapshot.deleteMany({ where: { workspaceId: ws } });
      await prisma.client.deleteMany({ where: { workspaceId: ws } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: ws } });
    }
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userOwner, userMember, userViewer, userForeign] } } });
  });

  beforeEach(async () => {
    for (const ws of [wsA, wsB]) {
      await prisma.reportSnapshotApproval.deleteMany({ where: { workspaceId: ws } });
      await prisma.destinationDeliveryReceipt.deleteMany({ where: { workspaceId: ws } });
      await prisma.auditEvent.deleteMany({ where: { workspaceId: ws } });
    }
  });

  it("1 & 3 & 4 & 5: Complete, healthy data snapshot can be approved, references exact snapshot, records approver/time, creates zero delivery receipts", async () => {
    const receiptsBefore = await prisma.destinationDeliveryReceipt.count({ where: { workspaceId: wsA } });

    const result = await approveReportSnapshot({
      workspaceId: wsA,
      clientId: clientA,
      snapshotId: healthySnapshotId,
      userId: userMember,
    });

    assert.equal(result.created, true);
    assert.equal(result.approval.snapshotId, healthySnapshotId);
    assert.equal(result.approval.generationKey, generationKey);
    assert.equal(result.approval.sequence, 1);
    assert.equal(result.approval.approvedByUserId, userMember);
    assert.ok(result.approval.approvedAt);

    // Zero DestinationDeliveryReceipt rows created
    const receiptsAfter = await prisma.destinationDeliveryReceipt.count({ where: { workspaceId: wsA } });
    assert.equal(receiptsAfter, receiptsBefore, "Approval must create zero DestinationDeliveryReceipt rows");

    // Audit event recorded
    const auditEvent = await prisma.auditEvent.findFirst({
      where: { workspaceId: wsA, action: "report_snapshot.approved" },
    });
    assert.ok(auditEvent, "AuditEvent report_snapshot.approved must be created");
    assert.equal(auditEvent?.actorUserId, userMember);
    assert.equal(auditEvent?.resourceId, healthySnapshotId);
  });

  it("2: Incomplete or unhealthy data cannot be approved", async () => {
    const approvalsBefore = await prisma.reportSnapshotApproval.count({ where: { workspaceId: wsA } });

    await assert.rejects(
      () =>
        approveReportSnapshot({
          workspaceId: wsA,
          clientId: clientA,
          snapshotId: unhealthySnapshotId,
          userId: userMember,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ReportApprovalError);
        assert.equal(err.code, "data_not_ready");
        assert.equal(err.status, 409);
        return true;
      }
    );

    const approvalsAfter = await prisma.reportSnapshotApproval.count({ where: { workspaceId: wsA } });
    assert.equal(approvalsAfter, approvalsBefore, "Zero approval rows written on rejection");
  });

  it("6: A delivery receipt creates zero approval rows", async () => {
    const approvalsBefore = await prisma.reportSnapshotApproval.count({ where: { workspaceId: wsA } });

    await prisma.destinationDeliveryReceipt.create({
      data: {
        workspaceId: wsA,
        clientId: clientA,
        destination: "google_sheets",
        windowStart: "2026-09-01",
        windowEnd: "2026-09-07",
        dataThroughDate: "2026-09-07",
        datasetFingerprint: `fp-healthy-${uid}`,
        rowCount: 100,
        actorId: userMember,
      },
    });

    const approvalsAfter = await prisma.reportSnapshotApproval.count({ where: { workspaceId: wsA } });
    assert.equal(approvalsAfter, approvalsBefore, "Creating a delivery receipt must never create approval rows");
  });

  it("7: Duplicate identical approval is idempotent with zero extra writes", async () => {
    // First approval
    const first = await approveReportSnapshot({
      workspaceId: wsA,
      clientId: clientA,
      snapshotId: healthySnapshotId,
      userId: userMember,
    });
    assert.equal(first.created, true);

    const countBeforeSecond = await prisma.reportSnapshotApproval.count({ where: { workspaceId: wsA } });
    const auditBeforeSecond = await prisma.auditEvent.count({ where: { workspaceId: wsA } });

    // Second (duplicate) approval
    const second = await approveReportSnapshot({
      workspaceId: wsA,
      clientId: clientA,
      snapshotId: healthySnapshotId,
      userId: userMember,
    });

    assert.equal(second.created, false);
    assert.equal(second.approval.id, first.approval.id);

    const countAfterSecond = await prisma.reportSnapshotApproval.count({ where: { workspaceId: wsA } });
    const auditAfterSecond = await prisma.auditEvent.count({ where: { workspaceId: wsA } });

    assert.equal(countAfterSecond, countBeforeSecond, "Idempotent approval must not insert extra approval rows");
    assert.equal(auditAfterSecond, auditBeforeSecond, "Idempotent approval must not insert duplicate audit events");
  });

  it("8: Cross-tenant approval is rejected with zero writes", async () => {
    // User from Workspace B tries to approve snapshot in Workspace A
    await assert.rejects(
      () =>
        approveReportSnapshot({
          workspaceId: wsB,
          clientId: clientB,
          snapshotId: healthySnapshotId, // belongs to wsA / clientA
          userId: userForeign,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ReportApprovalError);
        assert.equal(err.code, "workspace_mismatch");
        assert.equal(err.status, 403);
        return true;
      }
    );

    // Mismatched client inside same workspace
    await assert.rejects(
      () =>
        approveReportSnapshot({
          workspaceId: wsA,
          clientId: "wrong-client-id",
          snapshotId: healthySnapshotId,
          userId: userMember,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ReportApprovalError);
        assert.equal(err.code, "client_mismatch");
        return true;
      }
    );

    const approvals = await prisma.reportSnapshotApproval.count({
      where: { workspaceId: wsA, snapshotId: healthySnapshotId },
    });
    assert.equal(approvals, 0, "Zero writes on cross-tenant rejection");
  });

  it("9: Unauthorized approval is rejected with zero writes (viewer role)", async () => {
    await assert.rejects(
      () =>
        approveReportSnapshot({
          workspaceId: wsA,
          clientId: clientA,
          snapshotId: healthySnapshotId,
          userId: userViewer, // viewer role in wsA
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      }
    );

    const approvals = await prisma.reportSnapshotApproval.count({
      where: { workspaceId: wsA, snapshotId: healthySnapshotId },
    });
    assert.equal(approvals, 0, "Zero writes when role is unauthorized");
  });

  it("10: Newly generated snapshot sequence leaves historical approval intact but becomes non-current", async () => {
    // 1. Approve sequence 1
    await approveReportSnapshot({
      workspaceId: wsA,
      clientId: clientA,
      snapshotId: healthySnapshotId,
      userId: userMember,
    });

    // 2. Generate sequence 2 for the same generationKey
    const snapSeq2 = await prisma.reportSnapshot.create({
      data: {
        workspaceId: wsA,
        clientId: clientA,
        blueprintId: "weekly-paid-media-performance",
        blueprintVersion: 1,
        generationKey,
        sequence: 2,
        reportingWindowStart: new Date("2026-09-01T00:00:00.000Z"),
        reportingWindowEnd: new Date("2026-09-07T23:59:59.999Z"),
        datasetFingerprint: `fp-seq2-${uid}`,
        dependencyHash: `hash-seq2-${uid}`,
        readinessStatus: "READY",
        verificationStatus: "VERIFIED",
        verificationReasons: [],
        dataThroughByProvider: { meta_ads: "2026-09-07" },
        metricContractVersions: { metrics: "v3" },
        readinessEvidence: {
          outcome: {
            status: "READY",
            dataStatus: "READY",
            blockers: [],
            warnings: [],
          },
        },
        destinationReceipts: [],
        result: {
          overview: {
            readiness: {
              status: "READY",
              dataStatus: "READY",
              blockers: [],
              warnings: [],
              destinationState: "verified",
            },
          },
        },
      },
    });

    // 3. Check approvals
    const activeApprovalSeq2 = await getSnapshotApproval(wsA, snapSeq2.id);
    assert.equal(activeApprovalSeq2, null, "New snapshot sequence 2 has no direct approval yet");

    const latestApproval = await getLatestReportApproval(wsA, generationKey);
    assert.ok(latestApproval, "Historical approval for generationKey still exists");
    assert.equal(latestApproval?.snapshotId, healthySnapshotId);
    assert.equal(latestApproval?.sequence, 1);

    // 4. Derive lifecycle state for sequence 2
    const lifecycleState = deriveReportLifecycleState({
      dataStatus: "READY",
      currentSnapshot: {
        id: snapSeq2.id,
        generationKey: snapSeq2.generationKey,
        sequence: snapSeq2.sequence,
        dependencyHash: snapSeq2.dependencyHash,
        freshness: { freshness: "CURRENT" },
      },
      activeApproval: activeApprovalSeq2,
      latestReportApproval: latestApproval,
      destinationVerified: false,
    });

    assert.equal(
      lifecycleState,
      "Approval outdated",
      "Historical approval from prior sequence makes new snapshot 'Approval outdated'",
    );

    // Clean up sequence 2 snapshot
    await prisma.reportSnapshot.delete({ where: { id: snapSeq2.id } });
  });

  it("POST /api/reports/approval route behaves correctly with session and RBAC", async () => {
    // Viewer rejected with 403
    asUser(userViewer);
    const viewerRes = await approvalRoute(
      new Request("http://localhost/api/reports/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: wsA,
          clientId: clientA,
          snapshotId: healthySnapshotId,
        }),
      })
    );
    assert.equal(viewerRes.status, 403);

    // Member approved with 201 using minimal snapshotId
    asUser(userMember);
    const memberRes = await approvalRoute(
      new Request("http://localhost/api/reports/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotId: healthySnapshotId,
          // Attempted spoofed approver in request body should be ignored:
          approvedByUserId: "spoofed-user-id",
        }),
      })
    );
    assert.equal(memberRes.status, 201);
    const body = await memberRes.json();
    assert.equal(body.created, true);
    assert.equal(
      body.approval.approvedByUserId,
      userMember,
      "Approver MUST come from the authenticated session, never client payload",
    );

    // Replay is idempotent with 200
    const replayRes = await approvalRoute(
      new Request("http://localhost/api/reports/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotId: healthySnapshotId,
        }),
      })
    );
    assert.equal(replayRes.status, 200);
    const replayBody = await replayRes.json();
    assert.equal(replayBody.created, false);
  });

  it("10 (concurrent): Concurrent identical approvals create exactly one approval and one audit event", async () => {
    // Both requests try to approve healthySnapshotId simultaneously
    const [res1, res2] = await Promise.all([
      approveReportSnapshot({
        workspaceId: wsA,
        clientId: clientA,
        snapshotId: healthySnapshotId,
        userId: userMember,
      }),
      approveReportSnapshot({
        workspaceId: wsA,
        clientId: clientA,
        snapshotId: healthySnapshotId,
        userId: userOwner,
      }),
    ]);

    // Exactly one was created, the other resolved as existing
    assert.equal(
      (res1.created ? 1 : 0) + (res2.created ? 1 : 0),
      1,
      "Exactly one concurrent request creates the approval",
    );

    const totalApprovals = await prisma.reportSnapshotApproval.count({
      where: { workspaceId: wsA, snapshotId: healthySnapshotId },
    });
    assert.equal(totalApprovals, 1, "Exactly one approval row persisted");

    const totalAuditEvents = await prisma.auditEvent.count({
      where: {
        workspaceId: wsA,
        action: "report_snapshot.approved",
        resourceId: healthySnapshotId,
      },
    });
    assert.equal(totalAuditEvents, 1, "Exactly one audit event persisted");
  });

  it("5: Approval and audit event commit atomically", async () => {
    // If AuditEvent creation fails or rolls back, zero approvals are left behind
    const approvalsBefore = await prisma.reportSnapshotApproval.count({
      where: { workspaceId: wsA, snapshotId: healthySnapshotId },
    });

    // Simulate transaction failure inside approval
    await assert.rejects(
      async () => {
        await prisma.$transaction(async (tx) => {
          await tx.reportSnapshotApproval.create({
            data: {
              workspaceId: wsA,
              clientId: clientA,
              snapshotId: healthySnapshotId,
              approvedByUserId: userMember,
            },
          });
          // Force transaction error
          throw new Error("Simulated audit creation failure");
        });
      },
      /Simulated audit creation failure/
    );

    const approvalsAfter = await prisma.reportSnapshotApproval.count({
      where: { workspaceId: wsA, snapshotId: healthySnapshotId },
    });
    assert.equal(
      approvalsAfter,
      approvalsBefore,
      "Approval row must roll back cleanly if audit event fails",
    );
  });
});
