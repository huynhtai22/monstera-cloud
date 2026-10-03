import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  evaluateAndPersistMonitorEvidence,
  computeDatasetFingerprint,
  type MetricInputRecord,
} from "./monitor-evidence";
import {
  agentConsoleTransaction,
  createApproval,
  consumeApproval,
  computeCanonicalScopeHash,
} from "./persistence";
import { ingestTiktokRows, ingestTiktokRowsBulk } from "../ad-platform-ingest";

describe("C3 Monitor Evidence Service against real PostgreSQL (Hardened)", () => {
  const db = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);

  const ownerId = `user-c3-owner-${suffix}`;
  const workspaceIdA = `ws-c3-a-${suffix}`;
  const workspaceIdB = `ws-c3-b-${suffix}`;
  const connA = `conn-c3-a-${suffix}`;
  const connB = `conn-c3-b-${suffix}`;
  const ttAccountA = `act_tt_a_${suffix}`;
  const ttAccountB = `act_tt_b_${suffix}`;
  const respIdA = `resp-c3-a-${suffix}`;
  const respIdB = `resp-c3-b-${suffix}`;

  const canonicalScopeHashA = computeCanonicalScopeHash([
    { provider: "tiktok_business", connectionId: connA, providerAccountId: ttAccountA },
  ]);
  const canonicalScopeHashB = computeCanonicalScopeHash([
    { provider: "tiktok_business", connectionId: connB, providerAccountId: ttAccountB },
  ]);

  const asOf = new Date("2026-09-28T12:00:00.000Z");

  // As of Sep 28 with lag 1:
  // Current: Sep 20 to Sep 26 (7 days)
  // Baseline: Sep 13 to Sep 19 (7 days)
  const currentDates = [
    "2026-09-20",
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
  ];
  const baselineDates = [
    "2026-09-13",
    "2026-09-14",
    "2026-09-15",
    "2026-09-16",
    "2026-09-17",
    "2026-09-18",
    "2026-09-19",
  ];

  const defaultRawData = JSON.stringify({
    endpoint: "ad/report",
    grain: "campaign",
    conversionAction: "purchase",
    attributionWindow: "7d_click",
    revenueBasis: "order_completed",
    availability: "final",
    provenanceOrigin: "provider_response",
  });

  before(async () => {
    // 1. Create owner user
    await db.user.create({
      data: { id: ownerId, email: `c3-owner-${suffix}@example.test`, name: "C3 Owner", plan: "professional" },
    });

    // 2. Create workspaces
    await db.workspace.create({
      data: { id: workspaceIdA, name: "Workspace A", slug: `ws-a-${suffix}`, ownerId, plan: "professional", status: "ACTIVE" },
    });
    await db.workspace.create({
      data: { id: workspaceIdB, name: "Workspace B", slug: `ws-b-${suffix}`, ownerId, plan: "professional", status: "ACTIVE" },
    });

    await db.workspaceMember.createMany({
      data: [
        { workspaceId: workspaceIdA, userId: ownerId, role: "owner" },
        { workspaceId: workspaceIdB, userId: ownerId, role: "owner" },
      ],
    });

    // 3. Create connections with fresh status and complete data-through
    await db.connection.create({
      data: {
        id: connA,
        workspaceId: workspaceIdA,
        name: "TikTok Conn A",
        type: "source",
        provider: "tiktok_business",
        credentials: "enc",
        remoteAccountId: ttAccountA,
        status: "connected",
        lastSyncAt: new Date("2026-09-28T06:00:00Z"), // 6h ago (fresh)
        lastDataThrough: new Date("2026-09-26T23:59:59Z"), // covers current window
      },
    });

    await db.connection.create({
      data: {
        id: connB,
        workspaceId: workspaceIdB,
        name: "TikTok Conn B",
        type: "source",
        provider: "tiktok_business",
        credentials: "enc",
        remoteAccountId: ttAccountB,
        status: "connected",
        lastSyncAt: new Date("2026-09-28T06:00:00Z"),
        lastDataThrough: new Date("2026-09-26T23:59:59Z"),
      },
    });

    // 4. Create active responsibility in Workspace A
    await db.agentResponsibility.create({
      data: {
        id: respIdA,
        workspaceId: workspaceIdA,
        ownerId,
        createdByUserId: ownerId,
        kind: "monitoring",
        status: "active",
        version: 1,
        scopeRevision: 1,
        policyRevision: 1,
        timezone: "America/New_York",
        cadence: "daily",
        scopeHash: canonicalScopeHashA,
        configuration: { targetCpa: 25.0, cpaFloor: 20 },
      },
    });

    await db.agentResponsibilityScope.create({
      data: {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        scopeRevision: 1,
        connectionId: connA,
        provider: "tiktok_business",
        providerAccountId: ttAccountA,
        accountName: "Client A TikTok Account",
        currency: "USD",
        timezone: "America/New_York",
      },
    });

    await db.agentAuthorization.create({
      data: {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        scopeRevision: 1,
        policyRevision: 1,
        authorizingUserId: ownerId,
        scopeHash: canonicalScopeHashA,
        allowlistedTools: ["inspect_source", "query_metric_window", "verify_coverage", "submit_recovery_import"],
        allowedPairs: [
          { provider: "tiktok_business", connectionId: connA, providerAccountId: ttAccountA },
        ],
        expiresAt: new Date("2026-10-15T00:00:00Z"),
      },
    });

    // 5. Create active responsibility in Workspace B
    await db.agentResponsibility.create({
      data: {
        id: respIdB,
        workspaceId: workspaceIdB,
        ownerId,
        createdByUserId: ownerId,
        kind: "monitoring",
        status: "active",
        version: 1,
        scopeRevision: 1,
        policyRevision: 1,
        timezone: "America/New_York",
        cadence: "daily",
        scopeHash: canonicalScopeHashB,
        configuration: { targetCpa: 25.0, cpaFloor: 20 },
      },
    });

    await db.agentResponsibilityScope.create({
      data: {
        workspaceId: workspaceIdB,
        responsibilityId: respIdB,
        scopeRevision: 1,
        connectionId: connB,
        provider: "tiktok_business",
        providerAccountId: ttAccountB,
        accountName: "Client B TikTok Account",
        currency: "USD",
        timezone: "America/New_York",
      },
    });

    await db.agentAuthorization.create({
      data: {
        workspaceId: workspaceIdB,
        responsibilityId: respIdB,
        scopeRevision: 1,
        policyRevision: 1,
        authorizingUserId: ownerId,
        scopeHash: canonicalScopeHashB,
        allowlistedTools: ["inspect_source", "query_metric_window", "verify_coverage", "submit_recovery_import"],
        allowedPairs: [
          { provider: "tiktok_business", connectionId: connB, providerAccountId: ttAccountB },
        ],
        expiresAt: new Date("2026-10-15T00:00:00Z"),
      },
    });

    // 6. Seed CampaignMetric rows for Workspace A across both baseline and current windows
    const allDates = [...baselineDates, ...currentDates];
    const rowsA = allDates.map((d, idx) => ({
      workspaceId: workspaceIdA,
      connectionId: connA,
      platform: "tiktok_business",
      accountId: ttAccountA,
      accountName: "Client A TikTok Account",
      level: "campaign",
      entityId: `camp_${idx}`,
      campaignId: `camp_${idx}`,
      campaignName: `Campaign ${idx}`,
      date: new Date(`${d}T00:00:00.000Z`),
      spend: 100.0 + idx * 10,
      conversions: 5 + idx,
      revenue: 0,
      currency: "USD",
      rawData: defaultRawData,
    }));

    await db.campaignMetric.createMany({ data: rowsA });

    // 7. Seed CampaignMetric rows for Workspace B
    const rowsB = allDates.map((d, idx) => ({
      workspaceId: workspaceIdB,
      connectionId: connB,
      platform: "tiktok_business",
      accountId: ttAccountB,
      accountName: "Client B TikTok Account",
      level: "campaign",
      entityId: `camp_b_${idx}`,
      campaignId: `camp_b_${idx}`,
      campaignName: `Campaign B ${idx}`,
      date: new Date(`${d}T00:00:00.000Z`),
      spend: 200.0 + idx * 10,
      conversions: 10 + idx,
      revenue: 0,
      currency: "USD",
      rawData: defaultRawData,
    }));

    await db.campaignMetric.createMany({ data: rowsB });
  });

  after(async () => {
    await db.campaignMetric.deleteMany({
      where: { workspaceId: { in: [workspaceIdA, workspaceIdB] } },
    });
    await db.agentApproval.deleteMany({
      where: { workspaceId: { in: [workspaceIdA, workspaceIdB] } },
    });
    await db.agentOperation.deleteMany({
      where: { workspaceId: { in: [workspaceIdA, workspaceIdB] } },
    });
    await db.agentCase.deleteMany({
      where: { workspaceId: { in: [workspaceIdA, workspaceIdB] } },
    });
    await db.agentEvidenceSnapshot.deleteMany({
      where: { workspaceId: { in: [workspaceIdA, workspaceIdB] } },
    });
    await db.agentAuthorization.deleteMany({
      where: { workspaceId: { in: [workspaceIdA, workspaceIdB] } },
    });
    await db.agentResponsibilityScope.deleteMany({
      where: { workspaceId: { in: [workspaceIdA, workspaceIdB] } },
    });
    await db.agentResponsibility.deleteMany({
      where: { workspaceId: { in: [workspaceIdA, workspaceIdB] } },
    });
    await db.agentConsoleEvent.deleteMany({
      where: { workspaceId: { in: [workspaceIdA, workspaceIdB] } },
    });
    await db.agentEventSequence.deleteMany({
      where: { workspaceId: { in: [workspaceIdA, workspaceIdB] } },
    });
    await db.connection.deleteMany({
      where: { workspaceId: { in: [workspaceIdA, workspaceIdB] } },
    });
    await db.workspace.deleteMany({
      where: { id: { in: [workspaceIdA, workspaceIdB] } },
    });
    await db.user.deleteMany({
      where: { id: ownerId },
    });
    await db.$disconnect();
  });

  it("1. Application Service Boundary: loads persisted entities and persists immutable evidence and console event", async () => {
    const result = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    assert.equal(result.evaluationResult.valid, true);
    assert.ok(result.snapshot.id);
    assert.equal(result.snapshot.workspaceId, workspaceIdA);
    assert.equal(result.snapshot.datasetFingerprint, result.evaluationResult.datasetFingerprint);
    assert.equal(result.evaluationResult.isSynthetic, true);

    // Verify audit event persisted in PostgreSQL
    const event = await db.agentConsoleEvent.findFirst({
      where: {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        type: "evidence_snapshot_recorded",
      },
      orderBy: { sequence: "desc" },
    });
    assert.ok(event);
    assert.equal((event.payload as any).snapshotId, result.snapshot.id);
    assert.equal((event.payload as any).fingerprint, result.snapshot.datasetFingerprint);
  });

  it("2. Missing Baseline: incomplete baseline blocks comparison and never assumes zero baseline", async () => {
    // Delete baseline rows for 2026-09-17 and 2026-09-18
    await db.campaignMetric.deleteMany({
      where: {
        workspaceId: workspaceIdA,
        date: { in: [new Date("2026-09-17T00:00:00Z"), new Date("2026-09-18T00:00:00Z")] },
      },
    });

    const result = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    assert.equal(result.evaluationResult.valid, false);
    assert.ok(result.evaluationResult.blockers.includes("WINDOW_INCOMPLETE"));
    assert.ok(result.evaluationResult.metrics);

    // Proves comparison is blocked, not defaulted to 0
    assert.equal(result.evaluationResult.metrics.comparisonBlocked, true);
    assert.equal(result.evaluationResult.metrics.comparisonBlockReason, "BASELINE_WINDOW_INCOMPLETE");
    assert.equal(result.evaluationResult.metrics.spendDelta, null);
    assert.equal(result.evaluationResult.metrics.spendDeltaRatio, null);
    assert.equal(result.evaluationResult.metrics.conversionDelta, null);

    // Restore baseline rows for subsequent tests
    await db.campaignMetric.createMany({
      data: [
        {
          workspaceId: workspaceIdA,
          connectionId: connA,
          platform: "tiktok_business",
          accountId: ttAccountA,
          level: "campaign",
          entityId: "camp_restore_17",
          date: new Date("2026-09-17T00:00:00Z"),
          spend: 140.0,
          conversions: 9,
          revenue: 0,
          currency: "USD",
          rawData: defaultRawData,
        },
        {
          workspaceId: workspaceIdA,
          connectionId: connA,
          platform: "tiktok_business",
          accountId: ttAccountA,
          level: "campaign",
          entityId: "camp_restore_18",
          date: new Date("2026-09-18T00:00:00Z"),
          spend: 150.0,
          conversions: 10,
          revenue: 0,
          currency: "USD",
          rawData: defaultRawData,
        },
      ],
    });
  });

  it("3. Stale or Unknown Freshness: connection with old lastSyncAt triggers DATA_STALE", async () => {
    // Set connection lastSyncAt to 48 hours ago
    await db.connection.update({
      where: { id: connA },
      data: { lastSyncAt: new Date("2026-09-26T00:00:00Z") },
    });

    const result = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    assert.equal(result.evaluationResult.valid, false);
    assert.ok(result.evaluationResult.blockers.includes("DATA_STALE"));

    // Reset lastSyncAt
    await db.connection.update({
      where: { id: connA },
      data: { lastSyncAt: new Date("2026-09-28T06:00:00Z") },
    });
  });

  it("4. Row Currency Mismatch: row currency conflicting with roster is rejected", async () => {
    // Insert row with EUR currency for account expecting USD
    const rogueRow = await db.campaignMetric.create({
      data: {
        workspaceId: workspaceIdA,
        connectionId: connA,
        platform: "tiktok_business",
        accountId: ttAccountA,
        level: "campaign",
        entityId: "camp_rogue_curr",
        date: new Date("2026-09-25T00:00:00Z"),
        spend: 50.0,
        conversions: 2,
        revenue: 0,
        currency: "EUR", // Mismatch!
      },
    });

    const result = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    assert.equal(result.evaluationResult.valid, false);
    assert.ok(result.evaluationResult.blockers.includes("CURRENCY_CONFLICT"));

    // Clean up rogue row
    await db.campaignMetric.delete({ where: { id: rogueRow.id } });
  });

  it("5. Duplicate & Overlapping Breakdowns: overlapping breakdowns are rejected with GRAIN_AMBIGUOUS", async () => {
    // Insert overlapping breakdown row
    const overlapRow = await db.campaignMetric.create({
      data: {
        workspaceId: workspaceIdA,
        connectionId: connA,
        platform: "tiktok_business",
        accountId: ttAccountA,
        level: "campaign",
        entityId: "camp_7", // Same entity as existing row for 2026-09-20
        date: new Date("2026-09-20T00:00:00Z"),
        breakdownHash: "placement=feed", // Overlapping breakdown!
        spend: 30.0,
        conversions: 1,
        revenue: 0,
        currency: "USD",
      },
    });

    const result = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    assert.equal(result.evaluationResult.valid, false);
    assert.ok(result.evaluationResult.blockers.includes("GRAIN_AMBIGUOUS"));

    await db.campaignMetric.delete({ where: { id: overlapRow.id } });
  });

  it("6. Foreign Scope Rejection: accessing foreign responsibility or workspace fails closed", async () => {
    await assert.rejects(
      async () => {
        await agentConsoleTransaction(async (tx) => {
          return evaluateAndPersistMonitorEvidence(tx, {
            workspaceId: workspaceIdB, // Workspace B does not have responsibility respIdA
            responsibilityId: respIdA,
            actorUserId: ownerId,
            executionMode: "local_test",
            asOf,
          });
        }, db);
      },
      (err: any) => {
        assert.equal(err.code, "responsibility_not_found");
        assert.equal(err.status, 404);
        return true;
      }
    );
  });

  it("7. Sub-Four-Decimal Corrections: modifying spend by 0.0001 changes fingerprint", async () => {
    const resInitial = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    const targetRow = await db.campaignMetric.findFirstOrThrow({
      where: { workspaceId: workspaceIdA, date: new Date("2026-09-20T00:00:00Z") },
    });

    // Update by sub-cent 0.0001
    await db.campaignMetric.update({
      where: { id: targetRow.id },
      data: { spend: targetRow.spend + 0.0001 },
    });

    const resSubCent = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    assert.notEqual(
      resInitial.evaluationResult.datasetFingerprint,
      resSubCent.evaluationResult.datasetFingerprint,
      "Sub-cent precision (4th decimal) modification must alter the dataset fingerprint",
    );

    // Restore row
    await db.campaignMetric.update({
      where: { id: targetRow.id },
      data: { spend: targetRow.spend },
    });
  });

  it("8. Reordered Tied Rows: deterministic sorting produces identical fingerprint regardless of insertion order", () => {
    const ctx = {
      workspaceId: workspaceIdA,
      accountScope: [{ canonicalId: "c1", currency: "USD", timezone: "America/New_York" }],
      currentWindow: { since: "2026-09-20", until: "2026-09-26", daysCount: 7, dates: currentDates },
      baselineWindow: { since: "2026-09-13", until: "2026-09-19", daysCount: 7, dates: baselineDates },
      timezone: "America/New_York",
      grain: "campaign",
      provenance: {},
      zeroReceipts: [],
      calculationVersion: 1,
    };

    const row1: MetricInputRecord = { id: "id_1", date: "2026-09-20", platform: "tiktok_business", connectionId: "c1", accountId: "a1", level: "campaign", entityId: "e1", spend: 100, conversions: 5, revenue: 0 };
    const row2: MetricInputRecord = { id: "id_2", date: "2026-09-20", platform: "tiktok_business", connectionId: "c1", accountId: "a1", level: "campaign", entityId: "e1", spend: 100, conversions: 5, revenue: 0 };

    const fp1 = computeDatasetFingerprint(ctx, [row1, row2]);
    const fp2 = computeDatasetFingerprint(ctx, [row2, row1]);
    assert.equal(fp1, fp2);
  });

  it("9a. Unchanged-evidence success: valid authorization and proposal with unchanged evidence consumes successfully", async () => {
    const initialEvidence = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    const caseRecord = await db.agentCase.create({
      data: {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        fingerprint: `fp-test-case-success-${suffix}`,
        episode: 1,
        title: "Test CPA Case Success",
        state: "detected",
      },
    });

    const opRecord = await db.agentOperation.create({
      data: {
        workspaceId: workspaceIdA,
        caseId: caseRecord.id,
        toolName: "submit_recovery_import",
        arguments: { connectionId: connA, targetWindowDays: 7 },
        scopeHash: canonicalScopeHashA,
        operationKey: `op-key-success-${suffix}`,
        state: "queued",
        policyRevision: 1,
      },
    });

    const approval = await agentConsoleTransaction(async (tx) => {
      return createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: opRecord.id,
        approverUserId: ownerId,
        proposalHash: "prop_hash_valid_success",
        evidenceFingerprint: initialEvidence.snapshot.datasetFingerprint,
        policyRevision: 1,
        evidenceRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 3600000),
      });
    }, db);

    // Consume approval on unchanged evidence
    const consumed = await agentConsoleTransaction(async (tx) => {
      return consumeApproval(tx, {
        workspaceId: workspaceIdA,
        approvalId: approval.id,
        operationId: opRecord.id,
        actorUserId: ownerId,
        proposalHash: "prop_hash_valid_success",
        evidenceFingerprint: initialEvidence.snapshot.datasetFingerprint,
        policyRevision: 1,
        evidenceRevision: 1,
        scopeRevision: 1,
      });
    }, db);

    assert.equal(consumed.status, "consumed");
    assert.equal(consumed.isSingleUseConsumed, true);
    assert.ok(consumed.consumedAt);
  });

  it("9b. Unrelated-scope correction: modifying metrics in unrelated scope does not invalidate approval for unchanged scope", async () => {
    const evidenceA = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    const caseRecordA = await db.agentCase.create({
      data: {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        fingerprint: `fp-test-case-unrelated-${suffix}`,
        episode: 1,
        title: "Test CPA Case Unrelated",
        state: "detected",
      },
    });

    const opRecordA = await db.agentOperation.create({
      data: {
        workspaceId: workspaceIdA,
        caseId: caseRecordA.id,
        toolName: "submit_recovery_import",
        arguments: { connectionId: connA, targetWindowDays: 7 },
        scopeHash: canonicalScopeHashA,
        operationKey: `op-key-unrelated-${suffix}`,
        state: "queued",
        policyRevision: 1,
      },
    });

    const approvalA = await agentConsoleTransaction(async (tx) => {
      return createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: opRecordA.id,
        approverUserId: ownerId,
        proposalHash: "prop_hash_unrelated_a",
        evidenceFingerprint: evidenceA.snapshot.datasetFingerprint,
        policyRevision: 1,
        evidenceRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 3600000),
      });
    }, db);

    // Modify metrics in UNRELATED scope (Workspace B) and generate new snapshot for Workspace B
    const rowB = await db.campaignMetric.findFirstOrThrow({
      where: { workspaceId: workspaceIdB },
    });
    await db.campaignMetric.update({
      where: { id: rowB.id },
      data: { spend: rowB.spend + 500 },
    });
    await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdB,
        responsibilityId: respIdB,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    // Consume approval for Resp A with original bindings -> MUST SUCCEED because Resp A's evidence is unchanged
    const consumedA = await agentConsoleTransaction(async (tx) => {
      return consumeApproval(tx, {
        workspaceId: workspaceIdA,
        approvalId: approvalA.id,
        operationId: opRecordA.id,
        actorUserId: ownerId,
        proposalHash: "prop_hash_unrelated_a",
        evidenceFingerprint: evidenceA.snapshot.datasetFingerprint,
        policyRevision: 1,
        evidenceRevision: 1,
        scopeRevision: 1,
      });
    }, db);

    assert.equal(consumedA.status, "consumed");
    assert.equal(consumedA.isSingleUseConsumed, true);
  });

  it("9c. Unchanged-binding rejection after correction: late corrections invalidate prior approvals when attempted with original proposal hash and fingerprint", async () => {
    // 1. Generate an initial evidence snapshot for Resp A
    const initialEvidence = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    // 2. Create case and operation
    const caseRecord = await db.agentCase.create({
      data: {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        fingerprint: `fp-test-case-inval-${suffix}`,
        episode: 1,
        title: "Test CPA Case Inval",
        state: "detected",
      },
    });

    const opRecord = await db.agentOperation.create({
      data: {
        workspaceId: workspaceIdA,
        caseId: caseRecord.id,
        toolName: "submit_recovery_import",
        arguments: { connectionId: connA, targetWindowDays: 7 },
        scopeHash: canonicalScopeHashA,
        operationKey: `op-key-inval-${suffix}`,
        state: "queued",
        policyRevision: 1,
      },
    });

    // 3. Create interactive approval bound to initial snapshot's fingerprint
    const approval = await agentConsoleTransaction(async (tx) => {
      return createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: opRecord.id,
        approverUserId: ownerId,
        proposalHash: "prop_hash_original_valid",
        evidenceFingerprint: initialEvidence.snapshot.datasetFingerprint,
        policyRevision: 1,
        evidenceRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 3600000),
      });
    }, db);

    // 4. Perform a late correction in CampaignMetric (attribution update for 2026-09-21)
    const rowToCorrect = await db.campaignMetric.findFirstOrThrow({
      where: { workspaceId: workspaceIdA, date: new Date("2026-09-21T00:00:00Z") },
    });
    await db.campaignMetric.update({
      where: { id: rowToCorrect.id },
      data: { conversions: rowToCorrect.conversions + 10 },
    });

    // 5. Generate superseding evidence snapshot
    const supersedingEvidence = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    assert.notEqual(
      initialEvidence.snapshot.datasetFingerprint,
      supersedingEvidence.snapshot.datasetFingerprint,
    );

    // 6. Attempting to consume the approval with the ORIGINAL proposal hash, fingerprint, and revisions
    // must be REJECTED specifically because evidence changed (superseded)
    await assert.rejects(
      async () => {
        await agentConsoleTransaction(async (tx) => {
          return consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: approval.id,
            operationId: opRecord.id,
            actorUserId: ownerId,
            proposalHash: "prop_hash_original_valid", // EXACT ORIGINAL PROPOSAL HASH
            evidenceFingerprint: initialEvidence.snapshot.datasetFingerprint, // ORIGINAL FINGERPRINT
            policyRevision: 1,
            evidenceRevision: 1,
            scopeRevision: 1,
          });
        }, db);
      },
      (err: any) => {
        assert.equal(err.code, "evidence_superseded");
        assert.ok(err.message.includes("superseded by a newer dataset"));
        return true;
      }
    );
  });

  it("10. Snapshot Immutability: changing underlying database metrics never mutates existing snapshot records", async () => {
    const initial = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    const snapshotId = initial.snapshot.id;
    const originalFingerprint = initial.snapshot.datasetFingerprint;
    const originalMetrics = JSON.stringify(initial.snapshot.metrics);

    await db.campaignMetric.updateMany({
      where: { workspaceId: workspaceIdA },
      data: { spend: 999.99 },
    });

    const reloaded = await db.agentEvidenceSnapshot.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId: workspaceIdA, id: snapshotId } },
    });

    assert.equal(reloaded.datasetFingerprint, originalFingerprint);
    assert.equal(JSON.stringify(reloaded.metrics), originalMetrics);
  });

  it("11. Missing Account Metadata: missing currency or timezone metadata blocks evaluation with explicit reason and never guesses USD or America/New_York", async () => {
    const unmetaRespId = `resp-unmeta-${suffix}`;
    await db.agentResponsibility.create({
      data: {
        id: unmetaRespId,
        workspaceId: workspaceIdA,
        ownerId,
        createdByUserId: ownerId,
        kind: "monitoring",
        status: "active",
        version: 1,
        scopeRevision: 1,
        policyRevision: 1,
        timezone: "", // Empty timezone!
        cadence: "daily",
        scopeHash: "hash_unmeta",
        configuration: { targetCpa: 25.0 },
      },
    });

    await db.agentResponsibilityScope.create({
      data: {
        workspaceId: workspaceIdA,
        responsibilityId: unmetaRespId,
        scopeRevision: 1,
        connectionId: connA,
        provider: "tiktok_business",
        providerAccountId: "act_missing_meta",
        accountName: "Missing Meta Account",
        currency: "", // Empty currency!
        timezone: "", // Empty timezone!
      },
    });

    await db.agentAuthorization.create({
      data: {
        workspaceId: workspaceIdA,
        responsibilityId: unmetaRespId,
        scopeRevision: 1,
        policyRevision: 1,
        authorizingUserId: ownerId,
        scopeHash: "hash_unmeta",
        allowlistedTools: ["inspect_source"],
        allowedPairs: [{ provider: "tiktok_business", connectionId: connA, providerAccountId: "act_missing_meta" }],
        expiresAt: new Date("2026-10-15T00:00:00Z"),
      },
    });

    const result = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: unmetaRespId,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    assert.equal(result.evaluationResult.valid, false);
    assert.ok(result.evaluationResult.blockers.includes("CURRENCY_UNKNOWN"));
    assert.ok(result.evaluationResult.blockers.includes("TIMEZONE_UNKNOWN"));
    assert.ok(
      result.evaluationResult.reasons.some((r) => r.includes("guessing is prohibited") || r.includes("no verified currency"))
    );
  });

  it("12. Absent Confirmation: unconfirmed draft scope without active AgentAuthorization blocks with ROSTER_UNCONFIRMED", async () => {
    const unconfirmedRespId = `resp-unconf-${suffix}`;
    await db.agentResponsibility.create({
      data: {
        id: unconfirmedRespId,
        workspaceId: workspaceIdA,
        ownerId,
        createdByUserId: ownerId,
        kind: "monitoring",
        status: "active",
        version: 1,
        scopeRevision: 1,
        policyRevision: 1,
        timezone: "America/New_York",
        cadence: "daily",
        scopeHash: "hash_unconf",
        configuration: { targetCpa: 25.0 },
      },
    });

    await db.agentResponsibilityScope.create({
      data: {
        workspaceId: workspaceIdA,
        responsibilityId: unconfirmedRespId,
        scopeRevision: 1,
        connectionId: connA,
        provider: "tiktok_business",
        providerAccountId: ttAccountA,
        currency: "USD",
        timezone: "America/New_York",
      },
    });
    // Intentionally omit AgentAuthorization!

    const result = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: unconfirmedRespId,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    assert.equal(result.evaluationResult.valid, false);
    assert.ok(result.evaluationResult.blockers.includes("ROSTER_UNCONFIRMED"));
    assert.ok(
      result.evaluationResult.reasons.some((r) => r.includes("Unconfirmed draft scopes cannot be monitored") || r.includes("missing authoritative scope confirmation"))
    );
  });

  it("13. Incomplete Freshness Evidence: missing health evidence for scoped connection blocks with DATA_STALE", async () => {
    const connStale = `conn-stale-${suffix}`;
    await db.connection.create({
      data: {
        id: connStale,
        workspaceId: workspaceIdA,
        name: "Stale Connection",
        type: "source",
        provider: "tiktok_business",
        credentials: "enc",
        remoteAccountId: "act_stale",
        status: "connected",
        lastSyncAt: null, // Never synced!
        lastDataThrough: null,
      },
    });

    const staleRespId = `resp-stale-conn-${suffix}`;
    await db.agentResponsibility.create({
      data: {
        id: staleRespId,
        workspaceId: workspaceIdA,
        ownerId,
        createdByUserId: ownerId,
        kind: "monitoring",
        status: "active",
        version: 1,
        scopeRevision: 1,
        policyRevision: 1,
        timezone: "America/New_York",
        cadence: "daily",
        scopeHash: "hash_stale_conn",
        configuration: { targetCpa: 25.0 },
      },
    });

    await db.agentResponsibilityScope.create({
      data: {
        workspaceId: workspaceIdA,
        responsibilityId: staleRespId,
        scopeRevision: 1,
        connectionId: connStale,
        provider: "tiktok_business",
        providerAccountId: "act_stale",
        currency: "USD",
        timezone: "America/New_York",
      },
    });

    await db.agentAuthorization.create({
      data: {
        workspaceId: workspaceIdA,
        responsibilityId: staleRespId,
        scopeRevision: 1,
        policyRevision: 1,
        authorizingUserId: ownerId,
        scopeHash: "hash_stale_conn",
        allowlistedTools: ["inspect_source"],
        allowedPairs: [{ provider: "tiktok_business", connectionId: connStale, providerAccountId: "act_stale" }],
        expiresAt: new Date("2026-10-15T00:00:00Z"),
      },
    });

    const result = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: staleRespId,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    assert.equal(result.evaluationResult.valid, false);
    assert.ok(result.evaluationResult.blockers.includes("DATA_STALE"));
    assert.ok(
      result.evaluationResult.reasons.some((r) => r.includes("never completed a sync") || r.includes("missing or unverified source health evidence"))
    );
  });

  it("14. Provider-Required Lag: derives required lag from provider capability registry and enforces complete-day window excluding today and lag days", async () => {
    // For TikTok Ads, dataAvailabilityLagDays in registry is 1 day.
    // When asOf is 2026-09-28T12:00:00Z, today is 2026-09-28.
    // When user requests lagDays: 0 (or omits it), provider registry requires at least 1 day.
    // With lagDays: 1, today (Sep 28) and 1 lag day (Sep 27) are excluded.
    // Therefore, the current window MUST end on 2026-09-26 and start on 2026-09-20.
    const result = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
        lagDays: 0, // User requests 0 days, but provider registry requires at least 1 day!
      });
    }, db);

    assert.equal(result.evaluationResult.actualUntil, "2026-09-26");
    assert.equal(result.evaluationResult.actualSince, "2026-09-20");
    const prov = result.snapshot.provenance as any;
    assert.equal(prov.lagDays, 1);
  });

  it("15. Incompatible Attribution Window: rows with conflicting attribution window block with SEMANTICS_UNKNOWN", async () => {
    const badAttributionRow = await db.campaignMetric.create({
      data: {
        workspaceId: workspaceIdA,
        connectionId: connA,
        platform: "tiktok_business",
        accountId: ttAccountA,
        level: "campaign",
        entityId: "camp_bad_attr",
        date: new Date("2026-09-25T00:00:00Z"),
        spend: 50.0,
        conversions: 2,
        revenue: 0,
        currency: "USD",
        rawData: JSON.stringify({
          endpoint: "ad/report",
          grain: "campaign",
          attributionWindow: "28d_click", // Incompatible with expected 7d_click!
          availability: "final",
        }),
      },
    });

    const result = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
        expectedAttributionWindow: "7d_click",
      });
    }, db);

    assert.equal(result.evaluationResult.valid, false);
    assert.ok(result.evaluationResult.blockers.includes("SEMANTICS_UNKNOWN"));
    assert.ok(
      result.evaluationResult.reasons.some((r) => r.includes("attribution window '28d_click' conflicting with expected '7d_click'"))
    );

    await db.campaignMetric.delete({ where: { id: badAttributionRow.id } });
  });

  it("16. Legacy Rows Without Provenance: rows lacking normalized provenance context block with SEMANTICS_UNKNOWN", async () => {
    const legacyRow = await db.campaignMetric.create({
      data: {
        workspaceId: workspaceIdA,
        connectionId: connA,
        platform: "tiktok_business",
        accountId: ttAccountA,
        level: "campaign",
        entityId: "camp_legacy_noprov",
        date: new Date("2026-09-24T00:00:00Z"),
        spend: 75.0,
        conversions: 3,
        revenue: 0,
        currency: "USD",
        rawData: null, // Legacy row lacking context!
      },
    });

    const result = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
        validateProvenance: true,
      });
    }, db);

    assert.equal(result.evaluationResult.valid, false);
    assert.ok(result.evaluationResult.blockers.includes("SEMANTICS_UNKNOWN"));
    assert.ok(
      result.evaluationResult.reasons.some((r) => r.includes("legacy record lacking normalized provenance context"))
    );

    await db.campaignMetric.delete({ where: { id: legacyRow.id } });
  });

  it("17. Late Warehouse Correction Without Superseding Snapshot: invalidates approval during consumeApproval", async () => {
    // 1. Generate an initial evidence snapshot for Resp A
    const initialEvidence = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    // 2. Create case and operation
    const caseRecord = await db.agentCase.create({
      data: {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        fingerprint: `fp-test-case-drift-${suffix}`,
        episode: 1,
        title: "Test Drift Case",
        state: "detected",
      },
    });

    const opRecord = await db.agentOperation.create({
      data: {
        workspaceId: workspaceIdA,
        caseId: caseRecord.id,
        toolName: "submit_recovery_import",
        arguments: { connectionId: connA, targetWindowDays: 7 },
        scopeHash: canonicalScopeHashA,
        operationKey: `op-key-drift-${suffix}`,
        state: "queued",
        policyRevision: 1,
      },
    });

    // 3. Create interactive approval bound to initial snapshot's fingerprint
    const approval = await agentConsoleTransaction(async (tx) => {
      return createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: opRecord.id,
        approverUserId: ownerId,
        proposalHash: "prop_hash_drift_test",
        evidenceFingerprint: initialEvidence.snapshot.datasetFingerprint,
        policyRevision: 1,
        evidenceRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 3600000),
      });
    }, db);

    // 4. Modify underlying CampaignMetric row directly in PostgreSQL (NO new evidence snapshot created!)
    const targetRow = await db.campaignMetric.findFirstOrThrow({
      where: { workspaceId: workspaceIdA, date: new Date("2026-09-22T00:00:00Z") },
    });
    const originalSpend = targetRow.spend;
    await db.campaignMetric.update({
      where: { id: targetRow.id },
      data: { spend: originalSpend + 25.5 },
    });

    // 5. Attempt consumption with the original approval and fingerprint -> MUST FAIL with evidence_superseded
    await assert.rejects(
      async () => {
        await agentConsoleTransaction(async (tx) => {
          return consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: approval.id,
            operationId: opRecord.id,
            actorUserId: ownerId,
            proposalHash: "prop_hash_drift_test",
            evidenceFingerprint: initialEvidence.snapshot.datasetFingerprint,
            policyRevision: 1,
            evidenceRevision: 1,
            scopeRevision: 1,
          });
        }, db);
      },
      (err: any) => {
        assert.equal(err.code, "evidence_superseded");
        assert.ok(err.message.includes("Underlying warehouse metrics have drifted or been corrected"));
        return true;
      }
    );

    // 6. Restore original spend -> consumption succeeds
    await db.campaignMetric.update({
      where: { id: targetRow.id },
      data: { spend: originalSpend },
    });

    const consumed = await agentConsoleTransaction(async (tx) => {
      return consumeApproval(tx, {
        workspaceId: workspaceIdA,
        approvalId: approval.id,
        operationId: opRecord.id,
        actorUserId: ownerId,
        proposalHash: "prop_hash_drift_test",
        evidenceFingerprint: initialEvidence.snapshot.datasetFingerprint,
        policyRevision: 1,
        evidenceRevision: 1,
        scopeRevision: 1,
      });
    }, db);
    assert.equal(consumed.status, "consumed");
  });

  it("18. Degraded Sync Health or Stale Sync at Consumption: blocks approval execution with evidence_ineligible", async () => {
    // 1. Generate an initial evidence snapshot for Resp A
    const initialEvidence = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    const caseRecord = await db.agentCase.create({
      data: {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        fingerprint: `fp-test-case-health-${suffix}`,
        episode: 1,
        title: "Test Health Case",
        state: "detected",
      },
    });

    const opRecord = await db.agentOperation.create({
      data: {
        workspaceId: workspaceIdA,
        caseId: caseRecord.id,
        toolName: "submit_recovery_import",
        arguments: { connectionId: connA, targetWindowDays: 7 },
        scopeHash: canonicalScopeHashA,
        operationKey: `op-key-health-${suffix}`,
        state: "queued",
        policyRevision: 1,
      },
    });

    const approval = await agentConsoleTransaction(async (tx) => {
      return createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: opRecord.id,
        approverUserId: ownerId,
        proposalHash: "prop_hash_health_test",
        evidenceFingerprint: initialEvidence.snapshot.datasetFingerprint,
        policyRevision: 1,
        evidenceRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 3600000),
      });
    }, db);

    // Case A: Connection is disconnected
    await db.connection.update({
      where: { id: connA },
      data: { status: "disconnected" },
    });

    await assert.rejects(
      async () => {
        await agentConsoleTransaction(async (tx) => {
          return consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: approval.id,
            operationId: opRecord.id,
            actorUserId: ownerId,
            proposalHash: "prop_hash_health_test",
            evidenceFingerprint: initialEvidence.snapshot.datasetFingerprint,
            policyRevision: 1,
            evidenceRevision: 1,
            scopeRevision: 1,
          });
        }, db);
      },
      (err: any) => {
        assert.equal(err.code, "evidence_ineligible");
        assert.ok(err.message.includes("degraded health status 'disconnected'"));
        return true;
      }
    );

    // Case B: Connection has error
    await db.connection.update({
      where: { id: connA },
      data: { status: "connected", lastError: "token_revoked" },
    });

    await assert.rejects(
      async () => {
        await agentConsoleTransaction(async (tx) => {
          return consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: approval.id,
            operationId: opRecord.id,
            actorUserId: ownerId,
            proposalHash: "prop_hash_health_test",
            evidenceFingerprint: initialEvidence.snapshot.datasetFingerprint,
            policyRevision: 1,
            evidenceRevision: 1,
            scopeRevision: 1,
          });
        }, db);
      },
      (err: any) => {
        assert.equal(err.code, "evidence_ineligible");
        assert.ok(err.message.includes("token_revoked"));
        return true;
      }
    );

    // Case C: Connection sync is stale (>24h relative to reference time)
    await db.connection.update({
      where: { id: connA },
      data: {
        status: "connected",
        lastError: null,
        lastSyncAt: new Date("2026-09-25T00:00:00Z"), // >3 days before asOf Sep 28
      },
    });

    await assert.rejects(
      async () => {
        await agentConsoleTransaction(async (tx) => {
          return consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: approval.id,
            operationId: opRecord.id,
            actorUserId: ownerId,
            proposalHash: "prop_hash_health_test",
            evidenceFingerprint: initialEvidence.snapshot.datasetFingerprint,
            policyRevision: 1,
            evidenceRevision: 1,
            scopeRevision: 1,
          });
        }, db);
      },
      (err: any) => {
        assert.equal(err.code, "evidence_ineligible");
        assert.ok(err.message.includes("data is stale (>24h since last sync)"));
        return true;
      }
    );

    // Restore connection to fresh state
    await db.connection.update({
      where: { id: connA },
      data: {
        status: "connected",
        lastError: null,
        lastSyncAt: new Date("2026-09-28T06:00:00Z"),
      },
    });
  });

  it("19. Deterministic Fingerprint Across Execution Time: later asOf evaluation with unchanged data yields identical fingerprint", async () => {
    const evidenceTime1 = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf: new Date("2026-09-28T12:00:00.000Z"),
      });
    }, db);

    const evidenceTime2 = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf: new Date("2026-09-28T16:30:00.000Z"), // 4.5 hours later!
      });
    }, db);

    assert.equal(
      evidenceTime1.snapshot.datasetFingerprint,
      evidenceTime2.snapshot.datasetFingerprint,
      "Deterministic identity must exclude incidental execution timestamps (asOfTimestamp) when data and windows are identical"
    );
  });

  it("20. Mandatory Semantics Enforcement: missing conversion action, unsupported endpoint, or conflicting definitions block with SEMANTICS_UNKNOWN", async () => {
    // Case A: Missing conversionAction
    const missingActionRow = await db.campaignMetric.create({
      data: {
        workspaceId: workspaceIdA,
        connectionId: connA,
        platform: "tiktok_business",
        accountId: ttAccountA,
        level: "campaign",
        entityId: "camp_missing_action",
        date: new Date("2026-09-24T00:00:00Z"),
        spend: 50.0,
        conversions: 2,
        revenue: 0,
        currency: "USD",
        rawData: JSON.stringify({
          endpoint: "AUCTION_CAMPAIGN",
          grain: "campaign",
          // conversionAction missing!
          attributionWindow: "7d_click",
          availability: "final",
        }),
      },
    });

    const resMissingAction = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    assert.equal(resMissingAction.evaluationResult.valid, false);
    assert.ok(resMissingAction.evaluationResult.blockers.includes("SEMANTICS_UNKNOWN"));
    assert.ok(
      resMissingAction.evaluationResult.reasons.some((r) => r.includes("missing required conversion action context"))
    );
    await db.campaignMetric.delete({ where: { id: missingActionRow.id } });

    // Case B: Unsupported endpoint
    const badEndpointRow = await db.campaignMetric.create({
      data: {
        workspaceId: workspaceIdA,
        connectionId: connA,
        platform: "tiktok_business",
        accountId: ttAccountA,
        level: "campaign",
        entityId: "camp_bad_endpoint",
        date: new Date("2026-09-24T00:00:00Z"),
        spend: 50.0,
        conversions: 2,
        revenue: 0,
        currency: "USD",
        rawData: JSON.stringify({
          endpoint: "UNSUPPORTED_HACK_ENDPOINT",
          grain: "campaign",
          conversionAction: "purchase",
          attributionWindow: "7d_click",
          availability: "final",
        }),
      },
    });

    const resBadEndpoint = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    assert.equal(resBadEndpoint.evaluationResult.valid, false);
    assert.ok(resBadEndpoint.evaluationResult.blockers.includes("SEMANTICS_UNKNOWN"));
    assert.ok(
      resBadEndpoint.evaluationResult.reasons.some((r) => r.includes("unsupported endpoint 'UNSUPPORTED_HACK_ENDPOINT'"))
    );
    await db.campaignMetric.delete({ where: { id: badEndpointRow.id } });

    // Case C: Conflicting conversion actions across rows
    const conflictingActionRow = await db.campaignMetric.create({
      data: {
        workspaceId: workspaceIdA,
        connectionId: connA,
        platform: "tiktok_business",
        accountId: ttAccountA,
        level: "campaign",
        entityId: "camp_conflict_action",
        date: new Date("2026-09-24T00:00:00Z"),
        spend: 50.0,
        conversions: 2,
        revenue: 0,
        currency: "USD",
        rawData: JSON.stringify({
          endpoint: "AUCTION_CAMPAIGN",
          grain: "campaign",
          conversionAction: "lead_generation", // Conflicting with standard 'purchase'!
          attributionWindow: "7d_click",
          availability: "final",
        }),
      },
    });

    const resConflict = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);

    assert.equal(resConflict.evaluationResult.valid, false);
    assert.ok(resConflict.evaluationResult.blockers.includes("SEMANTICS_UNKNOWN"));
    assert.ok(
      resConflict.evaluationResult.reasons.some(
        (r) =>
          r.includes("Incompatible conversion action definitions detected across rows") ||
          r.includes("conflicting with expected")
      )
    );
    await db.campaignMetric.delete({ where: { id: conflictingActionRow.id } });
  });


  it("21. Ingestion Acceptance & End-to-End Evaluation: missing, matching, conflicting semantics and availability", async () => {
    // 21a. Missing source semantics: single-row ingestion succeeds, but affected metric remains blocked
    const ingestMissing = await ingestTiktokRows(
      [
        {
          dimensions: {
            campaign_id: "camp_missing_semantics",
            campaign_name: "Missing Semantics Campaign",
            stat_time_day: "2026-09-25",
          },
          metrics: {
            spend: 50.0,
            impression: 500,
            click: 25,
            conversion: 3,
          },
        },
      ],
      {
        workspaceId: workspaceIdA,
        connectionId: connA,
        accountId: ttAccountA,
        accountName: "Client A TikTok Account",
        providerCurrency: "USD",
        syncJobId: `sync-job-missing-${suffix}`,
      }
    );
    assert.equal(ingestMissing.upserted, 1);

    const rowMissing = await db.campaignMetric.findFirstOrThrow({
      where: { workspaceId: workspaceIdA, connectionId: connA, entityId: "camp_missing_semantics" },
    });
    const parsedMissing = JSON.parse(rowMissing.rawData || "{}");
    assert.equal(parsedMissing.conversionAction, undefined, "Missing semantics must not default to purchase");
    assert.equal(parsedMissing.availability, undefined, "Missing availability must not default to final");

    const evalMissing = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);
    assert.equal(evalMissing.evaluationResult.valid, false);
    assert.ok(evalMissing.evaluationResult.blockers.includes("SEMANTICS_UNKNOWN"));
    assert.ok(
      evalMissing.evaluationResult.reasons.some((r) => r.includes("missing required conversion action context"))
    );
    await db.campaignMetric.delete({ where: { id: rowMissing.id } });

    // 21b. Conflicting source semantics: bulk ingestion with conflicting conversion action blocks evaluation
    const ingestConflicting = await ingestTiktokRowsBulk(
      [
        {
          dimensions: {
            campaign_id: "camp_conflicting_semantics",
            campaign_name: "Conflicting Semantics Campaign",
            stat_time_day: "2026-09-25",
          },
          metrics: {
            spend: 60.0,
            impression: 600,
            click: 30,
            conversion: 4,
          },
        },
      ],
      {
        workspaceId: workspaceIdA,
        connectionId: connA,
        accountId: ttAccountA,
        accountName: "Client A TikTok Account",
        providerCurrency: "USD",
        syncJobId: `sync-job-conflict-${suffix}`,
        provenanceContext: {
          endpoint: "AUCTION_CAMPAIGN",
          grain: "campaign",
          conversionAction: "lead_generation", // Conflicting!
          attributionWindow: "7d_click",
          availability: "final",
          revenueBasis: "order_completed",
          origin: "provider_response",
        },
      }
    );
    assert.equal(ingestConflicting.upserted, 1);

    const rowConflicting = await db.campaignMetric.findFirstOrThrow({
      where: { workspaceId: workspaceIdA, connectionId: connA, entityId: "camp_conflicting_semantics" },
    });
    const evalConflicting = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);
    assert.equal(evalConflicting.evaluationResult.valid, false);
    assert.ok(evalConflicting.evaluationResult.blockers.includes("SEMANTICS_UNKNOWN"));
    await db.campaignMetric.delete({ where: { id: rowConflicting.id } });

    // 21c. Unknown availability: row without availability is never stamped final and evaluation blocks
    const ingestNonFinal = await ingestTiktokRows(
      [
        {
          dimensions: {
            campaign_id: "camp_non_final",
            campaign_name: "Non Final Campaign",
            stat_time_day: "2026-09-25",
          },
          metrics: {
            spend: 70.0,
            impression: 700,
            click: 35,
            conversion: 5,
          },
        },
      ],
      {
        workspaceId: workspaceIdA,
        connectionId: connA,
        accountId: ttAccountA,
        accountName: "Client A TikTok Account",
        providerCurrency: "USD",
        syncJobId: `sync-job-nonfinal-${suffix}`,
        provenanceContext: {
          endpoint: "AUCTION_CAMPAIGN",
          grain: "campaign",
          conversionAction: "purchase",
          attributionWindow: "7d_click",
          revenueBasis: "order_completed",
          origin: "provider_response",
          // availability is omitted
        },
      }
    );
    assert.equal(ingestNonFinal.upserted, 1);

    const rowNonFinal = await db.campaignMetric.findFirstOrThrow({
      where: { workspaceId: workspaceIdA, connectionId: connA, entityId: "camp_non_final" },
    });
    const parsedNonFinal = JSON.parse(rowNonFinal.rawData || "{}");
    assert.equal(parsedNonFinal.availability, undefined, "Missing availability must never be stamped final");

    const evalNonFinal = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);
    assert.equal(evalNonFinal.evaluationResult.valid, false);
    assert.ok(evalNonFinal.evaluationResult.blockers.includes("SEMANTICS_UNKNOWN"));
    assert.ok(
      evalNonFinal.evaluationResult.reasons.some((r) => r.includes("non-final data availability"))
    );
    await db.campaignMetric.delete({ where: { id: rowNonFinal.id } });

    // 21d. Verified matching semantics: bulk ingestion with verified matching semantics evaluates cleanly
    const ingestMatching = await ingestTiktokRowsBulk(
      [
        {
          dimensions: {
            campaign_id: "camp_matching_semantics",
            campaign_name: "Matching Semantics Campaign",
            stat_time_day: "2026-09-25",
          },
          metrics: {
            spend: 80.0,
            impression: 800,
            click: 40,
            conversion: 6,
          },
        },
      ],
      {
        workspaceId: workspaceIdA,
        connectionId: connA,
        accountId: ttAccountA,
        accountName: "Client A TikTok Account",
        providerCurrency: "USD",
        syncJobId: `sync-job-matching-${suffix}`,
        provenanceContext: {
          endpoint: "AUCTION_CAMPAIGN",
          grain: "campaign",
          conversionAction: "purchase",
          attributionWindow: "7d_click",
          availability: "final",
          revenueBasis: "order_completed",
          origin: "provider_response",
        },
      }
    );
    assert.equal(ingestMatching.upserted, 1);

    const rowMatching = await db.campaignMetric.findFirstOrThrow({
      where: { workspaceId: workspaceIdA, connectionId: connA, entityId: "camp_matching_semantics" },
    });
    const parsedMatching = JSON.parse(rowMatching.rawData || "{}");
    assert.equal(parsedMatching.conversionAction, "purchase");
    assert.equal(parsedMatching.availability, "final");
    assert.equal(parsedMatching.provenanceOrigin, "provider_response");

    const evalMatching = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);
    if (!evalMatching.evaluationResult.valid) {
      console.log("EVAL MATCHING FAILED:", evalMatching.evaluationResult.blockers, evalMatching.evaluationResult.reasons);
    }
    assert.equal(evalMatching.evaluationResult.valid, true, "Verified matching semantics must evaluate cleanly");
    await db.campaignMetric.delete({ where: { id: rowMatching.id } });

    // 21d. Populated labels with unverified provenance origin: blocks with SEMANTICS_UNKNOWN
    const ingestUnverifiedOrigin = await ingestTiktokRows(
      [
        {
          dimensions: {
            campaign_id: "camp_unverified_origin",
            campaign_name: "Camp Unverified Origin",
            stat_time_day: "2026-09-20",
          },
          metrics: {
            spend: 50,
            conversions: 5,
            conversion_value: 0,
          },
        },
      ],
      {
        workspaceId: workspaceIdA,
        connectionId: connA,
        accountId: ttAccountA,
        syncJobId: "job_test_unverified_origin",
        provenanceContext: {
          endpoint: "ad/report",
          grain: "campaign",
          conversionAction: "purchase",
          attributionWindow: "7d_click",
          revenueBasis: "order_completed",
          availability: "final",
          origin: "unverified", // Explicitly unverified origin!
        },
      }
    );
    assert.equal(ingestUnverifiedOrigin.upserted, 1);

    const rowUnverified = await db.campaignMetric.findFirstOrThrow({
      where: { workspaceId: workspaceIdA, connectionId: connA, entityId: "camp_unverified_origin" },
    });
    const parsedUnverified = JSON.parse(rowUnverified.rawData || "{}");
    assert.equal(parsedUnverified.provenanceOrigin, "unverified");

    const evalUnverified = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);
    assert.equal(evalUnverified.evaluationResult.valid, false, "Populated labels with unverified origin must block evaluation");
    assert.ok(evalUnverified.evaluationResult.blockers.includes("SEMANTICS_UNKNOWN"));
    assert.ok(evalUnverified.evaluationResult.reasons.some((r) => r.includes("unverified provenance origin 'unverified'")));
    await db.campaignMetric.delete({ where: { id: rowUnverified.id } });
  });


  it("22. Tightened Approval Consumption: lastDataThrough, missing connection, synthetic evidence, and cpaFloor configuration change", async () => {
    // Generate valid baseline evidence snapshot
    const evalValid = await agentConsoleTransaction(async (tx) => {
      return evaluateAndPersistMonitorEvidence(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respIdA,
        actorUserId: ownerId,
        executionMode: "local_test",
        asOf,
      });
    }, db);
    assert.equal(evalValid.evaluationResult.valid, true);

    const { caseRecord } = await agentConsoleTransaction<{ caseRecord: any }>((tx) => {
      return (tx as any).agentCase.create({
        data: {
          workspaceId: workspaceIdA,
          responsibilityId: respIdA,
          fingerprint: `fp_tightened_consumption_${suffix}`,
          title: "Tightened Consumption Case",
          state: "detected",
          episode: 1,
        },
      }).then((c: any) => ({ caseRecord: c }));
    }, db);



    // 22a. Missing lastDataThrough rejects consumption
    const opMissingDt = await agentConsoleTransaction(async (tx) => {
      return (tx as any).agentOperation.create({
        data: {
          workspaceId: workspaceIdA,
          caseId: caseRecord.id,
          operationKey: `op_missing_dt_${suffix}`,
          toolName: "inspect_source",
          arguments: { connectionId: connA, provider: "tiktok_business", adAccountId: ttAccountA },
          scopeHash: canonicalScopeHashA,
          policyRevision: 1,
          state: "queued",
        },
      });
    }, db);

    const approvalMissingDt = await agentConsoleTransaction(async (tx) => {
      return createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: opMissingDt.id,
        proposalHash: "prop_missing_dt",
        evidenceFingerprint: evalValid.snapshot.datasetFingerprint,
        evidenceRevision: 1,
        policyRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
    }, db);

    // Temporarily clear lastDataThrough on connA
    const originalDt = (await db.connection.findUniqueOrThrow({ where: { id: connA } })).lastDataThrough;
    await db.connection.update({
      where: { id: connA },
      data: { lastDataThrough: null },
    });

    await assert.rejects(
      () =>
        agentConsoleTransaction(async (tx) => {
          return consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: approvalMissingDt.id,
            operationId: opMissingDt.id,
            proposalHash: "prop_missing_dt",
            evidenceFingerprint: evalValid.snapshot.datasetFingerprint,
            evidenceRevision: 1,
            policyRevision: 1,
            scopeRevision: 1,
            actorUserId: ownerId,
          });
        }, db),
      (err: any) => err.code === "evidence_ineligible" && err.message.includes("no verified data-through date")
    );

    // Restore lastDataThrough
    await db.connection.update({
      where: { id: connA },
      data: { lastDataThrough: originalDt },
    });

    // 22b. Synthetic evidence cannot authorize live production execution
    const opLiveProd = await agentConsoleTransaction(async (tx) => {
      return (tx as any).agentOperation.create({
        data: {
          workspaceId: workspaceIdA,
          caseId: caseRecord.id,
          operationKey: `op_live_prod_${suffix}`,
          toolName: "inspect_source",
          arguments: {
            connectionId: connA,
            provider: "tiktok_business",
            adAccountId: ttAccountA,
            executionMode: "live_production", // Production execution!
          },
          scopeHash: canonicalScopeHashA,
          policyRevision: 1,
          state: "queued",
        },
      });
    }, db);

    const approvalLiveProd = await agentConsoleTransaction(async (tx) => {
      return createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: opLiveProd.id,
        proposalHash: "prop_live_prod",
        evidenceFingerprint: evalValid.snapshot.datasetFingerprint,
        evidenceRevision: 1,
        policyRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
    }, db);

    await assert.rejects(
      () =>
        agentConsoleTransaction(async (tx) => {
          return consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: approvalLiveProd.id,
            operationId: opLiveProd.id,
            proposalHash: "prop_live_prod",
            evidenceFingerprint: evalValid.snapshot.datasetFingerprint,
            evidenceRevision: 1,
            policyRevision: 1,
            scopeRevision: 1,
            actorUserId: ownerId,
          });
        }, db),
      (err: any) => err.code === "evidence_ineligible" && err.message.includes("Synthetic test evidence cannot authorize live production execution")
    );

    // 22c. Changed configuration (cpaFloor) invalidates prior approval
    const opCpaFloor = await agentConsoleTransaction(async (tx) => {
      return (tx as any).agentOperation.create({
        data: {
          workspaceId: workspaceIdA,
          caseId: caseRecord.id,
          operationKey: `op_cpa_floor_${suffix}`,
          toolName: "inspect_source",
          arguments: { connectionId: connA, provider: "tiktok_business", adAccountId: ttAccountA },
          scopeHash: canonicalScopeHashA,
          policyRevision: 1,
          state: "queued",
        },
      });
    }, db);

    const approvalCpaFloor = await agentConsoleTransaction(async (tx) => {
      return createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: opCpaFloor.id,
        proposalHash: "prop_cpa_floor",
        evidenceFingerprint: evalValid.snapshot.datasetFingerprint,
        evidenceRevision: 1,
        policyRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
    }, db);

    // Change cpaFloor on responsibility configuration
    const originalResp = await db.agentResponsibility.findUniqueOrThrow({ where: { id: respIdA } });
    await db.agentResponsibility.update({
      where: { id: respIdA },
      data: {
        configuration: {
          ...(originalResp.configuration as Record<string, unknown>),
          cpaFloor: 45.0, // Modified cpaFloor!
        },
      },
    });

    await assert.rejects(
      () =>
        agentConsoleTransaction(async (tx) => {
          return consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: approvalCpaFloor.id,
            operationId: opCpaFloor.id,
            proposalHash: "prop_cpa_floor",
            evidenceFingerprint: evalValid.snapshot.datasetFingerprint,
            evidenceRevision: 1,
            policyRevision: 1,
            scopeRevision: 1,
            actorUserId: ownerId,
          });
        }, db),
      (err: any) => err.code === "evidence_superseded" && err.message.includes("corrected since evidence was evaluated")
    );

    // Restore original responsibility configuration
    await db.agentResponsibility.update({
      where: { id: respIdA },
      data: { configuration: originalResp.configuration as any },
    });
  });
});

