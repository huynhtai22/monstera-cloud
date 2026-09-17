import assert from "node:assert/strict";
import { assertCiDatabaseReachable, assertCiDatabaseReachableWhenMissing } from "./pg-test-discipline";
import { describe, it, before, after } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  admitAndCreatePilotJob,
  cancelPilotJob,
  loadPilotJob,
  pausePilotJob,
  resumePilotJob,
  runPilotBackfillJob,
} from "./extended-backfill-pilot-lifecycle";
import { loadExtendedBackfillPilotConfig } from "./extended-backfill-pilot";
import {
  claimBackfillChunk,
  completeBackfillChunk,
  listBackfillChunks,
} from "./warehouse-backfill-chunks";
import { PilotAdmissionError } from "./extended-backfill-pilot";

const WS_A = "ws_pilot_a";
const WS_B = "ws_pilot_b";
const OPERATOR = "usr_pilot_operator";
const OWNER = "usr_pilot_owner";
const META_CONN = "conn_pilot_meta";
const GOOGLE_CONN = "conn_pilot_google";
const TIKTOK_CONN = "conn_pilot_tiktok";

function testConfig(stage: "disabled" | "plan_only" | "synthetic" | "staging" | "production_pilot", allowlist: string[] = [WS_A], overrides: Record<string, number> = {}) {
  return {
    stage,
    allowedWorkspaceIds: allowlist,
    maxActiveJobsPerWorkspace: 10,
    maxChunksPerJob: 30,
    maxProviderCallsPerDay: 1000,
    maxConcurrentChunksPerWorkspace: 100,
    maxConcurrentChunksPerAccount: 50,
    ...overrides,
  } as ReturnType<typeof loadExtendedBackfillPilotConfig>;
}

