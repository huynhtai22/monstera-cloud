import assert from "node:assert/strict";
import { before, after, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertCiDatabaseReachableWhenMissing } from "@/lib/pg-test-discipline";
import { buildArtifact, verifyArtifactIntegrity } from "./foundation";
import { evaluateGoogleGateA } from "./google-gate-a";
import { replayGateAEvaluation } from "./foundation";
import { publishGateAVerdict } from "./publish";
import type { GateAEvaluation, RuntimeArtifact } from "./types";

assertCiDatabaseReachableWhenMissing();
describe("Connector Runtime v1 fenced publication — real PostgreSQL", { skip: !process.env.DATABASE_URL }, () => {
  const db = new PrismaClient();
  const id = randomUUID();
  const ws = `rt-${id}`;
  const operator = `rt-operator-${id}`;
  const plainUser = `rt-user-${id}`;
  const conn = `rt-conn-${id}`;
  const run = `rt-run-${id}`;

  const evaluation: GateAEvaluation = {
    verdict: "PASS",
    reasons: [],
    artifactHashes: [],
    evaluatedAt: new Date().toISOString(),
  };

  before(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.ok(["/monstera_security_test", "/monstera_ci"].includes(url.pathname));
    await db.user.createMany({
      data: [
        { id: operator, email: `${operator}@example.test`, platformRole: "OPERATOR" },
        { id: plainUser, email: `${plainUser}@example.test`, platformRole: "USER" },
      ],
    });
    await db.workspace.create({ data: { id: ws, slug: ws, name: ws, ownerId: operator } });
  });

  beforeEach(async () => {
    await db.connectorRunArtifact.deleteMany({ where: { workspaceId: ws } });
    await db.auditEvent.deleteMany({ where: { workspaceId: ws } });
  });

  after(async () => {
    await db.connectorRunArtifact.deleteMany({ where: { workspaceId: ws } });
    await db.auditEvent.deleteMany({ where: { workspaceId: ws } });
    await db.workspace.deleteMany({ where: { id: ws } });
    await db.user.deleteMany({ where: { id: { in: [operator, plainUser] } } });
    await db.$disconnect();
  });

  async function auditCount() {
    return db.auditEvent.count({
      where: { workspaceId: ws, action: "connector_runtime.gate_a_published" },
    });
  }

  it("publishes the verdict artifact and exactly one audit event with 30-day retention", async () => {
    const before = new Date();
    const result = await publishGateAVerdict({
      workspaceId: ws,
      connectionId: conn,
      runId: run,
      provider: "google_ads",
      evaluation,
      actorUserId: operator,
    });
    assert.equal(result.verdict, "PASS");

    const record = await db.connectorRunArtifact.findUniqueOrThrow({ where: { id: result.artifactId } });
    assert.equal(record.provider, "google_ads");
    assert.equal(record.kind, "gate_a_verdict");
    verifyArtifactIntegrity({
      id: record.id,
      workspaceId: record.workspaceId,
      connectionId: record.connectionId,
      runId: record.runId,
      provider: "google_ads",
      kind: record.kind,
      payloadHash: record.payloadHash,
      payload: record.payload,
      createdAt: record.createdAt.toISOString(),
      retainedUntil: (record.retainedUntil as Date).toISOString(),
    });
    const retainedMs = new Date(record.retainedUntil as unknown as string).getTime() - before.getTime();
    assert.ok(
      retainedMs > 29 * 86_400_000 && retainedMs <= 30 * 86_400_000 + 60_000,
      `retainedUntil must be ~30 days out (got ${retainedMs}ms)`,
    );
    assert.equal(await auditCount(), 1);
  });

  it("duplicate publication conflicts and leaves a single audit event", async () => {
    await publishGateAVerdict({
      workspaceId: ws, connectionId: conn, runId: run,
      provider: "google_ads", evaluation, actorUserId: operator,
    });
    await assert.rejects(
      () =>
        publishGateAVerdict({
          workspaceId: ws, connectionId: conn, runId: run,
          provider: "google_ads", evaluation, actorUserId: operator,
        }),
      /Unique constraint|UniqueConstraint|unique/i,
    );
    assert.equal(await auditCount(), 1);
    assert.equal(await db.connectorRunArtifact.count({ where: { workspaceId: ws } }), 1);
  });

  it("rejects non-operator publishers and non-Google providers before any write", async () => {
    await assert.rejects(
      () =>
        publishGateAVerdict({
          workspaceId: ws, connectionId: conn, runId: run,
          provider: "google_ads", evaluation, actorUserId: plainUser,
        }),
      /OPERATOR/,
    );
    await assert.rejects(
      () =>
        publishGateAVerdict({
          workspaceId: ws, connectionId: conn, runId: run,
          provider: "meta_ads", evaluation, actorUserId: operator,
        }),
      /Only google_ads/,
    );
    assert.equal(await db.connectorRunArtifact.count({ where: { workspaceId: ws } }), 0);
    assert.equal(await auditCount(), 0);
  });

  it("replays persisted artifacts with zero provider calls", async () => {
    const kinds = ["connection", "report", "warehouse", "reconciliation"] as const;
    const stored: RuntimeArtifact[] = [];
    for (const kind of kinds) {
      const artifact = buildArtifact({
        workspaceId: ws, connectionId: conn, runId: run,
        provider: "google_ads", kind, payload: { kind, sealed: true },
      });
      await db.connectorRunArtifact.create({
        data: {
          workspaceId: ws, connectionId: conn, runId: run, provider: "google_ads", kind,
          payloadHash: artifact.payloadHash, payload: JSON.parse(JSON.stringify(artifact.payload)),
          retainedUntil: new Date(artifact.retainedUntil),
        },
      });
      stored.push(artifact);
    }
    const rows = await db.connectorRunArtifact.findMany({ where: { workspaceId: ws, runId: run } });
    assert.equal(rows.length, 4);
    const loaded: RuntimeArtifact[] = rows.map((row) => ({
      id: row.id, workspaceId: row.workspaceId, connectionId: row.connectionId, runId: row.runId,
      provider: "google_ads", kind: row.kind, payloadHash: row.payloadHash, payload: row.payload,
      createdAt: (row.createdAt as Date).toISOString(),
      retainedUntil: (row.retainedUntil as Date).toISOString(),
    }));

    let providerCalls = 0;
    const gateway = {
      fetchReport: async () => { providerCalls += 1; return null; },
      fetchAccount: async () => { providerCalls += 1; return null; },
    };
    const direct = evaluateGoogleGateA({
      provider: "google_ads", runId: run, artifacts: stored,
      warehouse: { rowsWritten: 40, zeroRowJustified: false },
      reconciliation: { variances: [{ metric: "spend", percentVariance: 1 }], tolerancePercent: 5 },
    });
    const replayed = replayGateAEvaluation(loaded, gateway, (artifacts) =>
      evaluateGoogleGateA({
        provider: "google_ads", runId: run, artifacts,
        warehouse: { rowsWritten: 40, zeroRowJustified: false },
        reconciliation: { variances: [{ metric: "spend", percentVariance: 1 }], tolerancePercent: 5 },
      }),
    );
    // evaluatedAt is wall-clock metadata: compare everything else exactly,
    // then assert its presence and shape separately (millisecond straddles
    // across two evaluations are expected, not evidence of divergence).
    const { evaluatedAt: _replayedAt, ...replayedRest } = replayed;
    const { evaluatedAt: _directAt, ...directRest } = direct;
    assert.deepEqual(replayedRest, directRest);
    assert.match(_replayedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(_directAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(replayed.verdict, "PASS");
    assert.equal(providerCalls, 0);
  });
});
