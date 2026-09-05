import assert from "node:assert/strict";
import { before, after, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertCiDatabaseReachableWhenMissing } from "@/lib/pg-test-discipline";
import { acquireConnectionSyncLease } from "../connection-sync-lease";
import { buildConnectionScope } from "../connection-sync-lease";
import { normalizeGoogleAdsRow } from "../google-ads";
import { executeGoogleShadowRun } from "./google-shadow";
import { cleanupExpiredArtifacts } from "./retention";
import type { GoogleShadowCapture } from "./google-shadow";

assertCiDatabaseReachableWhenMissing();
describe("Google shadow integration — real PostgreSQL", { skip: !process.env.DATABASE_URL }, () => {
  const db = new PrismaClient();
  const id = randomUUID();
  const ws = `sh-${id}`;
  const rival = `sh-rival-${id}`;
  const owner = `sh-owner-${id}`;
  const conn = `sh-conn-${id}`;
  const run = `sh-run-${id}`;

  function rawBatch(campaigns: Array<{ id: string; spendMicros: string }>) {
    return JSON.stringify([
      {
        results: campaigns.map((c) => ({
          campaign: { id: c.id, name: `Camp ${c.id}`, status: "ENABLED" },
          customer: { currency_code: "USD", time_zone: "America/New_York" },
          metrics: {
            impressions: "100",
            clicks: "10",
            cost_micros: c.spendMicros,
            conversions: "1",
            conversions_value: "5.0",
            ctr: "0.1",
            average_cpc: "100000",
          },
          segments: { date: "2026-09-01" },
        })),
      },
    ]);
  }

  function capture(customerId: string, campaigns: Array<{ id: string; spendMicros: string }>): GoogleShadowCapture {
    // Mirrors the sync flow: normalizedRows are the legacy normalizer output
    // for the same raw response the runtime replays from.
    const raw = rawBatch(campaigns);
    const normalizedRows = (JSON.parse(raw)[0].results as Array<Record<string, unknown>>).map(
      (row) => normalizeGoogleAdsRow(row as never) as unknown as Record<string, unknown>,
    );
    return {
      customerId,
      rawTexts: [raw],
      normalizedRows,
      timezone: "America/New_York",
      currency: "USD",
    };
  }

  async function leaseFor(workspaceId: string, connectionId: string) {
    const attempt = await acquireConnectionSyncLease({
      provider: "google_ads",
      workspaceId,
      connectionId,
      jobId: "shadow-test",
    });
    assert.equal(attempt.acquired, true);
    assert.ok("lease" in attempt && attempt.lease);
    return (attempt as { acquired: true; lease: { scope: string; leaseId: string; fencingToken: bigint } }).lease;
  }

  before(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.ok(["/monstera_security_test", "/monstera_ci"].includes(url.pathname));
    await db.user.create({ data: { id: owner, email: `${owner}@example.test` } });
    await db.workspace.createMany({
      data: [
        { id: ws, slug: ws, name: ws, ownerId: owner },
        { id: rival, slug: rival, name: rival, ownerId: owner },
      ],
    });
    await db.workspaceMember.create({ data: { workspaceId: ws, userId: owner, role: "owner" } });
  });

  async function cleanScopes() {
    await db.connectorRunArtifact.deleteMany({ where: { workspaceId: { in: [ws, rival] } } });
    await db.auditEvent.deleteMany({ where: { workspaceId: { in: [ws, rival] } } });
    await db.syncLock.deleteMany({ where: { workspaceId: { in: [ws, rival] } } });
  }

  beforeEach(cleanScopes);

  after(async () => {
    await db.connectorRunArtifact.deleteMany({ where: { workspaceId: { in: [ws, rival] } } });
    await db.auditEvent.deleteMany({ where: { workspaceId: { in: [ws, rival] } } });
    await db.syncLock.deleteMany({
      where: { scope: { in: [buildConnectionScope({ provider: "google_ads", workspaceId: ws, connectionId: conn }), buildConnectionScope({ provider: "google_ads", workspaceId: rival, connectionId: conn })] } },
    });
    await db.workspace.deleteMany({ where: { id: { in: [ws, rival] } } });
    await db.user.deleteMany({ where: { id: owner } });
    await db.$disconnect();
  });

  async function artifactCount(workspaceId: string) {
    return db.connectorRunArtifact.count({ where: { workspaceId } });
  }
  async function auditCount(workspaceId: string) {
    return db.auditEvent.count({ where: { workspaceId } });
  }
  async function metricCount(workspaceId: string) {
    return db.campaignMetric.count({ where: { workspaceId } });
  }

  it("publishes chunks, comparison and exactly one audit without touching warehouse rows", async () => {
    const lease = await leaseFor(ws, conn);
    const result = await executeGoogleShadowRun({
      workspaceId: ws,
      connectionId: conn,
      runId: run,
      legacyVersion: "legacy-sync-test",
      captures: [
        capture("111", [
          { id: "1", spendMicros: "10000000" },
          { id: "2", spendMicros: "20000000" },
        ]),
      ],
      lease,
    });
    assert.equal(result.published, true);
    assert.equal(result.pass, true);
    assert.equal(result.artifactIds.length, 2);

    const comparison = await db.connectorRunArtifact.findFirstOrThrow({
      where: { workspaceId: ws, runId: run, kind: "shadow_comparison" },
    });
    const evidence = comparison.payload as any;
    assert.equal(evidence.pass, true);
    assert.deepEqual(evidence.comparedRowCounts, { legacy: 2, runtime: 2 });
    assert.equal(evidence.runtimeVersion, "1.0.0-shadow");
    assert.equal(evidence.legacyVersion, "legacy-sync-test");
    assert.equal(await auditCount(ws), 1);
    assert.equal(await metricCount(ws), 0);
  });

  it("stale lease publishes nothing", async () => {
    const lease = await leaseFor(ws, conn);
    await db.syncLock.update({
      where: { scope: lease.scope },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    const result = await executeGoogleShadowRun({
      workspaceId: ws,
      connectionId: conn,
      runId: run,
      legacyVersion: "legacy-sync-test",
      captures: [capture("111", [{ id: "1", spendMicros: "10000000" }])],
      lease,
    });
    assert.equal(result.published, false);
    assert.equal(result.pass, false);
    assert.equal(await artifactCount(ws), 0);
    assert.equal(await auditCount(ws), 0);
  });

  it("duplicate run is a deterministic conflict with a single comparison and audit", async () => {
    const lease = await leaseFor(ws, conn);
    const first = await executeGoogleShadowRun({
      workspaceId: ws,
      connectionId: conn,
      runId: run,
      legacyVersion: "legacy-sync-test",
      captures: [capture("111", [{ id: "1", spendMicros: "10000000" }])],
      lease,
    });
    assert.equal(first.published, true);
    const second = await executeGoogleShadowRun({
      workspaceId: ws,
      connectionId: conn,
      runId: run,
      legacyVersion: "legacy-sync-test",
      captures: [capture("111", [{ id: "1", spendMicros: "10000000" }])],
      lease,
    });
    assert.equal(second.published, false);
    assert.equal(second.failureCode, "already-published");
    assert.equal(second.artifactIds.length, 1);
    assert.ok(first.artifactIds.includes(second.artifactIds[0]));
    assert.equal(
      await db.connectorRunArtifact.count({ where: { workspaceId: ws, kind: "shadow_comparison" } }),
      1,
    );
    assert.equal(await auditCount(ws), 1);
  });

  it("cross-workspace lease use fails closed with zero writes", async () => {
    const lease = await leaseFor(rival, conn);
    const result = await executeGoogleShadowRun({
      workspaceId: ws,
      connectionId: conn,
      runId: run,
      legacyVersion: "legacy-sync-test",
      captures: [capture("111", [{ id: "1", spendMicros: "10000000" }])],
      lease,
    });
    assert.equal(result.published, false);
    assert.equal(await artifactCount(ws), 0);
    assert.equal(await artifactCount(rival), 0);
    assert.equal(await auditCount(ws), 0);
    assert.equal(await auditCount(rival), 0);
  });

  it("corrupt raw capture records a bounded failure without a comparison", async () => {
    const lease = await leaseFor(ws, conn);
    const result = await executeGoogleShadowRun({
      workspaceId: ws,
      connectionId: conn,
      runId: run,
      legacyVersion: "legacy-sync-test",
      captures: [{ customerId: "111", rawTexts: ["definitely-not-json{{{"] , normalizedRows: [], timezone: "UTC", currency: "USD" }],
      lease,
    });
    assert.equal(result.published, false);
    assert.equal(result.pass, false);
    assert.equal(
      await db.connectorRunArtifact.count({ where: { workspaceId: ws, kind: "shadow_comparison" } }),
      0,
    );
    const failure = await db.connectorRunArtifact.findFirstOrThrow({
      where: { workspaceId: ws, runId: run, kind: "shadow_failure" },
    });
    assert.deepEqual(Object.keys(failure.payload as object).sort(), ["code", "retryable", "stage"]);
    assert.equal(await auditCount(ws), 1);
  });

  it("cleanup deletes expired artifacts only, preserves evidence, and is idempotent", async () => {
    const lease = await leaseFor(ws, conn);
    await executeGoogleShadowRun({
      workspaceId: ws,
      connectionId: conn,
      runId: run,
      legacyVersion: "legacy-sync-test",
      captures: [capture("111", [{ id: "1", spendMicros: "10000000" }])],
      lease,
    });
    const past = new Date(Date.now() - 60_000);
    await db.connectorRunArtifact.updateMany({
      where: { workspaceId: ws, kind: { startsWith: "shadow_raw" } },
      data: { retainedUntil: past },
    });
    await db.evidencePackRecord.create({
      data: { workspaceId: ws, jobId: `cert-${run}`, pack: { sealed: true } },
    });

    const first = await cleanupExpiredArtifacts({ before: new Date(), limit: 100 });
    assert.equal(first.deleted, 1);
    assert.equal(first.hasMore, false);
    // Unexpired comparison, certification evidence, and unrelated audit rows survive.
    assert.equal(
      await db.connectorRunArtifact.count({ where: { workspaceId: ws, kind: "shadow_comparison" } }),
      1,
    );
    assert.equal(await db.evidencePackRecord.count({ where: { workspaceId: ws } }), 1);

    const second = await cleanupExpiredArtifacts({ before: new Date(), limit: 100 });
    assert.equal(second.deleted, 0);
    const cleanups = await db.auditEvent.count({
      where: { workspaceId: ws, action: "connector_runtime.cleanup" },
    });
    assert.equal(cleanups, 1);
    await db.evidencePackRecord.deleteMany({ where: { workspaceId: ws } });
  });

  it("persists bounded telemetry with the comparison artifact", async () => {
    const lease = await leaseFor(ws, conn);
    const result = await executeGoogleShadowRun({
      workspaceId: ws,
      connectionId: conn,
      runId: run,
      legacyVersion: "legacy-sync-test",
      captures: [capture("111", [{ id: "1", spendMicros: "10000000" }])],
      lease,
    });
    assert.equal(result.published, true);
    assert.ok(result.telemetry);
    const stored = await db.connectorRunArtifact.findFirstOrThrow({
      where: { workspaceId: ws, runId: run, kind: "shadow_comparison" },
    });
    const telemetry = (stored.payload as any).telemetry;
    assert.ok(telemetry);
    assert.equal(typeof telemetry.replayMs, "number");
    assert.equal(typeof telemetry.compareMs, "number");
    assert.equal(telemetry.budgetExceeded, false);
    assert.ok(telemetry.artifactCount >= 2);
    assert.ok(telemetry.capturedBytes > 0);
    assert.equal(telemetry.replayedRowCount, 1);
    assert.deepEqual(telemetry.comparedRowCounts, { legacy: 1, runtime: 1 });
    assert.deepEqual(result.telemetry!.comparedRowCounts, { legacy: 1, runtime: 1 });
  });

  it("exhausted budget fails on real fencing with only a bounded failure record", async () => {
    const lease = await leaseFor(ws, conn);
    const result = await executeGoogleShadowRun({
      workspaceId: ws,
      connectionId: conn,
      runId: run,
      legacyVersion: "legacy-sync-test",
      captures: [capture("111", [{ id: "1", spendMicros: "10000000" }])],
      lease,
      budgetMs: -1,
    });
    assert.equal(result.published, false);
    assert.equal(result.failureCode, "shadow-budget-exhausted");
    // Exactly one bounded failure artifact — never partial rows or a comparison.
    assert.equal(await artifactCount(ws), 1);
    assert.equal(
      await db.connectorRunArtifact.count({ where: { workspaceId: ws, kind: "shadow_failure" } }),
      1,
    );
    assert.equal(
      await db.connectorRunArtifact.count({ where: { workspaceId: ws, kind: "shadow_comparison" } }),
      0,
    );
    assert.equal(await auditCount(ws), 1);
  });
});
