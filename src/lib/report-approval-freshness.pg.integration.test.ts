import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  approveReportSnapshot,
  ReportApprovalError,
  _setApprovalTestHooks,
} from "./report-approval";
import {
  computeGenerationKey,
  comparisonWindowFor,
  loadCurrentDependencyState,
  computeDependencyHash,
  extractApprovalReadinessEvidence,
  reopenWeeklyBlueprint,
} from "./report-blueprint";
import { assertAllowedTestDatabase } from "./pg-test-discipline";
import { setAuthSessionOverride } from "./auth-session";

/**
 * PostgreSQL Integration: Report Approval Transaction-Snapshot Freshness & Concurrency
 *
 * Owner semantic decision:
 * - Report Lifecycle v1 uses transaction-snapshot freshness, not global commit-time freshness.
 * - An approval certifies the immutable ReportSnapshot and the canonical dependencies
 *   visible from the consistent PostgreSQL transaction snapshot used for approval.
 * - Relevant changes committed BEFORE the approval transaction's dependency snapshot
 *   are detected and rejected with 409 snapshot_stale and zero writes.
 * - A warehouse or configuration mutation that overlaps approval after its evaluation point
 *   may commit; the approval remains preserved as historical evidence, and the next
 *   lifecycle recomputation immediately classifies it as OUTDATED.
 * - Delivery receipts and destination-only evidence remain independent and do not
 *   invalidate data approval.
 * - Advisory locking serializes snapshot generation and duplicate approvals for the
 *   same generationKey.
 */

const POLL_INTERVAL_MS = 10;
const POLL_MAX_TRIES = 2_000;