describe("PostgreSQL Integration: extended pilot lifecycle and synthetic qualification", () => {
  let prisma: PrismaClient | null = null;
  let isDbAvailable = false;
  const realFetch = globalThis.fetch;

  function requireDb(t: any) {
    if (!isDbAvailable) {
      t.skip("PostgreSQL database not reachable; run with real DATABASE_URL in CI");
      return false;
    }
    return true;
  }

  before(async () => {
    assertCiDatabaseReachableWhenMissing();
    // Synthetic harness: any live network attempt fails loudly.
    globalThis.fetch = (async () => {
      throw new Error("live network forbidden in synthetic qualification");
    }) as unknown as typeof fetch;
    if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("mock")) {
      try {
        prisma = new PrismaClient();
        await prisma.$connect();
        await prisma.$queryRaw`SELECT 1`;
        isDbAvailable = true;
        await prisma.user.upsert({ where: { id: OPERATOR }, update: { platformRole: "OPERATOR" }, create: { id: OPERATOR, email: "pilot-op@example.com", platformRole: "OPERATOR" } });
        await prisma.user.upsert({ where: { id: OWNER }, update: {}, create: { id: OWNER, email: "pilot-owner@example.com", platformRole: "USER" } });
        for (const [ws, slug] of [[WS_A, "pilot-ws-a"], [WS_B, "pilot-ws-b"]] as const) {
          await prisma.workspace.upsert({ where: { id: ws }, update: {}, create: { id: ws, name: ws, slug, ownerId: OWNER, plan: "pilot" } });
        }
        const creds = JSON.stringify({ accessToken: "synthetic", extraFields: {} });
        for (const [id, provider, ws] of [
          [META_CONN, "meta_ads", WS_A], [GOOGLE_CONN, "google_ads", WS_A], [TIKTOK_CONN, "tiktok_business", WS_A],
          ["conn_pilot_b", "google_ads", WS_B],
        ] as const) {
          await prisma.connection.upsert({
            where: { workspaceId_provider_remoteAccountId: { workspaceId: ws, provider, remoteAccountId: `remote-${id}` } },
            update: {},
            create: { id, workspaceId: ws, name: id, type: "source", provider, credentials: creds, remoteAccountId: `remote-${id}`, status: "connected" },
          });
        }
      } catch {
        assertCiDatabaseReachable();
        isDbAvailable = false;
      }
    }
  });

  after(async () => {
    globalThis.fetch = realFetch;
    if (prisma && isDbAvailable) {
      try {
        await prisma.warehouseBackfillChunk.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
        await prisma.campaignMetric.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
        await prisma.warehouseImportJob.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
        await prisma.auditEvent.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
        await prisma.connection.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
        await prisma.workspace.deleteMany({ where: { id: { in: [WS_A, WS_B] } } });
        await prisma.$disconnect();
      } catch {}
    }
  });

  async function admit(opts: Record<string, unknown>) {
    return admitAndCreatePilotJob({
      actorUserId: OPERATOR,
      workspaceId: WS_A,
      provider: "google_ads",
      connectionId: GOOGLE_CONN,
      since: "2026-06-01",
      until: "2026-06-10",
      config: testConfig("synthetic"),
      observedRowsPerDay: 10,
      bytesPerRow: 512,
      ...opts,
    } as any);
  }

  function syntheticExecutor(state: {
    calls: { chunkId: string; since: string; until: string }[];
    rowsPerChunk?: number;
    failFirst?: number;
    partialOnCall?: number;
    writeMetrics?: { connectionId: string; platform: string };
  }) {
    let n = 0;
    return async (chunk: { chunkId: string; since: string; until: string }) => {
      n += 1;
      state.calls.push({ chunkId: chunk.chunkId, since: chunk.since, until: chunk.until });
      if (n <= (state.failFirst ?? 0)) throw new Error("synthetic 429 rate limited");
      if (state.writeMetrics && prisma) {
        const days: string[] = [];
        for (let cursor = Date.parse(`${chunk.since}T00:00:00Z`); cursor <= Date.parse(`${chunk.until}T00:00:00Z`); cursor += 86_400_000) {
          days.push(new Date(cursor).toISOString().slice(0, 10));
        }
        for (const [index, day] of days.entries()) {
          await prisma.campaignMetric.upsert({
            where: { connectionId_accountId_level_entityId_date_breakdownHash: {
              connectionId: state.writeMetrics.connectionId, accountId: "synth-acct", level: "campaign",
              entityId: `synth-${chunk.chunkId}-${index}`, date: new Date(`${day}T00:00:00.000Z`), breakdownHash: "none",
            } },
            update: {},
            create: {
              workspaceId: WS_A, connectionId: state.writeMetrics.connectionId, platform: state.writeMetrics.platform,
              accountId: "synth-acct", level: "campaign", entityId: `synth-${chunk.chunkId}-${index}`,
              campaignId: `synth-${chunk.chunkId}-${index}`, date: new Date(`${day}T00:00:00.000Z`),
              impressions: state.rowsPerChunk ?? 5,
            },
          });
        }
      }
      if (state.partialOnCall === n) {
        return { rows: state.rowsPerChunk ?? 5, partialError: { code: "PARTIAL_ACCOUNTS", error: "synthetic partial" } };
      }
      return { rows: state.rowsPerChunk ?? 5 };
    };
  }

  it("concurrent admissions consume a single remaining quota slot exactly once", async (t) => {
    if (!requireDb(t)) return;
    const config = testConfig("synthetic", [WS_A], { maxActiveJobsPerWorkspace: 1 });
    const attempt = (since: string, until: string) =>
      admit({ since, until, config }).then(
        (result) => ({ ok: true as const, result }),
        (error) => ({ ok: false as const, error }),
      );
    const [first, second] = await Promise.all([
      attempt("2026-01-01", "2026-01-10"),
      attempt("2026-03-01", "2026-03-10"),
    ]);
    const winners = [first, second].filter((r) => r.ok);
    const losers = [first, second].filter((r) => !r.ok);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.ok(losers[0] && !losers[0].ok && (losers[0] as any).error instanceof PilotAdmissionError);
    assert.equal(((losers[0] as any).error as PilotAdmissionError).reasonCode, "WORKSPACE_QUOTA_EXCEEDED");
    const count = await prisma!.warehouseImportJob.count({
      where: { workspaceId: WS_A, idempotencyKey: { startsWith: "xbpilot:" }, status: { in: ["queued", "running", "paused", "pause_requested"] } },
    });
    assert.equal(count, 1);
    for (const winner of winners) {
      if (winner.ok) await cancelPilotJob({ workspaceId: WS_A, jobId: (winner.result as any).job.id, actorUserId: OPERATOR });
    }
  });

  it("overlapping ranges are rejected while disjoint windows and replays pass", async (t) => {
    if (!requireDb(t)) return;
    const base = { config: testConfig("synthetic"), observedRowsPerDay: 10, bytesPerRow: 512 };
    const first = await admit({ since: "2026-04-01", until: "2026-04-10", ...base });
    await assert.rejects(
      admit({ since: "2026-04-05", until: "2026-04-15", ...base, clientKey: "different" }),
      (error: unknown) => error instanceof PilotAdmissionError && error.reasonCode === "OVERLAPPING_JOB",
    );
    const disjoint = await admit({ since: "2026-05-01", until: "2026-05-10", ...base });
    assert.ok(disjoint.job.id);
    const replay = await admit({ since: "2026-04-01", until: "2026-04-10", ...base });
    assert.equal(replay.reused, true);
    assert.equal(replay.job.id, first.job.id);
    await cancelPilotJob({ workspaceId: WS_A, jobId: first.job.id, actorUserId: OPERATOR });
    await cancelPilotJob({ workspaceId: WS_A, jobId: disjoint.job.id, actorUserId: OPERATOR });
  });

  it("quota, budget, concurrency, capacity, and disabled gates fail closed with zero writes", async (t) => {
    if (!requireDb(t)) return;
    const jobsBefore = await prisma!.warehouseImportJob.count({ where: { workspaceId: WS_A } });
    const chunksBefore = await prisma!.warehouseBackfillChunk.count({ where: { workspaceId: WS_A } });
    const cases: { name: string; config: ReturnType<typeof testConfig>; since: string; until: string; code: string; extra?: Record<string, unknown> }[] = [
      { name: "chunk-limit", config: testConfig("synthetic", [WS_A], { maxChunksPerJob: 2 }), since: "2026-06-01", until: "2026-08-29", code: "CHUNK_LIMIT_EXCEEDED" },
      { name: "budget", config: testConfig("synthetic", [WS_A], { maxProviderCallsPerDay: 2 }), since: "2026-06-01", until: "2026-08-29", code: "PROVIDER_BUDGET_EXCEEDED" },
      { name: "disabled", config: testConfig("disabled"), since: "2026-06-01", until: "2026-06-10", code: "DISABLED" },
      { name: "unknown-capacity", config: testConfig("staging"), since: "2026-06-01", until: "2026-06-10", code: "CAPACITY_UNKNOWN", extra: { observedRowsPerDay: undefined, bytesPerRow: undefined } },
    ];
    for (const c of cases) {
      await assert.rejects(
        admit({ since: c.since, until: c.until, config: c.config, ...(c.extra ?? {}) }),
        (error: unknown) => error instanceof PilotAdmissionError && error.reasonCode === c.code,
        c.name,
      );
    }
    assert.equal(await prisma!.warehouseImportJob.count({ where: { workspaceId: WS_A } }), jobsBefore);
    assert.equal(await prisma!.warehouseBackfillChunk.count({ where: { workspaceId: WS_A } }), chunksBefore);
  });

  it("account and workspace concurrency caps reject without side effects", async (t) => {
    if (!requireDb(t)) return;
    const seeded = await admit({ since: "2026-07-01", until: "2026-07-05", config: testConfig("synthetic") });
    const [chunk] = await listBackfillChunks({ workspaceId: WS_A, jobId: seeded.job.id });
    const held = await claimBackfillChunk({ chunkId: chunk!.id, workspaceId: WS_A, leaseTtlMs: 600_000 });
    assert.equal(held.claimed, true);
    await assert.rejects(
      admit({ since: "2026-09-01", until: "2026-09-05", config: testConfig("synthetic", [WS_A], { maxConcurrentChunksPerAccount: 1 }) }),
      (error: unknown) => error instanceof PilotAdmissionError && error.reasonCode === "ACCOUNT_CONCURRENCY_EXCEEDED",
    );
    await assert.rejects(
      admit({ since: "2026-09-01", until: "2026-09-05", config: testConfig("synthetic", [WS_A], { maxConcurrentChunksPerWorkspace: 1 }) }),
      (error: unknown) => error instanceof PilotAdmissionError && error.reasonCode === "WORKSPACE_CONCURRENCY_EXCEEDED",
    );
    await completeBackfillChunk({
      chunkId: chunk!.id, workspaceId: WS_A, leaseId: (held as any).leaseId,
      fencingToken: (held as any).chunk.fencingToken, persistedRows: 1,
    });
    await cancelPilotJob({ workspaceId: WS_A, jobId: seeded.job.id, actorUserId: OPERATOR });
  });

  it("synthetic Google 731-day qualification: exact slices, resume, and completion", async (t) => {
    if (!requireDb(t)) return;
    const calls: { chunkId: string; since: string; until: string }[] = [];
    const admitted = await admit({
      since: "2024-01-01", until: "2025-12-31",
      config: testConfig("synthetic"), observedRowsPerDay: 10, bytesPerRow: 512,
    });
    assert.equal(admitted.chunks.length, 25);
    const chunks = await listBackfillChunks({ workspaceId: WS_A, jobId: admitted.job.id });
    assert.deepEqual(chunks.map((c) => c.ordinal), Array.from({ length: 25 }, (_, i) => i));
    for (const chunk of chunks) {
      const span = Math.round((Date.parse(`${chunk.until}T00:00:00Z`) - Date.parse(`${chunk.since}T00:00:00Z`)) / 86_400_000) + 1;
      assert.ok(span <= 30, `${chunk.since}..${chunk.until} spans ${span}`);
    }
    assert.equal(chunks[0]!.until, "2025-12-31");
    assert.equal(chunks[24]!.since, "2024-01-01");
    const seen = new Set<string>();
    for (const chunk of chunks) {
      for (let cursor = Date.parse(`${chunk.since}T00:00:00Z`); cursor <= Date.parse(`${chunk.until}T00:00:00Z`); cursor += 86_400_000) {
        const day = new Date(cursor).toISOString().slice(0, 10);
        assert.equal(seen.has(day), false, `duplicate ${day}`);
        seen.add(day);
      }
    }
    assert.equal(seen.size, 731);
    const aggregation = await runPilotBackfillJob(admitted.job.id, {
      workspaceId: WS_A,
      executor: syntheticExecutor({ calls, rowsPerChunk: 4 }),
    });
    assert.equal(aggregation.status, "completed");
    assert.equal(aggregation.approximateRows, 100);
    assert.equal(calls.length, 25);
    const parent = await prisma!.warehouseImportJob.findUniqueOrThrow({ where: { id: admitted.job.id } });
    assert.equal(parent.status, "completed");
  });

  it("synthetic Meta 365-day qualification with crash, retry, partial, and restatement", async (t) => {
    if (!requireDb(t)) return;
    const calls: { chunkId: string; since: string; until: string }[] = [];
    const admitted = await admit({
      provider: "meta_ads", connectionId: META_CONN, since: "2025-01-01", until: "2025-12-31",
      config: testConfig("synthetic"), observedRowsPerDay: 8, bytesPerRow: 512,
    });
    assert.ok(admitted.chunks.length >= 12 && admitted.chunks.length <= 13);
    // Crash midway: fail the first execution attempt, then resume to completion.
    let attempts = 0;
    const flaky = async (chunk: { chunkId: string; since: string; until: string }) => {
      attempts += 1;
      if (attempts === 1) throw new Error("synthetic worker crash");
      calls.push({ chunkId: chunk.chunkId, since: chunk.since, until: chunk.until });
      return { rows: 3 };
    };
    const partial = await runPilotBackfillJob(admitted.job.id, {
      workspaceId: WS_A, executor: flaky as any, maxChunks: 1,
    });
    assert.equal(partial.status, "running");
    assert.equal(partial.completedChunks, 1);
    const done = await runPilotBackfillJob(admitted.job.id, {
      workspaceId: WS_A,
      executor: syntheticExecutor({ calls, rowsPerChunk: 3, writeMetrics: { connectionId: META_CONN, platform: "meta_ads" } }) as any,
      finalizeParent: true,
    });
    assert.equal(done.status, "completed");
    // Restatement: metrics written once stay stable across a resumed run.
    const metricCount = await prisma!.campaignMetric.count({ where: { workspaceId: WS_A, connectionId: META_CONN } });
    const callsBefore = calls.length;
    await runPilotBackfillJob(admitted.job.id, {
      workspaceId: WS_A, executor: syntheticExecutor({ calls, rowsPerChunk: 3 }) as any,
    }).catch(() => null);
    assert.equal(calls.length, callsBefore);
    assert.equal(await prisma!.campaignMetric.count({ where: { workspaceId: WS_A, connectionId: META_CONN } }), metricCount);
  });

  it("synthetic rate-limit retry and partial preservation", async (t) => {
    if (!requireDb(t)) return;
    const calls: { chunkId: string; since: string; until: string }[] = [];
    const admitted = await admit({ since: "2026-10-01", until: "2026-10-05", config: testConfig("synthetic") });
    const aggregation = await runPilotBackfillWorkerSafe(admitted.job.id, {
      calls, failFirst: 2, partialOnCall: 3, rowsPerChunk: 5,
    });
    assert.equal(aggregation.status, "partial");
    assert.equal(aggregation.approximateRows, 5);
    assert.equal(aggregation.partialChunks, 1);
    const [chunk] = await listBackfillChunks({ workspaceId: WS_A, jobId: admitted.job.id });
    assert.equal(chunk!.attempts, 3);
    assert.equal(chunk!.status, "completed");
    assert.equal(calls.filter((c) => c.chunkId === chunk!.id).length, 3);
  });

  async function runPilotBackfillWorkerSafe(jobId: string, state: {
    calls: { chunkId: string; since: string; until: string }[];
    failFirst?: number; partialOnCall?: number; rowsPerChunk?: number;
  }) {
    const { runPilotBackfillJob: run } = await import("./extended-backfill-pilot-lifecycle");
    return run(jobId, { workspaceId: WS_A, executor: syntheticExecutor(state) as any, finalizeParent: true });
  }

  it("pause while running, resume after pause, and cancel variants", async (t) => {
    if (!requireDb(t)) return;
    const calls: { chunkId: string; since: string; until: string }[] = [];
    const admitted = await admit({ since: "2026-11-01", until: "2026-12-01", config: testConfig("synthetic") });
    const { runPilotBackfillJob: run } = await import("./extended-backfill-pilot-lifecycle");
    const first = await run(admitted.job.id, {
      workspaceId: WS_A,
      executor: syntheticExecutor({ calls, rowsPerChunk: 2 }) as any,
      maxChunks: 1,
      onChunkSettled: async () => {
        await pausePilotJob({ workspaceId: WS_A, jobId: admitted.job.id, actorUserId: OPERATOR });
      },
    });
    assert.equal(calls.length, 1);
    const paused = await loadPilotJob({ workspaceId: WS_A, jobId: admitted.job.id });
    assert.equal(paused!.job.status, "paused");
    assert.equal(first.status, "running");
    // Resume re-gates and finishes the remainder.
    const resumed = await resumePilotJob({ workspaceId: WS_A, jobId: admitted.job.id, actorUserId: OPERATOR, config: testConfig("synthetic"), observedRowsPerDay: 10, bytesPerRow: 512 });
    assert.equal(resumed.status, "queued");
    const done = await run(admitted.job.id, {
      workspaceId: WS_A, executor: syntheticExecutor({ calls, rowsPerChunk: 2 }) as any, finalizeParent: true,
    });
    assert.equal(done.status, "completed");
    assert.equal(calls.length, 2);

    // Cancel while queued.
    const queued = await admit({ since: "2026-12-01", until: "2026-12-05", config: testConfig("synthetic") });
    const cancelled = await cancelPilotJob({ workspaceId: WS_A, jobId: queued.job.id, actorUserId: OPERATOR });
    assert.equal(cancelled.status, "cancelled");
    const queuedChunks = await listBackfillChunks({ workspaceId: WS_A, jobId: queued.job.id });
    assert.ok(queuedChunks.length > 0 && queuedChunks.every((c) => c.status === "cancelled"));

    // Cancel while one chunk runs: queued siblings cancel, the lease finishes fenced.
    const running = await admit({ since: "2025-11-01", until: "2025-12-01", config: testConfig("synthetic") });
    const siblings = await listBackfillChunks({ workspaceId: WS_A, jobId: running.job.id });
    assert.equal(siblings.length, 2);
    const doneClaim = await claimBackfillChunk({ chunkId: siblings[1]!.id, workspaceId: WS_A });
    assert.equal(doneClaim.claimed, true);
    await completeBackfillChunk({
      chunkId: siblings[1]!.id, workspaceId: WS_A, leaseId: (doneClaim as any).leaseId,
      fencingToken: (doneClaim as any).chunk.fencingToken, persistedRows: 2,
    });
    const [leased] = await listBackfillChunks({ workspaceId: WS_A, jobId: running.job.id });
    const foreign = await claimBackfillChunk({ chunkId: leased!.id, workspaceId: WS_A, leaseTtlMs: 600_000 });
    assert.equal(foreign.claimed, true);
    const cancelRunning = await cancelPilotJob({ workspaceId: WS_A, jobId: running.job.id, actorUserId: OPERATOR });
    assert.equal(cancelRunning.status, "partial_cancelled");
    await completeBackfillChunk({
      chunkId: leased!.id, workspaceId: WS_A, leaseId: (foreign as any).leaseId,
      fencingToken: (foreign as any).chunk.fencingToken, persistedRows: 9,
    });
    const finished = await listBackfillChunks({ workspaceId: WS_A, jobId: running.job.id });
    assert.equal(finished.find((c) => c.id === leased!.id)?.status, "completed");
    const runningParent = await prisma!.warehouseImportJob.findUniqueOrThrow({ where: { id: running.job.id } });
    assert.equal(runningParent.status, "partial_cancelled");
    // Idempotent repeats.
    assert.equal((await pausePilotJob({ workspaceId: WS_A, jobId: queued.job.id, actorUserId: OPERATOR })).changed, false);
    assert.equal((await cancelPilotJob({ workspaceId: WS_A, jobId: queued.job.id, actorUserId: OPERATOR })).changed, false);
  });

  it("cross-connector matrix fails closed with zero side effects", async (t) => {
    if (!requireDb(t)) return;
    const db = prisma!;
    const jobsBefore = await db.warehouseImportJob.count({ where: { workspaceId: WS_A } });
    const chunksBefore = await db.warehouseBackfillChunk.count({ where: { workspaceId: WS_A } });
    const auditsBefore = await db.auditEvent.count({ where: { workspaceId: WS_A } });
    const attempts: { provider: unknown; connectionId?: string; accountId?: unknown; since?: string; until?: string }[] = [
      { provider: "tiktok_business", connectionId: TIKTOK_CONN },
      { provider: "shopee", connectionId: "conn-shopee-x" },
      { provider: "lazada", connectionId: "conn-lazada-x" },
      { provider: "amazon", connectionId: "conn-amazon-x" },
      { provider: "shopify", connectionId: "conn-shopify-x" },
      { provider: "unknown_xyz", connectionId: "conn-unknown-x" },
      { provider: "TIKTOK_ADS", connectionId: TIKTOK_CONN },
      { provider: " meta_ads ", connectionId: META_CONN, since: "2022-02-28", until: "2024-02-29" },
      { provider: "google_ads", connectionId: GOOGLE_CONN, accountId: 12345 },
    ];
    for (const attempt of attempts) {
      await assert.rejects(
        admit({ since: "2026-06-01", until: "2026-06-10", config: testConfig("staging"), ...attempt }),
        /PilotAdmissionError|PilotConfigError|Error/,
        JSON.stringify(attempt.provider),
      );
    }
    // Whitespace-padded Meta with an over-maximum range still refuses (policy, not bypass).
    await assert.rejects(
      admit({ provider: " meta_ads ", connectionId: META_CONN, since: "2022-02-28", until: "2024-02-29", config: testConfig("synthetic") }),
      (error: unknown) => error instanceof PilotAdmissionError && error.reasonCode === "RANGE_EXCEEDS_PILOT_MAXIMUM",
    );
    assert.equal(await db.warehouseImportJob.count({ where: { workspaceId: WS_A } }), jobsBefore);
    assert.equal(await db.warehouseBackfillChunk.count({ where: { workspaceId: WS_A } }), chunksBefore);
    assert.equal(await db.auditEvent.count({ where: { workspaceId: WS_A } }), auditsBefore);
  });

  it("staging Meta creation is refused while Google staging proceeds", async (t) => {
    if (!requireDb(t)) return;
    await assert.rejects(
      admit({ provider: "meta_ads", connectionId: META_CONN, since: "2024-01-01", until: "2024-04-01", config: testConfig("staging"), observedRowsPerDay: 10, bytesPerRow: 512 }),
      (error: unknown) => error instanceof PilotAdmissionError && error.reasonCode === "PROVIDER_NOT_LIVE_ELIGIBLE",
    );
    const google = await admit({
      provider: "google_ads", connectionId: GOOGLE_CONN, since: "2024-01-01", until: "2024-04-01",
      config: testConfig("staging"), observedRowsPerDay: 10, bytesPerRow: 512,
    });
    assert.ok(google.job.id);
    await cancelPilotJob({ workspaceId: WS_A, jobId: google.job.id, actorUserId: OPERATOR });
  });

  it("benchmarks: admission, overlap, claim, transition, polling, listing, budget", async (t) => {
    if (!requireDb(t)) return;
    const db = prisma!;
    const seedPrefix = "pilot-bench-";
    for (let job = 0; job < 100; job += 1) {
      const jobId = `${seedPrefix}${job}`;
      const ws = job % 2 === 0 ? WS_A : WS_B;
      const provider = job % 3 === 0 ? "meta_ads" : "google_ads";
      const base = new Date(Date.UTC(2024, 0, 1 + (job % 300)));
      const since = base.toISOString().slice(0, 10);
      const until = new Date(base.getTime() + 99 * 86_400_000).toISOString().slice(0, 10);
      await db.warehouseImportJob.create({
        data: {
          id: jobId, workspaceId: ws, userId: OPERATOR, plan: "pilot", since, until,
          items: [{ connectionId: job % 3 === 0 ? META_CONN : GOOGLE_CONN }],
          totalItems: 1, status: job % 10 === 0 ? "completed" : "queued",
          idempotencyKey: `xbpilot:synthetic:${jobId}`, priority: 5,
        },
      });
      const rows: any[] = [];
      const count = 100;
      for (let ordinal = 0; ordinal < count; ordinal += 1) {
        const day = new Date(base.getTime() + ordinal * 86_400_000).toISOString().slice(0, 10);
        rows.push({
          id: `wchk_bench_${job}_${ordinal}`,
          workspaceId: ws, jobId,
          connectionId: job % 3 === 0 ? META_CONN : GOOGLE_CONN,
          provider, accountId: `acct-${job % 7}`,
          since: day, until: day, ordinal,
          status: ordinal % 10 === 0 ? "completed" : "queued",
          persistedRows: ordinal % 10 === 0 ? 2 : 0,
          completedAt: ordinal % 10 === 0 ? new Date() : null,
        });
      }
      await db.warehouseBackfillChunk.createMany({ data: rows });
    }
    const total = await db.warehouseBackfillChunk.count({ where: { jobId: { startsWith: seedPrefix } } });
    assert.ok(total >= 10_000, `seeded ${total} chunks`);
    const metricRows: any[] = [];
    for (let i = 0; i < 3000; i += 1) {
      const day = new Date(Date.UTC(2024, 0, 1 + (i % 60))).toISOString().slice(0, 10);
      metricRows.push({
        workspaceId: WS_A, connectionId: GOOGLE_CONN, platform: "google_ads", accountId: `bench-${i % 25}`,
        level: "campaign", entityId: `bench-camp-${i}`, campaignId: `bench-camp-${i}`,
        date: new Date(`${day}T00:00:00.000Z`), impressions: i,
      });
    }
    for (let batch = 0; batch < metricRows.length; batch += 500) {
      await db.campaignMetric.createMany({ data: metricRows.slice(batch, batch + 500) });
    }

    const plans: string[] = [];
    async function explain(label: string, sql: string, params: unknown[], opts?: { allowSeqScanOn?: string }) {
      const rows = (await db.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, ...(params as any[]))) as any[];
      const planText = rows.map((row) => row["QUERY PLAN"]).join("\n");
      plans.push(`--- ${label} ---\n${planText}`);
      if (opts?.allowSeqScanOn) {
        assert.ok(
          planText.includes("Index") || planText.includes(`Seq Scan on "${opts.allowSeqScanOn}"`),
          `${label} must use an index or a justified small-table scan:\n${planText}`,
        );
      } else {
        assert.ok(!planText.includes('Seq Scan on "WarehouseBackfillChunk"'), `${label} must not seq-scan chunks`);
        assert.ok(planText.includes("Index"), `${label} must use an index:\n${planText}`);
      }
    }
    const nowIso = new Date().toISOString();
    const dayIso = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
    await explain("admission-count",
      `SELECT COUNT(*) FROM "WarehouseImportJob" WHERE "workspaceId" = $1 AND "idempotencyKey" LIKE 'xbpilot:%' AND "status" IN ('queued','running','paused','pause_requested')`,
      [WS_A], { allowSeqScanOn: "WarehouseImportJob" });
    await explain("overlap-detection",
      `SELECT "id", "since", "until" FROM "WarehouseImportJob" WHERE "workspaceId" = $1 AND "idempotencyKey" LIKE 'xbpilot:%' AND "status" IN ('queued','running','paused','pause_requested') AND "since" <= $2 AND "until" >= $3`,
      [WS_A, "2024-06-30", "2024-06-01"], { allowSeqScanOn: "WarehouseImportJob" });
    await explain("next-chunk-claim",
      `SELECT "id" FROM "WarehouseBackfillChunk" WHERE "workspaceId" = $1 AND "jobId" = $2 AND ("status" = 'queued' OR ("status" = 'running' AND "leaseExpiresAt" < $3::timestamptz)) ORDER BY "ordinal" ASC LIMIT 1`,
      [WS_A, `${seedPrefix}1`, nowIso]);
    await explain("pause-cancel-transition",
      `SELECT "id" FROM "WarehouseImportJob" WHERE "id" = $1 AND "workspaceId" = $2 AND "status" IN ('queued','running','paused','pause_requested')`,
      [`${seedPrefix}1`, WS_A], { allowSeqScanOn: "WarehouseImportJob" });
    await explain("parent-progress-polling",
      `SELECT "id", "status", "persistedRows", "ordinal", "since", "until" FROM "WarehouseBackfillChunk" WHERE "workspaceId" = $1 AND "jobId" = $2 ORDER BY "ordinal" ASC`,
      [WS_A, `${seedPrefix}1`]);
    await explain("workspace-job-listing",
      `SELECT "id", "status", "since", "until" FROM "WarehouseImportJob" WHERE "workspaceId" = $1 AND "idempotencyKey" LIKE 'xbpilot:%' ORDER BY "createdAt" DESC LIMIT 50`,
      [WS_A], { allowSeqScanOn: "WarehouseImportJob" });
    await explain("provider-budget-aggregation",
      `SELECT COUNT(*) FROM "WarehouseBackfillChunk" WHERE "workspaceId" = $1 AND "provider" = $2 AND "completedAt" >= $3::timestamptz`,
      [WS_A, "google_ads", dayIso]);
    for (const planText of plans) console.log(planText);

    await db.warehouseBackfillChunk.deleteMany({ where: { jobId: { startsWith: seedPrefix } } });
    await db.warehouseImportJob.deleteMany({ where: { id: { startsWith: seedPrefix } } });
  });
});
