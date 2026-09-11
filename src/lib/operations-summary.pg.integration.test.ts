import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";

import { assertAllowedTestDatabase } from "./pg-test-discipline";
import { ClientContextError } from "./client-context-server";
import {
  loadOperationsSummary,
  OPERATIONS_INGESTION_WINDOW_DAYS,
  OPERATIONS_LIST_LIMIT,
  type FreshnessData,
  type OperationsSection,
} from "./operations-summary";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const d1 = new Date("2026-09-06T00:00:00.000Z");
const d2 = new Date("2026-09-08T00:00:00.000Z");
const d3 = new Date("2026-09-09T00:00:00.000Z");

/**
 * Real-PostgreSQL isolation for the read-only operations summary.
 *
 * The fixtures deliberately include a SHARED root connection owned by two
 * different clients through explicit account assignments, so "scope by
 * connection membership" would leak sibling evidence. Every assertion below
 * fails if that happens.
 */
describe("PostgreSQL integration: operations summary isolation", () => {
  let db: PrismaClient;
  const suffix = `ops-${Date.now()}-${process.pid}`;

  const ids = {
    ownerA: `user-owner-a-${suffix}`,
    ownerB: `user-owner-b-${suffix}`,
    wsA: `ws-a-${suffix}`,
    wsB: `ws-b-${suffix}`,
    clA: `cl-a-${suffix}`,
    clA2: `cl-a2-${suffix}`,
    clEmpty: `cl-empty-${suffix}`,
    clLegacy: `cl-legacy-${suffix}`,
    clB: `cl-b-${suffix}`,
    connShared: `conn-shared-${suffix}`,
    connUnassigned: `conn-unassigned-${suffix}`,
    connLegacy: `conn-legacy-${suffix}`,
    destA: `dest-a-${suffix}`,
    connB: `conn-b-${suffix}`,
    destB: `dest-b-${suffix}`,
    pipeA: `pipe-a-${suffix}`,
    pipeB: `pipe-b-${suffix}`,
  };

  const metricRow = (
    workspaceId: string,
    connectionId: string,
    platform: string,
    accountId: string,
    campaignId: string,
    campaignName: string,
    date: Date,
    spend: number,
    conversions: number,
  ) => ({
    workspaceId,
    connectionId,
    platform,
    accountId,
    accountName: `${platform} ${accountId}`,
    campaignId,
    campaignName,
    date,
    spend,
    conversions,
    currency: "USD",
  });

  const burnDays = (
    workspaceId: string,
    connectionId: string,
    platform: string,
    accountId: string,
    campaignId: string,
    campaignName: string,
  ) => [
    metricRow(workspaceId, connectionId, platform, accountId, campaignId, campaignName, d1, 10, 5),
    metricRow(workspaceId, connectionId, platform, accountId, campaignId, campaignName, d2, 100, 0),
    metricRow(workspaceId, connectionId, platform, accountId, campaignId, campaignName, d3, 100, 0),
  ];

  const freshnessTotal = (section: OperationsSection<FreshnessData>): number =>
    section.data ? Object.values(section.data.totals).reduce((sum, value) => sum + value, 0) : -1;

  before(async () => {
    const url = assertAllowedTestDatabase(process.env.DATABASE_URL);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();

    await db.user.createMany({
      data: [
        { id: ids.ownerA, email: `${ids.ownerA}@example.test`, name: "Owner A" },
        { id: ids.ownerB, email: `${ids.ownerB}@example.test`, name: "Owner B" },
      ],
    });
    await db.workspace.createMany({
      data: [
        { id: ids.wsA, ownerId: ids.ownerA, name: "Ops A", slug: `ops-a-${suffix}`, plan: "professional" },
        { id: ids.wsB, ownerId: ids.ownerB, name: "Ops B", slug: `ops-b-${suffix}`, plan: "professional" },
      ],
    });
    await db.workspaceMember.createMany({
      data: [
        { workspaceId: ids.wsA, userId: ids.ownerA, role: "owner" },
        { workspaceId: ids.wsB, userId: ids.ownerB, role: "owner" },
      ],
    });
    await db.client.createMany({
      data: [
        { id: ids.clA, workspaceId: ids.wsA, name: "Aurora", accountAssignmentsConfiguredAt: NOW },
        { id: ids.clA2, workspaceId: ids.wsA, name: "Borealis", accountAssignmentsConfiguredAt: NOW },
        { id: ids.clEmpty, workspaceId: ids.wsA, name: "Empty", accountAssignmentsConfiguredAt: NOW },
        { id: ids.clLegacy, workspaceId: ids.wsA, name: "Legacy" },
        { id: ids.clB, workspaceId: ids.wsB, name: "Rival", accountAssignmentsConfiguredAt: NOW },
      ],
    });
    await db.connection.createMany({
      data: [
        { id: ids.connShared, workspaceId: ids.wsA, name: "Shared MCC", provider: "google_ads", type: "source", status: "connected", remoteAccountId: `shared-${suffix}`, credentials: "{}" },
        { id: ids.connUnassigned, workspaceId: ids.wsA, name: "Workspace Meta", provider: "meta_ads", type: "source", status: "connected", remoteAccountId: `unassigned-${suffix}`, credentials: "{}", lastSyncAt: NOW },
        { id: ids.connLegacy, workspaceId: ids.wsA, name: "Legacy TikTok", provider: "tiktok_ads", type: "source", status: "connected", remoteAccountId: `legacy-${suffix}`, credentials: "{}", clientId: ids.clLegacy, lastSyncAt: NOW },
        { id: ids.destA, workspaceId: ids.wsA, name: "Sheets A", provider: "google_sheets", type: "destination", status: "connected", remoteAccountId: `dest-a-${suffix}`, credentials: "{}" },
        { id: ids.connB, workspaceId: ids.wsB, name: "Rival Google", provider: "google_ads", type: "source", status: "connected", remoteAccountId: `rival-${suffix}`, credentials: "{}" },
        { id: ids.destB, workspaceId: ids.wsB, name: "Sheets B", provider: "google_sheets", type: "destination", status: "connected", remoteAccountId: `dest-b-${suffix}`, credentials: "{}" },
      ],
    });
    await db.clientProviderAccountAssignment.createMany({
      data: [
        { workspaceId: ids.wsA, clientId: ids.clA, provider: "google_ads", accountId: "111", connectionId: ids.connShared },
        { workspaceId: ids.wsA, clientId: ids.clA2, provider: "google_ads", accountId: "222", connectionId: ids.connShared },
        { workspaceId: ids.wsB, clientId: ids.clB, provider: "google_ads", accountId: "999", connectionId: ids.connB },
      ],
    });
    await db.providerAccountHealth.createMany({
      data: [
        { workspaceId: ids.wsA, connectionId: ids.connShared, provider: "google_ads", accountId: "111", status: "healthy" },
        { workspaceId: ids.wsA, connectionId: ids.connShared, provider: "google_ads", accountId: "222", status: "quarantined", consecutiveFailures: 3, errorCategory: "PERMISSION_DENIED", lastError: `denied ${"t".repeat(40)}` },
        { workspaceId: ids.wsA, connectionId: ids.connUnassigned, provider: "meta_ads", accountId: "act_222", status: "degraded", consecutiveFailures: 2 },
        { workspaceId: ids.wsA, connectionId: ids.connLegacy, provider: "tiktok_ads", accountId: "tk_1", status: "healthy" },
        { workspaceId: ids.wsB, connectionId: ids.connB, provider: "google_ads", accountId: "999", status: "healthy" },
      ],
    });
    await db.campaignMetric.createMany({
      data: [
        ...burnDays(ids.wsA, ids.connShared, "google_ads", "111", "c-111", "A-111"),
        ...burnDays(ids.wsA, ids.connShared, "google_ads", "222", "c-222", "A-222"),
        ...burnDays(ids.wsA, ids.connUnassigned, "meta_ads", "act_222", "c-meta", "WS-META"),
        ...burnDays(ids.wsA, ids.connLegacy, "tiktok_ads", "tk_1", "c-tk", "LEGACY-TK"),
        ...burnDays(ids.wsB, ids.connB, "google_ads", "999", "c-999", "B-999"),
      ],
    });
    await db.destinationDeliveryReceipt.createMany({
      data: [
        { workspaceId: ids.wsA, clientId: ids.clA, destination: "google_sheets", windowStart: "2026-09-01", windowEnd: "2026-09-07", dataThroughDate: "2026-09-07", datasetFingerprint: "fp-a", rowCount: 12, retrievedAt: NOW, actorId: ids.ownerA },
        { workspaceId: ids.wsA, clientId: ids.clA2, destination: "looker", windowStart: "2026-09-01", windowEnd: "2026-09-07", dataThroughDate: "2026-09-07", datasetFingerprint: "fp-a2", rowCount: 7, retrievedAt: NOW, actorId: ids.ownerA },
        { workspaceId: ids.wsB, clientId: ids.clB, destination: "google_sheets", windowStart: "2026-09-01", windowEnd: "2026-09-07", dataThroughDate: "2026-09-07", datasetFingerprint: "fp-b", rowCount: 3, retrievedAt: NOW, actorId: ids.ownerB },
      ],
    });
    await db.warehouseImportJob.createMany({
      data: [
        { workspaceId: ids.wsA, userId: ids.ownerA, since: "2026-09-01", until: "2026-09-07", items: [], status: "failed", errorMsg: "import exploded", createdAt: new Date("2026-09-09T10:00:00.000Z") },
        { workspaceId: ids.wsB, userId: ids.ownerB, since: "2026-09-01", until: "2026-09-07", items: [], status: "failed", errorMsg: "rival import", createdAt: new Date("2026-09-09T10:00:00.000Z") },
      ],
    });
    await db.pipeline.createMany({
      data: [
        { id: ids.pipeA, workspaceId: ids.wsA, name: "Pipe A", sourceConnectionId: ids.connShared, destinationConnectionId: ids.destA },
        { id: ids.pipeB, workspaceId: ids.wsB, name: "Pipe B", sourceConnectionId: ids.connB, destinationConnectionId: ids.destB },
      ],
    });
    await db.syncLog.createMany({
      data: [
        // Explicit timestamps: `createdAt` is part of the ingestion window
        // predicate, so a wall-clock default would make these assertions
        // depend on when the suite happens to run.
        { pipelineId: ids.pipeA, status: "error", errorMsg: "pipeline A failed", createdAt: d3 },
        { pipelineId: ids.pipeB, status: "error", errorMsg: "pipeline B failed", createdAt: d3 },
      ],
    });
  });

  after(async () => {
    try {
      await db.syncLog.deleteMany({ where: { pipelineId: { in: [ids.pipeA, ids.pipeB] } } });
      await db.pipeline.deleteMany({ where: { workspaceId: { in: [ids.wsA, ids.wsB] } } });
      await db.warehouseImportJob.deleteMany({ where: { workspaceId: { in: [ids.wsA, ids.wsB] } } });
      await db.destinationDeliveryReceipt.deleteMany({ where: { workspaceId: { in: [ids.wsA, ids.wsB] } } });
      await db.campaignMetric.deleteMany({ where: { workspaceId: { in: [ids.wsA, ids.wsB] } } });
      await db.providerAccountHealth.deleteMany({ where: { workspaceId: { in: [ids.wsA, ids.wsB] } } });
      await db.clientProviderAccountAssignment.deleteMany({ where: { workspaceId: { in: [ids.wsA, ids.wsB] } } });
      await db.connection.deleteMany({ where: { workspaceId: { in: [ids.wsA, ids.wsB] } } });
      await db.client.deleteMany({ where: { workspaceId: { in: [ids.wsA, ids.wsB] } } });
      await db.workspaceMember.deleteMany({ where: { workspaceId: { in: [ids.wsA, ids.wsB] } } });
      await db.workspace.deleteMany({ where: { id: { in: [ids.wsA, ids.wsB] } } });
      await db.user.deleteMany({ where: { id: { in: [ids.ownerA, ids.ownerB] } } });
    } finally {
      await db.$disconnect();
    }
  });

  it("keeps a workspace-wide summary inside its own tenant", async () => {
    const summary = await loadOperationsSummary({ workspaceId: ids.wsA, now: NOW });

    assert.equal(summary.version, "operations-summary-v1");
    assert.equal(summary.generatedAt, NOW.toISOString());
    assert.equal(summary.clientContext.status, "none");
    assert.equal(summary.clientContext.client, null);

    // 4 wsA accounts: shared 111, shared 222, unassigned meta, legacy tiktok.
    assert.equal(summary.sections.connectorHealth.state, "attention");
    assert.equal(summary.sections.connectorHealth.data?.totals.total, 4);
    assert.equal(summary.sections.connectorHealth.data?.totals.quarantined, 1);
    assert.equal(summary.sections.connectorHealth.data?.totals.degraded, 1);
    assert.equal(
      summary.sections.connectorHealth.data?.attention.some((row) => row.connectionId === ids.connB),
      false,
    );

    // 3 wsA source connections (shared, unassigned, legacy) — not the rival's.
    assert.equal(freshnessTotal(summary.sections.freshness), 3);

    // Only the wsA import job and the wsA pipeline error are visible.
    assert.equal(summary.sections.ingestion.state, "attention");
    assert.equal(summary.sections.ingestion.data?.totals.total, 1);
    assert.equal(summary.sections.ingestion.data?.recentFailures.length, 1);
    assert.equal(summary.sections.ingestion.data?.syncLogErrors.length, 1);
    assert.equal(summary.sections.ingestion.data?.syncLogErrors[0]?.pipelineId, ids.pipeA);

    // Delivery covers wsA clients only.
    assert.equal(summary.sections.delivery.data?.totals.receipts, 2);
    assert.equal(summary.sections.delivery.data?.totals.clients, 2);
    assert.equal(
      summary.sections.delivery.data?.latest.some((entry) => entry.clientId === ids.clB),
      false,
    );

    // Anomalies are detected from wsA metrics only.
    assert.equal(summary.sections.anomalies.state, "attention");
    assert.equal(summary.sections.anomalies.data?.totals.total, 4);
    assert.equal(
      summary.sections.anomalies.data?.items.some((item) => item.campaignName === "B-999"),
      false,
    );

    // Readiness evaluates every wsA client and no rival client.
    assert.equal(summary.sections.readiness.data?.evaluatedClients, 4);
    assert.equal(
      summary.sections.readiness.data?.clients.some((client) => client.clientId === ids.clB),
      false,
    );
  });

  it("isolates a concrete client from a sibling client on the SAME shared root connection", async () => {
    const first = await loadOperationsSummary({ workspaceId: ids.wsA, requestedClientId: ids.clA, now: NOW });
    assert.equal(first.clientContext.status, "resolved");
    assert.deepEqual(first.clientContext.client, { id: ids.clA, name: "Aurora" });
    assert.equal(first.clientContext.scope, "explicit");

    // Account 111 only — the quarantined sibling account 222 must not appear.
    assert.equal(first.sections.connectorHealth.data?.totals.total, 1);
    assert.equal(first.sections.connectorHealth.data?.totals.healthy, 1);
    assert.equal(first.sections.connectorHealth.state, "ready");
    assert.equal(first.sections.connectorHealth.data?.attention.length, 0);

    // One source connection (the shared root), counted once.
    assert.equal(freshnessTotal(first.sections.freshness), 1);

    // Only this client's delivery receipt.
    assert.equal(first.sections.delivery.data?.totals.receipts, 1);
    assert.equal(first.sections.delivery.data?.latest[0]?.destination, "google_sheets");

    // Only this client's campaign is analysed.
    assert.equal(first.sections.anomalies.data?.totals.total, 1);
    assert.equal(first.sections.anomalies.data?.items[0]?.campaignName, "A-111");
    assert.equal(first.sections.anomalies.data?.items[0]?.clientId, ids.clA);

    const sibling = await loadOperationsSummary({ workspaceId: ids.wsA, requestedClientId: ids.clA2, now: NOW });
    assert.equal(sibling.sections.connectorHealth.data?.totals.total, 1);
    assert.equal(sibling.sections.connectorHealth.data?.totals.quarantined, 1);
    assert.equal(sibling.sections.connectorHealth.data?.attention[0]?.accountId, "222");
    assert.equal(sibling.sections.anomalies.data?.items[0]?.campaignName, "A-222");
    assert.equal(sibling.sections.delivery.data?.latest[0]?.destination, "looker");
  });

  it("treats an explicit-empty assignment set as empty evidence, never workspace-wide", async () => {
    const summary = await loadOperationsSummary({ workspaceId: ids.wsA, requestedClientId: ids.clEmpty, now: NOW });

    assert.equal(summary.clientContext.scope, "explicit");
    assert.equal(summary.sections.connectorHealth.state, "empty");
    assert.equal(summary.sections.connectorHealth.data?.totals.total, 0);
    assert.deepEqual(summary.sections.connectorHealth.data?.attention, []);
    assert.equal(summary.sections.freshness.state, "empty");
    assert.equal(freshnessTotal(summary.sections.freshness), 0);
    assert.equal(summary.sections.delivery.state, "empty");
    assert.equal(summary.sections.delivery.data?.totals.receipts, 0);
    assert.equal(summary.sections.anomalies.state, "empty");
    assert.equal(summary.sections.anomalies.data?.totals.total, 0);

    // Readiness is evaluative rather than row-driven: it still reports the client.
    assert.equal(summary.sections.readiness.data?.evaluatedClients, 1);
    assert.equal(summary.sections.readiness.data?.clients[0]?.clientId, ids.clEmpty);
  });

  it("resolves a legacy client through its connection pointer without unioning other clients", async () => {
    const summary = await loadOperationsSummary({ workspaceId: ids.wsA, requestedClientId: ids.clLegacy, now: NOW });
    assert.equal(summary.clientContext.scope, "legacy");
    assert.equal(summary.sections.connectorHealth.data?.totals.total, 1);
    assert.equal(summary.sections.connectorHealth.data?.attention.length, 0);
    assert.equal(freshnessTotal(summary.sections.freshness), 1);
    assert.equal(summary.sections.anomalies.data?.items[0]?.campaignName, "LEGACY-TK");
  });

  it("refuses the unassigned sentinel explicitly instead of inventing a scope", async () => {
    await assert.rejects(
      () => loadOperationsSummary({ workspaceId: ids.wsA, requestedClientId: "unassigned", now: NOW }),
      (error: unknown) =>
        error instanceof ClientContextError &&
        error.statusCode === 400 &&
        error.code === "UNSUPPORTED_CLIENT_SCOPE",
    );
  });

  it("makes rival, deleted and nonexistent clients indistinguishable and fails closed", async () => {
    const errors: Array<{ statusCode: number; code: string; message: string }> = [];
    for (const requestedClientId of [ids.clB, `cl-deleted-${suffix}`, `cl-missing-${suffix}`]) {
      try {
        await loadOperationsSummary({ workspaceId: ids.wsA, requestedClientId, now: NOW });
        assert.fail(`expected ${requestedClientId} to be rejected`);
      } catch (error) {
        assert.ok(error instanceof ClientContextError);
        errors.push({ statusCode: error.statusCode, code: error.code, message: error.message });
      }
    }
    assert.deepEqual(errors[0], errors[1]);
    assert.deepEqual(errors[1], errors[2]);
    assert.deepEqual(errors[0], { statusCode: 404, code: "CLIENT_NOT_FOUND", message: "Client not found in workspace" });
  });

  it("treats the all-clients sentinel as the intentional workspace-wide scope", async () => {
    const all = await loadOperationsSummary({ workspaceId: ids.wsA, requestedClientId: "all", now: NOW });
    assert.equal(all.clientContext.status, "all");
    assert.equal(all.clientContext.client, null);
    assert.equal(all.sections.connectorHealth.data?.totals.total, 4);
    assert.equal(all.sections.ingestion.data?.totals.total, 1);
  });

  it("declares client-scoped ingestion unsupported rather than inferring ownership", async () => {
    const summary = await loadOperationsSummary({ workspaceId: ids.wsA, requestedClientId: ids.clA, now: NOW });
    assert.equal(summary.sections.ingestion.state, "unsupported");
    assert.equal(summary.sections.ingestion.data, null);
    assert.equal(summary.sections.ingestion.reason, "import_jobs_not_client_attributable");
    assert.equal(summary.sections.ingestion.limit, 0);
  });

  it("drives freshness from the injected clock, not the wall clock", async () => {
    const row = new Date("2026-09-09T15:00:00.000Z");
    await db.connection.update({ where: { id: ids.connUnassigned }, data: { lastSyncAt: row } });
    try {
      const early = await loadOperationsSummary({ workspaceId: ids.wsA, now: new Date("2026-09-10T12:00:00.000Z") });
      assert.equal(
        early.sections.freshness.data?.attention.some((source) => source.connectionId === ids.connUnassigned),
        false,
        "21h old must be fresh",
      );

      const late = await loadOperationsSummary({ workspaceId: ids.wsA, now: new Date("2026-09-10T18:00:00.000Z") });
      const stale = late.sections.freshness.data?.attention.find((source) => source.connectionId === ids.connUnassigned);
      assert.ok(stale, "27h old must need attention");
      assert.equal(stale.state, "stale");
    } finally {
      await db.connection.update({ where: { id: ids.connUnassigned }, data: { lastSyncAt: NOW } });
    }
  });

  it("uses one scope for both counts and detail lists", async () => {
    const workspace = await loadOperationsSummary({ workspaceId: ids.wsA, now: NOW });
    const health = workspace.sections.connectorHealth.data!;
    assert.equal(health.totals.total, 4);
    assert.equal(health.totals.healthy + health.totals.degraded + health.totals.quarantined + health.totals.reconnectRequired + health.totals.unknown, 4);
    assert.equal(health.attention.length, health.totals.degraded + health.totals.quarantined + health.totals.reconnectRequired + health.totals.unknown);
    assert.equal(freshnessTotal(workspace.sections.freshness), 3);

    const client = await loadOperationsSummary({ workspaceId: ids.wsA, requestedClientId: ids.clA, now: NOW });
    assert.equal(client.sections.anomalies.data?.totals.total, client.sections.anomalies.data?.items.length);
    assert.equal(client.sections.delivery.data?.totals.receipts, client.sections.delivery.data?.latest.length);
    assert.equal(freshnessTotal(client.sections.freshness), 1);
  });

  it("performs zero writes: no row is created, updated or deleted", async () => {
    const countRows = async () => {
      const workspaces = { in: [ids.wsA, ids.wsB] };
      return {
        connection: await db.connection.count({ where: { workspaceId: workspaces } }),
        client: await db.client.count({ where: { workspaceId: workspaces } }),
        assignment: await db.clientProviderAccountAssignment.count({ where: { workspaceId: workspaces } }),
        health: await db.providerAccountHealth.count({ where: { workspaceId: workspaces } }),
        metric: await db.campaignMetric.count({ where: { workspaceId: workspaces } }),
        receipt: await db.destinationDeliveryReceipt.count({ where: { workspaceId: workspaces } }),
        importJob: await db.warehouseImportJob.count({ where: { workspaceId: workspaces } }),
        pipeline: await db.pipeline.count({ where: { workspaceId: workspaces } }),
        syncLog: await db.syncLog.count({ where: { pipelineId: { in: [ids.pipeA, ids.pipeB] } } }),
        auditEvent: await db.auditEvent.count({ where: { workspaceId: workspaces } }),
        agentJob: await db.agentJob.count({ where: { workspaceId: workspaces } }),
      };
    };

    const before = await countRows();
    await loadOperationsSummary({ workspaceId: ids.wsA, now: NOW });
    await loadOperationsSummary({ workspaceId: ids.wsA, requestedClientId: ids.clA, now: NOW });
    await loadOperationsSummary({ workspaceId: ids.wsA, requestedClientId: "all", now: NOW });
    const after = await countRows();

    assert.deepEqual(after, before);
  });

  it("keeps every returned list bounded and every navigation target internal", async () => {
    const summary = await loadOperationsSummary({ workspaceId: ids.wsA, now: NOW });
    for (const [name, value] of Object.entries(summary.sections)) {
      const sectionValue = value as OperationsSection<unknown>;
      assert.ok(sectionValue.limit <= 25, `${name} limit must stay bounded`);
      assert.ok(sectionValue.href.startsWith("/"), `${name} href must be an internal path`);
      assert.equal(/^[a-z]+:/i.test(sectionValue.href), false, `${name} href must not be external`);
      if (sectionValue.state === "unsupported" || sectionValue.state === "unavailable") {
        assert.equal(sectionValue.data, null, `${name} must not fabricate data`);
      }
    }
  });

  it("reports consistent ingestion totals and truthful attention when failures fall outside the bounded scan", async () => {
    const wsIngest = `ws-ingest-${suffix}`;
    const createdIds: string[] = [];
    await db.workspace.create({
      data: { id: wsIngest, ownerId: ids.ownerA, name: "Ops Ingest", slug: `ops-ingest-${suffix}`, plan: "professional" },
    });
    await db.warehouseImportJob.createMany({
      data: [
        ...Array.from({ length: 5 }, (_, index) => {
          const id = `job-old-failed-${suffix}-${index}`;
          createdIds.push(id);
          return {
            id,
            workspaceId: wsIngest,
            userId: ids.ownerA,
            since: "2026-09-01",
            until: "2026-09-07",
            items: [],
            status: "failed",
            errorMsg: "older failure",
            createdAt: new Date(`2026-09-08T0${index}:00:00.000Z`),
          };
        }),
        ...Array.from({ length: 25 }, (_, index) => {
          const id = `job-recent-completed-${suffix}-${index}`;
          createdIds.push(id);
          return {
            id,
            workspaceId: wsIngest,
            userId: ids.ownerA,
            since: "2026-09-01",
            until: "2026-09-07",
            items: [],
            status: "completed",
            createdAt: new Date(`2026-09-09T11:${String(index).padStart(2, "0")}:00.000Z`),
          };
        }),
      ],
    });
    try {
      const summary = await loadOperationsSummary({ workspaceId: wsIngest, now: NOW });
      const totals = summary.sections.ingestion.data!.totals;
      // The bounded scan keeps only the newest 25 jobs (all completed), so the
      // five older failures are visible ONLY through the grouped counts.
      assert.equal(totals.total, 30);
      assert.equal(totals.completed, 25);
      assert.equal(totals.failed, 5);
      assert.equal(
        totals.completed + totals.failed + totals.partial + totals.queued + totals.running,
        totals.total,
        "per-status counts must sum to the authoritative total",
      );
      assert.equal(summary.sections.ingestion.truncated, true);
      assert.equal(summary.sections.ingestion.state, "attention");
    } finally {
      await db.warehouseImportJob.deleteMany({ where: { id: { in: createdIds } } });
      await db.workspace.delete({ where: { id: wsIngest } });
    }
  });

  it("derives connector health from the whole population, not the bounded list", async () => {
    const wsTrunc = `ws-trunc-${suffix}`;
    const connTrunc = `conn-trunc-${suffix}`;
    await db.workspace.create({
      data: { id: wsTrunc, ownerId: ids.ownerA, name: "Ops Trunc", slug: `ops-trunc-${suffix}`, plan: "professional" },
    });
    await db.connection.create({
      data: {
        id: connTrunc,
        workspaceId: wsTrunc,
        name: "Filler",
        provider: "google_ads",
        type: "source",
        status: "connected",
        remoteAccountId: `trunc-${suffix}`,
        credentials: "{}",
      },
    });
    try {
      // 30 healthy accounts exceed the 25-row list bound. The state is derived
      // from the whole population, so this must NOT be a false `attention`.
      await db.providerAccountHealth.createMany({
        data: Array.from({ length: 30 }, (_, index) => ({
          workspaceId: wsTrunc,
          connectionId: connTrunc,
          provider: "google_ads",
          accountId: `acct-${String(index).padStart(3, "0")}`,
          status: "healthy",
        })),
      });
      const healthy = await loadOperationsSummary({ workspaceId: wsTrunc, now: NOW });
      assert.equal(healthy.sections.connectorHealth.data?.totals.total, 30);
      assert.equal(healthy.sections.connectorHealth.data?.totals.healthy, 30);
      assert.equal(healthy.sections.connectorHealth.data?.attention.length, 0);
      assert.equal(healthy.sections.connectorHealth.truncated, false);
      assert.equal(healthy.sections.connectorHealth.state, "ready");

      // 26 attention-worthy accounts exceed the list bound: the state must be
      // `attention`, the totals must cover the whole population, and the capped
      // display list is disclosed as truncated.
      await db.providerAccountHealth.createMany({
        data: Array.from({ length: 26 }, (_, index) => ({
          workspaceId: wsTrunc,
          connectionId: connTrunc,
          provider: "google_ads",
          accountId: `deg-${String(index).padStart(3, "0")}`,
          status: "degraded",
          consecutiveFailures: 2,
        })),
      });
      const degraded = await loadOperationsSummary({ workspaceId: wsTrunc, now: NOW });
      assert.equal(degraded.sections.connectorHealth.data?.totals.total, 56);
      assert.equal(degraded.sections.connectorHealth.data?.totals.degraded, 26);
      assert.equal(degraded.sections.connectorHealth.data?.attention.length, 25);
      assert.equal(degraded.sections.connectorHealth.truncated, true);
      assert.equal(degraded.sections.connectorHealth.state, "attention");
    } finally {
      await db.providerAccountHealth.deleteMany({ where: { workspaceId: wsTrunc } });
      await db.connection.deleteMany({ where: { workspaceId: wsTrunc } });
      await db.workspace.delete({ where: { id: wsTrunc } });
    }
  });

  it("detects a stale delivery pair that the bounded receipt scan cannot see", async () => {
    const wsDel = `ws-del-${suffix}`;
    const clDel = `cl-del-${suffix}`;
    await db.workspace.create({
      data: { id: wsDel, ownerId: ids.ownerA, name: "Ops Delivery", slug: `ops-del-${suffix}`, plan: "professional" },
    });
    await db.client.create({
      data: { id: clDel, workspaceId: wsDel, name: "Delivery Client", accountAssignmentsConfiguredAt: NOW },
    });
    const staleAt = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    try {
      await db.destinationDeliveryReceipt.createMany({
        data: [
          // One stale pair ...
          {
            workspaceId: wsDel,
            clientId: clDel,
            destination: "looker",
            windowStart: "2026-08-01",
            windowEnd: "2026-08-07",
            dataThroughDate: "2026-08-07",
            datasetFingerprint: "fp-stale",
            rowCount: 5,
            retrievedAt: staleAt,
            actorId: ids.ownerA,
          },
          // ... plus enough fresh receipts to push it out of the bounded scan,
          // which is ordered `retrievedAt desc` and therefore drops the oldest.
          ...Array.from({ length: 201 }, () => ({
            workspaceId: wsDel,
            clientId: clDel,
            destination: "google_sheets",
            windowStart: "2026-09-01",
            windowEnd: "2026-09-07",
            dataThroughDate: "2026-09-07",
            datasetFingerprint: "fp-fresh",
            rowCount: 9,
            retrievedAt: NOW,
            actorId: ids.ownerA,
          })),
        ],
      });
      const summary = await loadOperationsSummary({ workspaceId: wsDel, now: NOW });
      const section = summary.sections.delivery;
      // Authoritative totals count BOTH pairs, including the stale one that the
      // bounded display scan could not retain.
      assert.equal(section.data?.totals.receipts, 2);
      assert.equal(section.data?.totals.stale, 1);
      assert.equal(section.data?.latest.length, 1, "the bounded scan only retained the fresh pair");
      assert.equal(section.truncated, true);
      assert.equal(section.state, "attention");
    } finally {
      await db.destinationDeliveryReceipt.deleteMany({ where: { workspaceId: wsDel } });
      await db.client.deleteMany({ where: { workspaceId: wsDel } });
      await db.workspace.delete({ where: { id: wsDel } });
    }
  });

  it("discloses the readiness display cap without letting it change the state", async () => {
    const wsReady = `ws-ready-${suffix}`;
    const readyClientIds = Array.from(
      { length: 11 },
      (_, index) => `cl-ready-${suffix}-${String(index).padStart(2, "0")}`,
    );
    await db.workspace.create({
      data: { id: wsReady, ownerId: ids.ownerA, name: "Ops Readiness", slug: `ops-ready-${suffix}`, plan: "professional" },
    });
    try {
      await db.client.createMany({
        data: readyClientIds.map((id, index) => ({
          id,
          workspaceId: wsReady,
          name: `Ready ${index}`,
          accountAssignmentsConfiguredAt: NOW,
        })),
      });
      // 11 clients exceed the 10-client DISPLAY bound. The state still covers all
      // of them (11 <= the 50-client evaluation ceiling), so the section must not
      // fail closed - but the capped list must still be disclosed.
      const wide = await loadOperationsSummary({ workspaceId: wsReady, now: NOW });
      assert.equal(wide.sections.readiness.data?.evaluatedClients, 11);
      assert.equal(wide.sections.readiness.data?.clients.length, 10);
      assert.equal(wide.sections.readiness.truncated, true);

      // Narrowing below the display bound clears the disclosure.
      await db.client.deleteMany({ where: { workspaceId: wsReady, id: { in: readyClientIds.slice(3) } } });
      const narrow = await loadOperationsSummary({ workspaceId: wsReady, now: NOW });
      assert.equal(narrow.sections.readiness.data?.evaluatedClients, 3);
      assert.equal(narrow.sections.readiness.data?.clients.length, 3);
      assert.equal(narrow.sections.readiness.truncated, false);
    } finally {
      await db.client.deleteMany({ where: { workspaceId: wsReady } });
      await db.workspace.delete({ where: { id: wsReady } });
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Sync-log ingestion window                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Real-PostgreSQL coverage for the ingestion window applied to `SyncLog`.
 *
 * `SyncLog` reaches the workspace only through `pipeline.workspaceId`, so the
 * window predicate is the ONLY thing separating "a failure this workspace
 * should act on" from "a historical failure that must stay buried". These
 * tests pin the boundary from both sides and, critically, pin the AUTHORITATIVE
 * COUNT as well as the bounded detail list -- an unbounded count would keep the
 * section in `attention` forever while the details stayed empty.
 *
 * Every case drives the window from an injected `now`; none depend on the wall
 * clock.
 */
describe("PostgreSQL integration: operations summary sync-log ingestion window", () => {
  let db: PrismaClient;
  const suffix = `opslog-${Date.now()}-${process.pid}`;

  // Injected clock: the single source of truth for the window.
  const NOW = new Date("2026-06-15T12:00:00.000Z");
  const DAY_MS = 24 * 60 * 60 * 1000;
  const SINCE = new Date(NOW.getTime() - OPERATIONS_INGESTION_WINDOW_DAYS * DAY_MS);

  const ids = {
    ownerOwn: `u-log-own-${suffix}`,
    ownerRival: `u-log-rival-${suffix}`,
    wsOwn: `ws-log-own-${suffix}`,
    wsRival: `ws-log-rival-${suffix}`,
    clientOwn: `cl-log-own-${suffix}`,
    clientRival: `cl-log-rival-${suffix}`,
    srcOwn: `src-log-own-${suffix}`,
    dstOwn: `dst-log-own-${suffix}`,
    srcRival: `src-log-rival-${suffix}`,
    dstRival: `dst-log-rival-${suffix}`,
    pipeOwn: `pipe-log-own-${suffix}`,
    pipeRival: `pipe-log-rival-${suffix}`,
  };

  // Boundary probes. `OUT_*` sit strictly before the window opens.
  const OUT_OLD = new Date(NOW.getTime() - 30 * DAY_MS);
  const OUT_BEFORE_BOUNDARY = new Date(SINCE.getTime() - 1);
  const BOUNDARY = new Date(SINCE.getTime());
  const IN_AFTER_BOUNDARY = new Date(SINCE.getTime() + 1);
  const IN_FRESH = new Date("2026-06-10T00:00:00.000Z");
  const FUTURE = new Date("2026-06-16T12:00:00.000Z");

  type SeedLog = { pipelineId: string; status: string; errorMsg: string; createdAt: Date };

  async function seedLogs(rows: SeedLog[]): Promise<void> {
    await db.syncLog.deleteMany({ where: { pipelineId: { in: [ids.pipeOwn, ids.pipeRival] } } });
    if (rows.length > 0) {
      await db.syncLog.createMany({ data: rows });
    }
  }

  /** Loads the ingestion section, proving the window came from the injected clock. */
  async function ingestion(workspaceId: string) {
    const summary = await loadOperationsSummary({ workspaceId, now: NOW });
    assert.equal(summary.generatedAt, NOW.toISOString(), "the injected clock must drive the window");
    return summary.sections.ingestion;
  }

  before(async () => {
    const url = assertAllowedTestDatabase(process.env.DATABASE_URL);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();

    await db.user.createMany({
      data: [
        { id: ids.ownerOwn, email: `${ids.ownerOwn}@example.test`, name: "Log Own" },
        { id: ids.ownerRival, email: `${ids.ownerRival}@example.test`, name: "Log Rival" },
      ],
    });
    await db.workspace.createMany({
      data: [
        { id: ids.wsOwn, ownerId: ids.ownerOwn, name: "Log Own", slug: `log-own-${suffix}`, plan: "professional" },
        { id: ids.wsRival, ownerId: ids.ownerRival, name: "Log Rival", slug: `log-rival-${suffix}`, plan: "professional" },
      ],
    });
    await db.workspaceMember.createMany({
      data: [
        { workspaceId: ids.wsOwn, userId: ids.ownerOwn, role: "owner" },
        { workspaceId: ids.wsRival, userId: ids.ownerRival, role: "owner" },
      ],
    });
    await db.client.createMany({
      data: [
        { id: ids.clientOwn, workspaceId: ids.wsOwn, name: "Own Client", accountAssignmentsConfiguredAt: NOW },
        { id: ids.clientRival, workspaceId: ids.wsRival, name: "Rival Client", accountAssignmentsConfiguredAt: NOW },
      ],
    });
    await db.connection.createMany({
      data: [
        { id: ids.srcOwn, workspaceId: ids.wsOwn, name: "Own Src", provider: "google_ads", type: "source", status: "connected", remoteAccountId: `lso-${suffix}`, credentials: "{}" },
        { id: ids.dstOwn, workspaceId: ids.wsOwn, name: "Own Dst", provider: "google_sheets", type: "destination", status: "connected", remoteAccountId: `ldo-${suffix}`, credentials: "{}" },
        { id: ids.srcRival, workspaceId: ids.wsRival, name: "Rival Src", provider: "google_ads", type: "source", status: "connected", remoteAccountId: `lsr-${suffix}`, credentials: "{}" },
        { id: ids.dstRival, workspaceId: ids.wsRival, name: "Rival Dst", provider: "google_sheets", type: "destination", status: "connected", remoteAccountId: `ldr-${suffix}`, credentials: "{}" },
      ],
    });
    await db.pipeline.createMany({
      data: [
        { id: ids.pipeOwn, workspaceId: ids.wsOwn, name: "Own Pipe", sourceConnectionId: ids.srcOwn, destinationConnectionId: ids.dstOwn },
        { id: ids.pipeRival, workspaceId: ids.wsRival, name: "Rival Pipe", sourceConnectionId: ids.srcRival, destinationConnectionId: ids.dstRival },
      ],
    });
  });

  after(async () => {
    try {
      await db.syncLog.deleteMany({ where: { pipelineId: { in: [ids.pipeOwn, ids.pipeRival] } } });
      await db.pipeline.deleteMany({ where: { workspaceId: { in: [ids.wsOwn, ids.wsRival] } } });
      await db.connection.deleteMany({ where: { workspaceId: { in: [ids.wsOwn, ids.wsRival] } } });
      await db.client.deleteMany({ where: { workspaceId: { in: [ids.wsOwn, ids.wsRival] } } });
      await db.workspaceMember.deleteMany({ where: { workspaceId: { in: [ids.wsOwn, ids.wsRival] } } });
      await db.workspace.deleteMany({ where: { id: { in: [ids.wsOwn, ids.wsRival] } } });
      await db.user.deleteMany({ where: { id: { in: [ids.ownerOwn, ids.ownerRival] } } });
    } finally {
      await db.$disconnect();
    }
  });

  it("ignores a sync-log failure older than the declared ingestion window", async () => {
    await seedLogs([{ pipelineId: ids.pipeOwn, status: "error", errorMsg: "stale", createdAt: OUT_OLD }]);
    const section = await ingestion(ids.wsOwn);
    assert.equal(section.state, "empty");
    assert.equal(section.data!.syncLogErrors.length, 0);
    assert.equal(section.data!.totals.failed, 0);
  });

  it("ignores a sync-log failure one millisecond before the window opens", async () => {
    await seedLogs([{ pipelineId: ids.pipeOwn, status: "error", errorMsg: "before", createdAt: OUT_BEFORE_BOUNDARY }]);
    const section = await ingestion(ids.wsOwn);
    assert.equal(section.state, "empty");
    assert.equal(section.data!.syncLogErrors.length, 0);
  });

  it("includes a sync-log failure exactly on the window boundary", async () => {
    await seedLogs([{ pipelineId: ids.pipeOwn, status: "error", errorMsg: "boundary", createdAt: BOUNDARY }]);
    const section = await ingestion(ids.wsOwn);
    assert.equal(section.state, "attention");
    assert.equal(section.data!.syncLogErrors.length, 1);
    assert.equal(section.data!.syncLogErrors[0]!.createdAt, BOUNDARY.toISOString());
  });

  it("includes a sync-log failure one millisecond after the window opens", async () => {
    await seedLogs([{ pipelineId: ids.pipeOwn, status: "failed", errorMsg: "after", createdAt: IN_AFTER_BOUNDARY }]);
    const section = await ingestion(ids.wsOwn);
    assert.equal(section.state, "attention");
    assert.equal(section.data!.syncLogErrors.length, 1);
  });

  it("keeps only in-window failures when stale and fresh failures are mixed", async () => {
    await seedLogs([
      { pipelineId: ids.pipeOwn, status: "error", errorMsg: "stale", createdAt: OUT_OLD },
      { pipelineId: ids.pipeOwn, status: "error", errorMsg: "fresh", createdAt: IN_FRESH },
    ]);
    const section = await ingestion(ids.wsOwn);
    assert.equal(section.state, "attention");
    assert.deepEqual(section.data!.syncLogErrors.map((entry) => entry.errorSummary), ["fresh"]);
  });

  it("derives the latest-failure timestamp from in-window rows only", async () => {
    // Pre-fix the out-of-window row sorts FIRST (it is one millisecond newer),
    // so the UI advertised a timestamp from outside the window it claims.
    await seedLogs([
      { pipelineId: ids.pipeOwn, status: "error", errorMsg: "just-outside", createdAt: OUT_BEFORE_BOUNDARY },
      { pipelineId: ids.pipeOwn, status: "error", errorMsg: "just-inside", createdAt: BOUNDARY },
    ]);
    const section = await ingestion(ids.wsOwn);
    const newest = section.data!.syncLogErrors[0]!;
    assert.equal(newest.errorSummary, "just-inside");
    assert.equal(newest.createdAt, BOUNDARY.toISOString());
    assert.equal(section.data!.syncLogErrors.length, 1);
  });

  it("binds the authoritative count to the window, not just the bounded detail list", async () => {
    await seedLogs(
      Array.from({ length: 30 }, (_, index) => ({
        pipelineId: ids.pipeOwn,
        status: "error",
        errorMsg: `stale-${index}`,
        createdAt: new Date(OUT_OLD.getTime() + index * 1000),
      })),
    );
    const section = await ingestion(ids.wsOwn);
    assert.equal(section.state, "empty", "an unbounded count would pin this section in attention forever");
    assert.equal(section.data!.syncLogErrors.length, 0);
    assert.equal(section.truncated, false);
  });

  it("still reports attention for in-window failures beyond the bounded detail list", async () => {
    await seedLogs(
      Array.from({ length: OPERATIONS_LIST_LIMIT + 5 }, (_, index) => ({
        pipelineId: ids.pipeOwn,
        status: "error",
        errorMsg: `fresh-${index}`,
        createdAt: new Date(IN_FRESH.getTime() + index * 1000),
      })),
    );
    const section = await ingestion(ids.wsOwn);
    assert.equal(section.state, "attention");
    assert.equal(section.data!.syncLogErrors.length, OPERATIONS_LIST_LIMIT, "the detail list stays bounded");
    assert.equal(section.truncated, true);
  });

  it("never surfaces a rival workspace's sync-log failure, in or out of window", async () => {
    await seedLogs([
      { pipelineId: ids.pipeRival, status: "error", errorMsg: "rival-stale", createdAt: OUT_OLD },
      { pipelineId: ids.pipeRival, status: "error", errorMsg: "rival-fresh", createdAt: IN_FRESH },
    ]);

    const own = await ingestion(ids.wsOwn);
    assert.equal(own.state, "empty");
    assert.equal(own.data!.syncLogErrors.length, 0);

    const rival = await ingestion(ids.wsRival);
    assert.equal(rival.state, "attention");
    assert.deepEqual(rival.data!.syncLogErrors.map((entry) => entry.errorSummary), ["rival-fresh"]);
  });

  it("treats a future-dated failure as in-window evidence (no upper bound on purpose)", async () => {
    await seedLogs([{ pipelineId: ids.pipeOwn, status: "error", errorMsg: "future", createdAt: FUTURE }]);
    const section = await ingestion(ids.wsOwn);
    assert.equal(section.state, "attention");
    assert.equal(section.data!.syncLogErrors.length, 1);
  });

  it("stays empty when the window holds only successful sync logs", async () => {
    await seedLogs([
      { pipelineId: ids.pipeOwn, status: "success", errorMsg: "", createdAt: IN_FRESH },
      { pipelineId: ids.pipeOwn, status: "running", errorMsg: "", createdAt: IN_FRESH },
    ]);
    const section = await ingestion(ids.wsOwn);
    assert.equal(section.state, "empty");
  });

  it("advertises the same window the predicate enforces", async () => {
    await seedLogs([]);
    const section = await ingestion(ids.wsOwn);
    assert.equal(OPERATIONS_INGESTION_WINDOW_DAYS, 7);
    assert.equal(section.data!.windowDays, OPERATIONS_INGESTION_WINDOW_DAYS);
  });
});