async function waitForCondition(condition: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < POLL_MAX_TRIES; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Deterministic barrier not established: ${label}`);
}

describe("PostgreSQL integration: approval transaction-snapshot freshness & concurrency", () => {
  let db2: PrismaClient;

  const suffix = `appr-fresh-${Date.now()}`;
  const userId = `fresh-owner-${suffix}`;
  const wsId = `fresh-ws-${suffix}`;
  const clientId = `fresh-client-${suffix}`;
  const connId = `fresh-conn-${suffix}`;

  const window = { start: "2026-09-01", end: "2026-09-07" };
  const comparisonWindow = comparisonWindowFor(window);
  const windowStart = new Date("2026-09-01T00:00:00.000Z");
  const windowEnd = new Date("2026-09-07T23:59:59.999Z");

  const generationKey = computeGenerationKey(wsId, clientId, window, comparisonWindow);

  before(async () => {
    const url = process.env.DATABASE_URL;
    assertAllowedTestDatabase(url);
    db2 = new PrismaClient({ datasources: { db: { url } } });
    await db2.$connect();

    await prisma.user.create({
      data: { id: userId, email: `${userId}@example.test`, name: "Freshness Owner" },
    });
    await prisma.workspace.create({
      data: { id: wsId, slug: wsId, name: "Freshness WS", ownerId: userId, plan: "professional" },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: wsId, userId, role: "owner" },
    });
    await prisma.client.create({
      data: {
        id: clientId,
        workspaceId: wsId,
        name: "Freshness Client",
        requiredProviders: ["meta_ads"],
        requiredDestinations: ["google_sheets"],
        requirementsConfiguredAt: new Date("2026-08-20T00:00:00.000Z"),
        accountAssignmentsConfiguredAt: new Date("2026-08-20T00:00:00.000Z"),
      },
    });
    await prisma.connection.create({
      data: {
        id: connId,
        workspaceId: wsId,
        clientId,
        name: "Freshness Meta",
        type: "source",
        provider: "meta_ads",
        credentials: "enc:v1:test",
        remoteAccountId: "act_fresh_1",
        status: "connected",
        lastSyncAt: new Date(),
      },
    });
    await prisma.clientProviderAccountAssignment.create({
      data: { workspaceId: wsId, clientId, provider: "meta_ads", accountId: "act_fresh_1", connectionId: connId },
    });
    await prisma.accountReportingContext.create({
      data: {
        workspaceId: wsId,
        connectionId: connId,
        accountId: "act_fresh_1",
        providerTimezone: "Asia/Ho_Chi_Minh",
        providerCurrency: "VND",
        providerObservedAt: new Date(),
      },
    });

    const dates = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"];
    for (const d of dates) {
      await prisma.campaignMetric.create({
        data: {
          workspaceId: wsId,
          connectionId: connId,
          accountId: "act_fresh_1",
          platform: "meta_ads",
          date: new Date(`${d}T00:00:00.000Z`),
          campaignId: `cmp_fresh_${suffix}`,
          entityId: `cmp_fresh_${suffix}`,
          level: "campaign",
          campaignName: "Freshness Campaign",
          spend: 100000,
          impressions: 1000,
          clicks: 50,
          conversions: 5,
          revenue: 500000,
          currency: "VND",
        },
      });
    }
  });

  after(async () => {
    _setApprovalTestHooks({});
    setAuthSessionOverride(null);
    await db2.$disconnect();
    await prisma.reportSnapshotApproval.deleteMany({ where: { workspaceId: wsId } });
    await prisma.destinationDeliveryReceipt.deleteMany({ where: { workspaceId: wsId } });
    await prisma.auditEvent.deleteMany({ where: { workspaceId: wsId } });
    await prisma.campaignMetric.deleteMany({ where: { workspaceId: wsId } });
    await prisma.accountReportingContext.deleteMany({ where: { workspaceId: wsId } });
    await prisma.clientProviderAccountAssignment.deleteMany({ where: { workspaceId: wsId } });
    await prisma.reportSnapshot.deleteMany({ where: { workspaceId: wsId } });
    await prisma.connection.deleteMany({ where: { workspaceId: wsId } });
    await prisma.client.deleteMany({ where: { workspaceId: wsId } });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId: wsId } });
    await prisma.workspace.deleteMany({ where: { id: wsId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  beforeEach(async () => {
    _setApprovalTestHooks({});
    await prisma.reportSnapshotApproval.deleteMany({ where: { workspaceId: wsId } });
    await prisma.destinationDeliveryReceipt.deleteMany({ where: { workspaceId: wsId } });
    await prisma.auditEvent.deleteMany({ where: { workspaceId: wsId } });
    await prisma.reportSnapshot.deleteMany({ where: { workspaceId: wsId } });
  });

  async function createCanonicalSnapshot(seq: number = 1): Promise<{ id: string; dependencyHash: string }> {
    const depState = await loadCurrentDependencyState(
      { workspaceId: wsId, clientId, reportingWindowStart: windowStart, reportingWindowEnd: windowEnd },
      prisma,
    );
    const depHash = computeDependencyHash(depState);
    const snap = await prisma.reportSnapshot.create({
      data: {
        workspaceId: wsId,
        clientId,
        blueprintId: "weekly-paid-media-performance",
        blueprintVersion: 1,
        generationKey,
        sequence: seq,
        reportingWindowStart: windowStart,
        reportingWindowEnd: windowEnd,
        datasetFingerprint: depState.datasetFingerprint,
        dependencyHash: depHash,
        readinessStatus: "WARNING",
        verificationStatus: "NOT_VERIFIED",
        verificationReasons: ["destination_evidence_missing"],
        dataThroughByProvider: { meta_ads: "2026-09-07" },
        metricContractVersions: { metrics: "v3" },
        readinessEvidence: {
          evaluatedAt: new Date().toISOString(),
          evidenceIdentifier: depHash,
          dependencyState: depState,
        },
        destinationReceipts: [],
        result: {
          overview: {
            clientName: "Freshness Client",
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
    return { id: snap.id, dependencyHash: depHash };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // A. Metric change committed before approval begins
  // ───────────────────────────────────────────────────────────────────────────
  it("A: Metric change committed before approval begins rejects with 409 snapshot_stale and zero writes", async () => {
    const snap = await createCanonicalSnapshot();

    // Commit a warehouse metric mutation BEFORE approval is invoked
    const extraMetric = await prisma.campaignMetric.create({
      data: {
        workspaceId: wsId,
        connectionId: connId,
        accountId: "act_fresh_1",
        platform: "meta_ads",
        date: new Date("2026-09-05T00:00:00.000Z"),
        campaignId: `cmp_extra_pre_${suffix}`,
        entityId: `cmp_extra_pre_${suffix}`,
        level: "campaign",
        campaignName: "Pre-Approval Extra Campaign",
        spend: 50000,
        impressions: 500,
        clicks: 25,
        conversions: 2,
        revenue: 250000,
        currency: "VND",
      },
    });

    const approvalsBefore = await prisma.reportSnapshotApproval.count({ where: { workspaceId: wsId } });
    const auditBefore = await prisma.auditEvent.count({ where: { workspaceId: wsId } });

    await assert.rejects(
      async () => {
        await approveReportSnapshot({ workspaceId: wsId, clientId, snapshotId: snap.id, userId });
      },
      (err: unknown) => {
        assert.ok(err instanceof ReportApprovalError);
        assert.equal(err.code, "snapshot_stale");
        assert.equal(err.status, 409);
        assert.match(err.message, /dataset_changed/);
        return true;
      },
    );

    const approvalsAfter = await prisma.reportSnapshotApproval.count({ where: { workspaceId: wsId } });
    const auditAfter = await prisma.auditEvent.count({ where: { workspaceId: wsId } });
    assert.equal(approvalsAfter, approvalsBefore, "Zero approval rows written on pre-existing stale data");
    assert.equal(auditAfter, auditBefore, "Zero audit events written on pre-existing stale data");

    await prisma.campaignMetric.delete({ where: { id: extraMetric.id } });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // B. Metric change overlapping approval after its dependency snapshot point
  // ───────────────────────────────────────────────────────────────────────────
  it("B: Metric change overlapping approval after dependency snapshot point allows approval to commit, but Blueprint recomputation marks it OUTDATED", async () => {
    const snap = await createCanonicalSnapshot();
    let warehouseWriteCommitted = false;
    let hookFired = false;

    _setApprovalTestHooks({
      afterFreshnessCheck: async () => {
        hookFired = true;
        await waitForCondition(() => warehouseWriteCommitted, "warehouse write committed from db2");
      },
    });

    const approvalPromise = approveReportSnapshot({
      workspaceId: wsId, clientId, snapshotId: snap.id, userId,
    });

    await waitForCondition(() => hookFired, "hook reached after freshness evaluation");

    // db2 commits a warehouse metric mutation AFTER the approval tx snapshot was taken
    const extraMetric = await db2.campaignMetric.create({
      data: {
        workspaceId: wsId,
        connectionId: connId,
        accountId: "act_fresh_1",
        platform: "meta_ads",
        date: new Date("2026-09-04T00:00:00.000Z"),
        campaignId: `cmp_extra_overlap_${suffix}`,
        entityId: `cmp_extra_overlap_${suffix}`,
        level: "campaign",
        campaignName: "Overlapping Extra Campaign",
        spend: 77777,
        impressions: 777,
        clicks: 33,
        conversions: 3,
        revenue: 333333,
        currency: "VND",
      },
    });
    warehouseWriteCommitted = true;

    const approvalResult = await approvalPromise;
    _setApprovalTestHooks({});

    // Transaction-snapshot freshness: approval committed against its own evaluation snapshot
    assert.equal(approvalResult.created, true, "Approval committed against its valid evaluation snapshot");
    assert.equal(approvalResult.approval.snapshotId, snap.id);

    // Exactly one historical approval and one audit event exist
    const approvalCount = await prisma.reportSnapshotApproval.count({ where: { workspaceId: wsId, snapshotId: snap.id } });
    const auditCount = await prisma.auditEvent.count({ where: { workspaceId: wsId, action: "report_snapshot.approved", resourceId: snap.id } });
    assert.equal(approvalCount, 1, "Exactly one historical approval row exists");
    assert.equal(auditCount, 1, "Exactly one audit event exists");

    // No delivery receipt was created
    const receiptCount = await prisma.destinationDeliveryReceipt.count({ where: { workspaceId: wsId } });
    assert.equal(receiptCount, 0, "Zero delivery receipts created during approval");

    // Next lifecycle recomputation (reopenWeeklyBlueprint) immediately reports approvalStatus OUTDATED
    const reopened = await reopenWeeklyBlueprint({
      workspaceId: wsId,
      clientId,
      windowStart: window.start,
      windowEnd: window.end,
    });

    assert.ok(reopened.snapshot, "Snapshot must reopen");
    assert.equal(reopened.snapshot.freshness.freshness, "STALE", "Recomputed freshness must be STALE due to metric write");
    assert.ok(reopened.snapshot.freshness.staleReasons.includes("dataset_changed"), "Stale reason must include dataset_changed");
    assert.ok(reopened.approval, "Historical approval must be returned");
    assert.equal(reopened.approval.snapshotId, snap.id);
    assert.equal(reopened.lifecycle.approvalStatus, "OUTDATED", "approvalStatus must be OUTDATED on live recomputation");
    assert.equal(reopened.lifecycle.summaryLabel, "Approval outdated", "summaryLabel must be Approval outdated");
    assert.equal(reopened.lifecycleState, "Approval outdated");

    await db2.campaignMetric.delete({ where: { id: extraMetric.id } });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // C. Client requirements changed before approval begins
  // ───────────────────────────────────────────────────────────────────────────
  it("C: Client requirements changed before approval rejects as stale with zero writes", async () => {
    const snap = await createCanonicalSnapshot();

    const origClient = await prisma.client.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId: wsId, id: clientId } },
    });

    // Mutate requirements before approval
    await prisma.client.update({
      where: { workspaceId_id: { workspaceId: wsId, id: clientId } },
      data: {
        requiredProviders: ["meta_ads", "google_ads"],
        requirementsConfiguredAt: new Date("2026-09-02T00:00:00.000Z"),
      },
    });

    const approvalsBefore = await prisma.reportSnapshotApproval.count({ where: { workspaceId: wsId } });

    await assert.rejects(
      async () => {
        await approveReportSnapshot({ workspaceId: wsId, clientId, snapshotId: snap.id, userId });
      },
      (err: unknown) => {
        assert.ok(err instanceof ReportApprovalError);
        assert.equal(err.code, "snapshot_stale");
        assert.equal(err.status, 409);
        assert.match(err.message, /requirement_changed/);
        return true;
      },
    );

    const approvalsAfter = await prisma.reportSnapshotApproval.count({ where: { workspaceId: wsId } });
    assert.equal(approvalsAfter, approvalsBefore, "Zero approval rows written when requirements changed pre-approval");

    // Restore client requirements
    await prisma.client.update({
      where: { workspaceId_id: { workspaceId: wsId, id: clientId } },
      data: {
        requiredProviders: origClient.requiredProviders,
        requirementsConfiguredAt: origClient.requirementsConfiguredAt,
      },
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // D. Client requirements changed after approval's evaluation point
  // ───────────────────────────────────────────────────────────────────────────
  it("D: Client requirements changed after approval leaves historical approval intact and marks lifecycle OUTDATED", async () => {
    const snap = await createCanonicalSnapshot();

    const approvalResult = await approveReportSnapshot({
      workspaceId: wsId, clientId, snapshotId: snap.id, userId,
    });
    assert.equal(approvalResult.created, true);

    const origClient = await prisma.client.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId: wsId, id: clientId } },
    });

    // Mutate requirements after approval is committed
    await prisma.client.update({
      where: { workspaceId_id: { workspaceId: wsId, id: clientId } },
      data: {
        requiredProviders: ["meta_ads", "google_ads"],
        requirementsConfiguredAt: new Date("2026-09-02T00:00:00.000Z"),
      },
    });

    // Historical approval remains in database
    const approvalCount = await prisma.reportSnapshotApproval.count({ where: { workspaceId: wsId, snapshotId: snap.id } });
    assert.equal(approvalCount, 1, "Historical approval record is preserved");

    // Recomputation marks lifecycle OUTDATED
    const reopened = await reopenWeeklyBlueprint({
      workspaceId: wsId,
      clientId,
      windowStart: window.start,
      windowEnd: window.end,
    });

    assert.equal(reopened.snapshot?.freshness.freshness, "STALE");
    assert.ok(reopened.snapshot?.freshness.staleReasons.includes("requirement_changed"));
    assert.equal(reopened.lifecycle.approvalStatus, "OUTDATED");
    assert.equal(reopened.lifecycle.summaryLabel, "Approval outdated");

    // Restore client requirements
    await prisma.client.update({
      where: { workspaceId_id: { workspaceId: wsId, id: clientId } },
      data: {
        requiredProviders: origClient.requiredProviders,
        requirementsConfiguredAt: origClient.requirementsConfiguredAt,
      },
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // E. Account assignment and reporting-context changes follow freshness semantics
  // ───────────────────────────────────────────────────────────────────────────
  it("E1: Account assignment change before approval rejects with snapshot_stale and zero writes", async () => {
    const snap = await createCanonicalSnapshot();

    const extraAssignment = await prisma.clientProviderAccountAssignment.create({
      data: {
        workspaceId: wsId,
        clientId,
        provider: "meta_ads",
        accountId: "act_extra_assign",
        connectionId: connId,
      },
    });

    await assert.rejects(
      async () => {
        await approveReportSnapshot({ workspaceId: wsId, clientId, snapshotId: snap.id, userId });
      },
      (err: unknown) => {
        assert.ok(err instanceof ReportApprovalError);
        assert.equal(err.code, "snapshot_stale");
        assert.equal(err.status, 409);
        assert.match(err.message, /account_assignment_changed/);
        return true;
      },
    );

    await prisma.clientProviderAccountAssignment.delete({ where: { id: extraAssignment.id } });
  });

  it("E2: Account assignment change after approval marks lifecycle OUTDATED upon recomputation", async () => {
    const snap = await createCanonicalSnapshot();
    await approveReportSnapshot({ workspaceId: wsId, clientId, snapshotId: snap.id, userId });

    const extraAssignment = await prisma.clientProviderAccountAssignment.create({
      data: {
        workspaceId: wsId,
        clientId,
        provider: "meta_ads",
        accountId: "act_extra_assign_post",
        connectionId: connId,
      },
    });

    const reopened = await reopenWeeklyBlueprint({
      workspaceId: wsId, clientId, windowStart: window.start, windowEnd: window.end,
    });

    assert.equal(reopened.lifecycle.approvalStatus, "OUTDATED");
    assert.equal(reopened.lifecycle.summaryLabel, "Approval outdated");

    await prisma.clientProviderAccountAssignment.delete({ where: { id: extraAssignment.id } });
  });

  it("E3: Reporting-context change after approval marks lifecycle OUTDATED upon recomputation", async () => {
    const snap = await createCanonicalSnapshot();
    await approveReportSnapshot({ workspaceId: wsId, clientId, snapshotId: snap.id, userId });

    // Mutate provider currency in account reporting context
    await prisma.accountReportingContext.update({
      where: {
        workspaceId_connectionId_accountId: {
          workspaceId: wsId,
          connectionId: connId,
          accountId: "act_fresh_1",
        },
      },
      data: { providerCurrency: "USD" },
    });

    const reopened = await reopenWeeklyBlueprint({
      workspaceId: wsId, clientId, windowStart: window.start, windowEnd: window.end,
    });

    assert.equal(reopened.lifecycle.approvalStatus, "OUTDATED");
    assert.equal(reopened.lifecycle.summaryLabel, "Approval outdated");

    // Restore provider currency
    await prisma.accountReportingContext.update({
      where: {
        workspaceId_connectionId_accountId: {
          workspaceId: wsId,
          connectionId: connId,
          accountId: "act_fresh_1",
        },
      },
      data: { providerCurrency: "VND" },
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // F. Receipt-only and destination-only changes do NOT make approval outdated
  // ───────────────────────────────────────────────────────────────────────────
  it("F1: New delivery receipt minted after snapshot and approval preserves approvalStatus APPROVED", async () => {
    const snap = await createCanonicalSnapshot();
    await approveReportSnapshot({ workspaceId: wsId, clientId, snapshotId: snap.id, userId });

    const receipt = await prisma.destinationDeliveryReceipt.create({
      data: {
        workspaceId: wsId,
        clientId,
        destination: "google_sheets",
        windowStart: window.start,
        windowEnd: window.end,
        datasetFingerprint: `fp-${randomUUID()}`,
        dataThroughDate: "2026-09-07",
        rowCount: 7,
        actorId: userId,
        retrievedAt: new Date(),
      },
    });

    const reopened = await reopenWeeklyBlueprint({
      workspaceId: wsId, clientId, windowStart: window.start, windowEnd: window.end,
    });

    assert.equal(reopened.lifecycle.approvalStatus, "APPROVED", "Delivery receipt does NOT invalidate data approval");
    assert.notEqual(reopened.lifecycle.approvalStatus, "OUTDATED");

    await prisma.destinationDeliveryReceipt.delete({ where: { id: receipt.id } });
  });

  it("F2: Changed receipt timestamp preserves approvalStatus APPROVED", async () => {
    const snap = await createCanonicalSnapshot();
    await approveReportSnapshot({ workspaceId: wsId, clientId, snapshotId: snap.id, userId });

    const receipt = await prisma.destinationDeliveryReceipt.create({
      data: {
        workspaceId: wsId, clientId, destination: "google_sheets",
        windowStart: window.start, windowEnd: window.end,
        datasetFingerprint: `fp-${randomUUID()}`,
        dataThroughDate: "2026-09-07", rowCount: 7, actorId: userId,
        retrievedAt: new Date("2026-09-08T09:00:00.000Z"),
      },
    });

    await prisma.destinationDeliveryReceipt.update({
      where: { id: receipt.id },
      data: { retrievedAt: new Date("2026-09-08T18:00:00.000Z") },
    });

    const reopened = await reopenWeeklyBlueprint({
      workspaceId: wsId, clientId, windowStart: window.start, windowEnd: window.end,
    });

    assert.equal(reopened.lifecycle.approvalStatus, "APPROVED", "Receipt timestamp change does not invalidate approval");

    await prisma.destinationDeliveryReceipt.delete({ where: { id: receipt.id } });
  });

  it("F3: extractApprovalReadinessEvidence strips DESTINATION_* blockers and warnings but preserves data fields", () => {
    const fullEvidence = {
      contractVersion: "v1",
      window: { start: "2026-09-01", end: "2026-09-07" },
      requiredProviders: ["meta_ads"],
      requiredProvidersBasis: "explicit",
      requirementsConfiguredAt: "2026-08-20T00:00:00.000Z",
      sources: [{ provider: "meta_ads", status: "healthy" }],
      limited: false,
      outcome: {
        dataStatus: "READY",
        providerStates: { meta_ads: "healthy" },
        blockers: [
          { code: "SOURCE_DISCONNECTED", message: "Source disconnected" },
          { code: "DESTINATION_NOT_CONFIGURED", message: "Dest not configured" },
        ],
        warnings: [
          { code: "INFERRED_REQUIREMENTS", message: "Inferred" },
          { code: "DESTINATION_UNVERIFIED", message: "Dest unverified" },
        ],
        currencies: ["VND"],
        timezones: ["Asia/Ho_Chi_Minh"],
      },
    };

    const projected = extractApprovalReadinessEvidence(fullEvidence) as Record<string, unknown>;
    const outcome = projected.outcome as Record<string, unknown>;
    const blockers = outcome.blockers as Array<{ code: string }>;
    const warnings = outcome.warnings as Array<{ code: string }>;

    assert.ok(!blockers.some((b) => b.code.startsWith("DESTINATION_")), "DESTINATION_* blockers must be stripped");
    assert.ok(!warnings.some((w) => w.code.startsWith("DESTINATION_")), "DESTINATION_* warnings must be stripped");
    assert.deepEqual(outcome.dataStatus, "READY");
    assert.deepEqual(blockers.map((b) => b.code), ["SOURCE_DISCONNECTED"]);
    assert.deepEqual(warnings.map((w) => w.code), ["INFERRED_REQUIREMENTS"]);
    assert.deepEqual(outcome.currencies, ["VND"]);
    assert.deepEqual(outcome.timezones, ["Asia/Ho_Chi_Minh"]);
  });

  it("F4: extractApprovalReadinessEvidence is stable when destination verification state changes", () => {
    const base = {
      contractVersion: "v1",
      outcome: {
        dataStatus: "READY",
        blockers: [],
        warnings: [{ code: "DESTINATION_UNVERIFIED" }],
        currencies: ["VND"],
        timezones: ["Asia/Ho_Chi_Minh"],
      },
    };
    const destinationNowVerified = {
      contractVersion: "v1",
      outcome: {
        dataStatus: "READY",
        blockers: [],
        warnings: [],
        currencies: ["VND"],
        timezones: ["Asia/Ho_Chi_Minh"],
      },
    };

    const proj1 = extractApprovalReadinessEvidence(base);
    const proj2 = extractApprovalReadinessEvidence(destinationNowVerified);

    assert.deepEqual(JSON.stringify(proj1), JSON.stringify(proj2), "Destination verification change must not alter projection");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // G. Concurrent identical approvals remain idempotent
  // ───────────────────────────────────────────────────────────────────────────
  it("G: Concurrent identical approvals are serialized by advisory lock and produce exactly one approval and one audit event", async () => {
    const snap = await createCanonicalSnapshot();

    const results = await Promise.allSettled([
      approveReportSnapshot({ workspaceId: wsId, clientId, snapshotId: snap.id, userId }),
      approveReportSnapshot({ workspaceId: wsId, clientId, snapshotId: snap.id, userId }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof approveReportSnapshot>>>[];
    assert.equal(fulfilled.length, 2, "Both concurrent approval calls must resolve");

    const approvalCount = await prisma.reportSnapshotApproval.count({ where: { workspaceId: wsId, snapshotId: snap.id } });
    const auditCount = await prisma.auditEvent.count({ where: { workspaceId: wsId, action: "report_snapshot.approved", resourceId: snap.id } });
    assert.equal(approvalCount, 1, "Exactly one approval row exists in DB");
    assert.equal(auditCount, 1, "Exactly one audit event exists in DB");

    const createdCount = fulfilled.filter((r) => r.value.created).length;
    assert.equal(createdCount, 1, "Exactly one call created the record (other returned idempotent result)");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Failing-First Evidence
  // ───────────────────────────────────────────────────────────────────────────
  it("Failing-first evidence: _setApprovalTestHooks is exported", () => {
    assert.equal(typeof _setApprovalTestHooks, "function", "_setApprovalTestHooks must be exported from report-approval");
  });

  it("Failing-first evidence: extractApprovalReadinessEvidence is exported", () => {
    assert.equal(typeof extractApprovalReadinessEvidence, "function", "extractApprovalReadinessEvidence must be exported from report-blueprint");
  });

  it("Failing-first evidence: destination warnings/blockers are stripped in projection", () => {
    const evidence = {
      outcome: {
        dataStatus: "READY",
        blockers: [{ code: "DESTINATION_NOT_CONFIGURED" }],
        warnings: [{ code: "DESTINATION_UNVERIFIED" }],
      },
    };
    const projected = extractApprovalReadinessEvidence(evidence) as Record<string, unknown>;
    const outcome = projected.outcome as Record<string, unknown>;
    const blockers = outcome.blockers as Array<{ code: string }>;
    const warnings = outcome.warnings as Array<{ code: string }>;
    assert.equal(blockers.length, 0);
    assert.equal(warnings.length, 0);
  });
});
