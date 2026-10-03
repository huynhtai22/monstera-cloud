import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { CertificationHarness } from "./harness";
import { cleanupExpiredArtifacts } from "@/lib/connector-runtime/retention";
import { reportingDataset } from "@/lib/report-delivery";

describe("PR #152 Review Remediation — Real PostgreSQL Regression Suite", { skip: !process.env.DATABASE_URL }, () => {
  const db = new PrismaClient();
  const testId = randomUUID();
  const wsId = `ws-rem-${testId}`;
  const wsId2 = `ws-rem-2-${testId}`;
  const ownerId = `user-rem-${testId}`;
  const harness = new CertificationHarness();

  let connGoogleId: string;
  let connMetaId: string;
  let client1Id: string;
  let client2Id: string;
  const prevGoogleAdsClientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const prevGoogleAdsClientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;

  before(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.ok(["/monstera_security_test", "/monstera_ci"].includes(url.pathname));

    process.env.GOOGLE_ADS_CLIENT_ID ||= "mock-google-client-id";
    process.env.GOOGLE_ADS_CLIENT_SECRET ||= "mock-google-client-secret";

    // Create user and workspaces
    await db.user.create({
      data: {
        id: ownerId,
        email: `${ownerId}@example.test`,
        platformRole: "USER",
      },
    });

    await db.workspace.createMany({
      data: [
        { id: wsId, name: wsId, slug: wsId, ownerId },
        { id: wsId2, name: wsId2, slug: wsId2, ownerId },
      ],
    });

    // Create clients
    const c1 = await db.client.create({
      data: {
        id: `c1-${testId}`,
        workspaceId: wsId,
        name: "Client Alpha",
        requiredProviders: ["google_ads"],
        requiredDestinations: ["google_sheets"],
        requirementsConfiguredAt: new Date("2026-08-01T00:00:00Z"),
      },
    });
    client1Id = c1.id;

    const c2 = await db.client.create({
      data: {
        id: `c2-${testId}`,
        workspaceId: wsId,
        name: "Client Beta",
        requiredProviders: ["meta_ads"],
        requiredDestinations: ["google_sheets"],
        requirementsConfiguredAt: new Date("2026-08-01T00:00:00Z"),
      },
    });
    client2Id = c2.id;

    // Create connections with same accountId
    const connG = await db.connection.create({
      data: {
        id: `conn-g-${testId}`,
        workspaceId: wsId,
        clientId: client1Id,
        name: "Google Connection",
        type: "source",
        provider: "google_ads",
        credentials: "{}",
        remoteAccountId: "shared-act-999",
        status: "connected",
      },
    });
    connGoogleId = connG.id;

    const connM = await db.connection.create({
      data: {
        id: `conn-m-${testId}`,
        workspaceId: wsId,
        clientId: client2Id,
        name: "Meta Connection",
        type: "source",
        provider: "meta_ads",
        credentials: "{}",
        remoteAccountId: "shared-act-999",
        status: "connected",
      },
    });
    connMetaId = connM.id;
  });

  after(async () => {
    await db.auditEvent.deleteMany({ where: { workspaceId: { in: [wsId, wsId2] } } });
    await db.connectorRunArtifact.deleteMany({ where: { workspaceId: { in: [wsId, wsId2] } } });
    await db.destinationDeliveryReceipt.deleteMany({ where: { workspaceId: { in: [wsId, wsId2] } } });
    await db.providerSyncRun.deleteMany({ where: { workspaceId: { in: [wsId, wsId2] } } });
    await db.warehouseImportJob.deleteMany({ where: { workspaceId: { in: [wsId, wsId2] } } });
    await db.campaignMetric.deleteMany({ where: { workspaceId: { in: [wsId, wsId2] } } });
    await db.connection.deleteMany({ where: { workspaceId: { in: [wsId, wsId2] } } });
    await db.client.deleteMany({ where: { workspaceId: { in: [wsId, wsId2] } } });
    await db.workspace.deleteMany({ where: { id: { in: [wsId, wsId2] } } });
    await db.user.deleteMany({ where: { id: ownerId } });
    await db.$disconnect();

    if (prevGoogleAdsClientId === undefined) {
      delete process.env.GOOGLE_ADS_CLIENT_ID;
    } else {
      process.env.GOOGLE_ADS_CLIENT_ID = prevGoogleAdsClientId;
    }
    if (prevGoogleAdsClientSecret === undefined) {
      delete process.env.GOOGLE_ADS_CLIENT_SECRET;
    } else {
      process.env.GOOGLE_ADS_CLIENT_SECRET = prevGoogleAdsClientSecret;
    }
  });

  it("Thread 2 Regression: scopes reconciliation and imported rows strictly to certified connection and platform", async () => {
    // Insert 10 rows for Google (spend: 10 each = 100 total)
    await db.campaignMetric.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        workspaceId: wsId,
        connectionId: connGoogleId,
        platform: "google_ads",
        accountId: "shared-act-999",
        date: new Date(`2026-08-${String(i + 1).padStart(2, "0")}T12:00:00Z`),
        spend: 10,
        impressions: 100,
        clicks: 5,
        conversions: 1,
        revenue: 25,
        currency: "VND",
        entityId: `camp-g-${i}`,
        campaignId: `camp-g-${i}`,
      })),
    });

    // Insert 5 rows for Meta with the SAME accountId (spend: 50 each = 250 total)
    await db.campaignMetric.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        workspaceId: wsId,
        connectionId: connMetaId,
        platform: "meta_ads",
        accountId: "shared-act-999",
        date: new Date(`2026-08-${String(i + 1).padStart(2, "0")}T12:00:00Z`),
        spend: 50,
        impressions: 500,
        clicks: 25,
        conversions: 5,
        revenue: 125,
        currency: "VND",
        entityId: `camp-m-${i}`,
        campaignId: `camp-m-${i}`,
      })),
    });

    // Run certification for Google Ads connection
    const result = await harness.execute({
      workspaceId: wsId,
      connectionId: connGoogleId,
      provider: "google_ads",
      accountId: "shared-act-999",
      startDate: "2026-08-01",
      endDate: "2026-08-10",
      buildId: "test-build-thread-2",
      nativeComparison: {
        spend: 100, // Matches Google only, NOT 100 + 250 = 350
        impressions: 1000,
        clicks: 50,
        conversions: 10,
        revenue: 250,
      },
      snapshotTiming: {
        nativeRetrievalTime: "2026-08-11T00:00:00Z",
        monsteraDataThroughTime: "2026-08-11T00:00:00Z",
        warehouseQueryTime: "2026-08-11T00:01:00Z",
      },
    });

    const importedGate = result.evidencePack.gateOutcomes.find((g) => g.gate === "LIVE_IMPORTED");
    assert.equal(importedGate?.status, "PASSED");
    assert.equal(importedGate?.evidence?.rowCount, 10, "Row count must reflect Google rows only (10), not Meta rows (15 total)");

    const reconciledGate = result.evidencePack.gateOutcomes.find((g) => g.gate === "LIVE_RECONCILED");
    assert.equal(reconciledGate?.status, "PASSED", "Reconciliation must pass when matched against Google rows (spend: 100)");
    const warehouseSpend = (reconciledGate?.evidence?.warehouseTotals as any)?.spend;
    assert.equal(warehouseSpend, 100, "Warehouse totals must not include Meta spend");
  });

  it("Thread 3 Regression: binds destination receipts to client and rejects stale receipts after mutations", async () => {
    // 1. Create a delivery receipt for Client Beta (c2), NOT Client Alpha (c1)
    await db.destinationDeliveryReceipt.create({
      data: {
        workspaceId: wsId,
        clientId: client2Id,
        destination: "google_sheets",
        windowStart: "2026-08-01",
        windowEnd: "2026-08-10",
        dataThroughDate: "2026-08-10",
        datasetFingerprint: "fingerprint-c2",
        rowCount: 5,
        actorId: ownerId,
      },
    });

    // Check destination for Google connection (belongs to c1)
    const resUnrelated = await harness.execute({
      workspaceId: wsId,
      connectionId: connGoogleId,
      provider: "google_ads",
      accountId: "shared-act-999",
      startDate: "2026-08-01",
      endDate: "2026-08-10",
      buildId: "test-build-thread-3-a",
      destination: "google_sheets",
      nativeComparison: {
        spend: 100,
        impressions: 1000,
        clicks: 50,
        conversions: 10,
        revenue: 250,
      },
      snapshotTiming: {
        nativeRetrievalTime: "2026-08-11T00:00:00Z",
        monsteraDataThroughTime: "2026-08-11T00:00:00Z",
        warehouseQueryTime: "2026-08-11T00:01:00Z",
      },
    });

    const destGate1 = resUnrelated.evidencePack.gateOutcomes.find((g) => g.gate === "DESTINATION_VERIFIED");
    assert.equal(destGate1?.status, "BLOCKED");
    assert.equal(destGate1?.blockerCategory, "DESTINATION_RECEIPT_MISSING", "Cannot borrow Client Beta delivery receipt");

    // 2. Now compute current fingerprint for Client Alpha (c1)
    const snapshot = await reportingDataset(db as any, wsId, client1Id, { start: "2026-08-01", end: "2026-08-10" });
    assert.ok(snapshot.rowCount > 0);

    // Create matching fresh delivery receipt for Client Alpha (c1)
    await db.destinationDeliveryReceipt.create({
      data: {
        workspaceId: wsId,
        clientId: client1Id,
        destination: "google_sheets",
        windowStart: "2026-08-01",
        windowEnd: "2026-08-10",
        dataThroughDate: snapshot.dataThroughDate || "2026-08-10",
        datasetFingerprint: snapshot.fingerprint,
        rowCount: snapshot.rowCount,
        retrievedAt: new Date(snapshot.evidenceAt + 1000),
        actorId: ownerId,
      },
    });

    const resFresh = await harness.execute({
      workspaceId: wsId,
      connectionId: connGoogleId,
      provider: "google_ads",
      accountId: "shared-act-999",
      startDate: "2026-08-01",
      endDate: "2026-08-10",
      buildId: "test-build-thread-3-b",
      destination: "google_sheets",
      nativeComparison: {
        spend: 100,
        impressions: 1000,
        clicks: 50,
        conversions: 10,
        revenue: 250,
      },
      snapshotTiming: {
        nativeRetrievalTime: "2026-08-11T00:00:00Z",
        monsteraDataThroughTime: "2026-08-11T00:00:00Z",
        warehouseQueryTime: "2026-08-11T00:01:00Z",
      },
    });

    const destGate2 = resFresh.evidencePack.gateOutcomes.find((g) => g.gate === "DESTINATION_VERIFIED");
    assert.equal(destGate2?.status, "PASSED", "Fresh receipt matching client and fingerprint passes");

    // 3. Mutate warehouse data for Client Alpha (add a new campaign metric row)
    await db.campaignMetric.create({
      data: {
        workspaceId: wsId,
        connectionId: connGoogleId,
        platform: "google_ads",
        accountId: "shared-act-999",
        date: new Date("2026-08-05T15:00:00Z"),
        spend: 20,
        impressions: 200,
        clicks: 10,
        conversions: 2,
        revenue: 50,
        currency: "VND",
        entityId: "camp-g-new",
        campaignId: "camp-g-new",
      },
    });

    // Run certification again: receipt should now be detected as STALE
    const resStale = await harness.execute({
      workspaceId: wsId,
      connectionId: connGoogleId,
      provider: "google_ads",
      accountId: "shared-act-999",
      startDate: "2026-08-01",
      endDate: "2026-08-10",
      buildId: "test-build-thread-3-c",
      destination: "google_sheets",
      nativeComparison: {
        spend: 120,
        impressions: 1200,
        clicks: 60,
        conversions: 12,
        revenue: 300,
      },
      snapshotTiming: {
        nativeRetrievalTime: "2026-08-11T00:00:00Z",
        monsteraDataThroughTime: "2026-08-11T00:00:00Z",
        warehouseQueryTime: "2026-08-11T00:01:00Z",
      },
    });

    const destGate3 = resStale.evidencePack.gateOutcomes.find((g) => g.gate === "DESTINATION_VERIFIED");
    assert.equal(destGate3?.status, "BLOCKED");
    assert.equal(destGate3?.blockerCategory, "DESTINATION_RECEIPT_STALE", "Receipt must be flagged stale after newer mutations");
  });

  it("Thread 4 Regression: rejects OAuth discovery activities and requires two matching data-sync runs for recovery", async () => {
    // 1. Only OAuth discovery activity present
    await db.providerSyncRun.create({
      data: {
        workspaceId: wsId,
        connectionId: connGoogleId,
        provider: "google_ads",
        environment: "production",
        endpoint: "customers:listAccessibleCustomers",
        httpStatus: 200,
        status: "success",
        rowsReceived: 5,
        rowsWritten: 0,
        startedAt: new Date("2026-08-10T01:00:00Z"),
        completedAt: new Date("2026-08-10T01:00:05Z"),
      },
    });

    // Create fresh delivery receipt to satisfy prior gates, then verify recovery gate behavior
    const snapshot = await reportingDataset(db as any, wsId, client1Id, { start: "2026-08-01", end: "2026-08-10" });
    await db.destinationDeliveryReceipt.create({
      data: {
        workspaceId: wsId,
        clientId: client1Id,
        destination: "google_sheets",
        windowStart: "2026-08-01",
        windowEnd: "2026-08-10",
        dataThroughDate: snapshot.dataThroughDate || "2026-08-10",
        datasetFingerprint: snapshot.fingerprint,
        rowCount: snapshot.rowCount,
        retrievedAt: new Date(snapshot.evidenceAt + 2000),
        actorId: ownerId,
      },
    });

    const resWithDest = await harness.execute({
      workspaceId: wsId,
      connectionId: connGoogleId,
      provider: "google_ads",
      accountId: "shared-act-999",
      startDate: "2026-08-01",
      endDate: "2026-08-10",
      buildId: "test-build-thread-4-a2",
      destination: "google_sheets",
      nativeComparison: {
        spend: 120,
        impressions: 1200,
        clicks: 60,
        conversions: 12,
        revenue: 300,
      },
      snapshotTiming: {
        nativeRetrievalTime: "2026-08-11T00:00:00Z",
        monsteraDataThroughTime: "2026-08-11T00:00:00Z",
        warehouseQueryTime: "2026-08-11T00:01:00Z",
      },
    });

    const recGate1 = resWithDest.evidencePack.gateOutcomes.find((g) => g.gate === "RECOVERY_VERIFIED");
    assert.equal(recGate1?.status, "BLOCKED");
    assert.equal(recGate1?.blockerCategory, "IDEMPOTENT_RERUN_PENDING", "Discovery activity must not satisfy recovery");

    // 2. Only ONE data sync run present
    await db.providerSyncRun.create({
      data: {
        workspaceId: wsId,
        connectionId: connGoogleId,
        provider: "google_ads",
        environment: "production",
        endpoint: "googleAds:searchStream",
        httpStatus: 200,
        status: "success",
        rowsReceived: 10,
        rowsWritten: 10,
        startedAt: new Date("2026-08-10T02:00:00Z"),
        completedAt: new Date("2026-08-10T02:01:00Z"),
      },
    });

    const resSingleSync = await harness.execute({
      workspaceId: wsId,
      connectionId: connGoogleId,
      provider: "google_ads",
      accountId: "shared-act-999",
      startDate: "2026-08-01",
      endDate: "2026-08-10",
      buildId: "test-build-thread-4-b",
      destination: "google_sheets",
      nativeComparison: {
        spend: 120,
        impressions: 1200,
        clicks: 60,
        conversions: 12,
        revenue: 300,
      },
      snapshotTiming: {
        nativeRetrievalTime: "2026-08-11T00:00:00Z",
        monsteraDataThroughTime: "2026-08-11T00:00:00Z",
        warehouseQueryTime: "2026-08-11T00:01:00Z",
      },
    });

    const recGate2 = resSingleSync.evidencePack.gateOutcomes.find((g) => g.gate === "RECOVERY_VERIFIED");
    assert.equal(recGate2?.status, "BLOCKED");
    assert.equal(recGate2?.blockerCategory, "IDEMPOTENT_RERUN_PENDING", "Single data-sync run must not satisfy duplicate recovery");

    // 3. Second matching data sync run added with matching written rows
    await db.providerSyncRun.create({
      data: {
        workspaceId: wsId,
        connectionId: connGoogleId,
        provider: "google_ads",
        environment: "production",
        endpoint: "googleAds:searchStream",
        httpStatus: 200,
        status: "success",
        rowsReceived: 10,
        rowsWritten: 10,
        startedAt: new Date("2026-08-10T03:00:00Z"),
        completedAt: new Date("2026-08-10T03:01:00Z"),
      },
    });

    const resDuplicateSync = await harness.execute({
      workspaceId: wsId,
      connectionId: connGoogleId,
      provider: "google_ads",
      accountId: "shared-act-999",
      startDate: "2026-08-01",
      endDate: "2026-08-10",
      buildId: "test-build-thread-4-c",
      destination: "google_sheets",
      nativeComparison: {
        spend: 120,
        impressions: 1200,
        clicks: 60,
        conversions: 12,
        revenue: 300,
      },
      snapshotTiming: {
        nativeRetrievalTime: "2026-08-11T00:00:00Z",
        monsteraDataThroughTime: "2026-08-11T00:00:00Z",
        warehouseQueryTime: "2026-08-11T00:01:00Z",
      },
    });

    const recGate3 = resDuplicateSync.evidencePack.gateOutcomes.find((g) => g.gate === "RECOVERY_VERIFIED");
    assert.equal(recGate3?.status, "PASSED", "Two matching data sync runs pass recovery verification");
    assert.equal(recGate3?.evidence?.rerunCompleted, true);
    assert.equal(recGate3?.evidence?.duplicateRows, 0);
  });

  it("Thread 5 Regression: groups audit events per workspace in real PostgreSQL cleanup", async () => {
    const cutoff = new Date(Date.now() + 60000);

    // Insert 2 expired artifacts for wsId
    await db.connectorRunArtifact.createMany({
      data: [
        {
          id: `art-1-${testId}`,
          workspaceId: wsId,
          connectionId: connGoogleId,
          runId: `run-1-${testId}`,
          provider: "google_ads",
          kind: "google_shadow_evidence",
          payloadHash: "hash-1",
          payload: {},
          retainedUntil: new Date(Date.now() - 10000),
        },
        {
          id: `art-2-${testId}`,
          workspaceId: wsId,
          connectionId: connGoogleId,
          runId: `run-2-${testId}`,
          provider: "google_ads",
          kind: "google_shadow_evidence",
          payloadHash: "hash-2",
          payload: {},
          retainedUntil: new Date(Date.now() - 10000),
        },
      ],
    });

    // Insert 3 expired artifacts for wsId2 (create connection in wsId2 first)
    const conn2 = await db.connection.create({
      data: {
        id: `conn-ws2-${testId}`,
        workspaceId: wsId2,
        name: "Connection WS2",
        type: "source",
        provider: "google_ads",
        credentials: "{}",
        status: "connected",
      },
    });

    await db.connectorRunArtifact.createMany({
      data: [
        {
          id: `art-3-${testId}`,
          workspaceId: wsId2,
          connectionId: conn2.id,
          runId: `run-3-${testId}`,
          provider: "google_ads",
          kind: "google_shadow_evidence",
          payloadHash: "hash-3",
          payload: {},
          retainedUntil: new Date(Date.now() - 10000),
        },
        {
          id: `art-4-${testId}`,
          workspaceId: wsId2,
          connectionId: conn2.id,
          runId: `run-4-${testId}`,
          provider: "google_ads",
          kind: "google_shadow_evidence",
          payloadHash: "hash-4",
          payload: {},
          retainedUntil: new Date(Date.now() - 10000),
        },
        {
          id: `art-5-${testId}`,
          workspaceId: wsId2,
          connectionId: conn2.id,
          runId: `run-5-${testId}`,
          provider: "google_ads",
          kind: "google_shadow_evidence",
          payloadHash: "hash-5",
          payload: {},
          retainedUntil: new Date(Date.now() - 10000),
        },
      ],
    });

    const summary = await cleanupExpiredArtifacts({ before: cutoff, limit: 100 });
    assert.equal(summary.deleted, 5, "Total 5 artifacts deleted across both workspaces");

    // Verify audit events
    const auditsWs1 = await db.auditEvent.findMany({
      where: { workspaceId: wsId, action: "connector_runtime.cleanup" },
    });
    const auditsWs2 = await db.auditEvent.findMany({
      where: { workspaceId: wsId2, action: "connector_runtime.cleanup" },
    });

    assert.equal(auditsWs1.length, 1, "Workspace 1 must have exactly 1 cleanup audit event");
    assert.equal((auditsWs1[0].metadata as any)?.deleted, 2, "Workspace 1 audit event must record only its 2 deletions");

    assert.equal(auditsWs2.length, 1, "Workspace 2 must have exactly 1 cleanup audit event");
    assert.equal((auditsWs2[0].metadata as any)?.deleted, 3, "Workspace 2 audit event must record only its 3 deletions");
  });
});
