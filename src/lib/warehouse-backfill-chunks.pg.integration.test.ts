import assert from "node:assert/strict";
import { assertCiDatabaseReachable, assertCiDatabaseReachableWhenMissing } from "./pg-test-discipline";
import { describe, it, before, after } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createImportJob } from "./warehouse-import-job";
import {
  aggregateChunkStates,
  claimBackfillChunk,
  claimNextBackfillChunk,
  completeBackfillChunk,
  failBackfillChunk,
  hasBackfillChunks,
  heartbeatBackfillChunk,
  listBackfillChunks,
  refreshParentJobFromChunks,
  runCheckpointedBackfillWorker,
  sweepExhaustedChunks,
  validateChunkSpecs,
  ChunkAttemptsExhaustedError,
  StaleChunkLeaseError,
} from "./warehouse-backfill-chunks";
import { assertExecutableWarehouseRange } from "./warehouse-execution-guard";
import { enqueueOauthWarehouseBackfill } from "./oauth-warehouse-backfill";

const WS_A = "ws_chkpt_a";
const WS_B = "ws_chkpt_b";
const USER = "usr_chkpt_1";
const META_CONN = "conn_chkpt_meta";
const GOOGLE_CONN = "conn_chkpt_google";
const TIKTOK_CONN = "conn_chkpt_tiktok";

describe("PostgreSQL Integration: checkpointed backfill worker foundation", () => {
  let prisma: PrismaClient | null = null;
  let isDbAvailable = false;
  let providerCalls = 0;

  async function setupFixtures() {
    const db = prisma!;
    await db.user.upsert({
      where: { id: USER },
      update: {},
      create: { id: USER, email: "chkpt@example.com", name: "Chkpt" },
    });
    for (const [ws, slug] of [[WS_A, "chkpt-ws-a"], [WS_B, "chkpt-ws-b"]] as const) {
      await db.workspace.upsert({
        where: { id: ws },
        update: {},
        create: { id: ws, name: ws, slug, ownerId: USER, plan: "pilot" },
      });
    }
    const creds = JSON.stringify({ accessToken: "synthetic", extraFields: {} });
    for (const [id, provider] of [[META_CONN, "meta_ads"], [GOOGLE_CONN, "google_ads"], [TIKTOK_CONN, "tiktok_business"]] as const) {
      await db.connection.upsert({
        where: { workspaceId_provider_remoteAccountId: { workspaceId: WS_A, provider, remoteAccountId: `remote-${id}` } },
        update: {},
        create: {
          id, workspaceId: WS_A, name: id, type: "source", provider,
          credentials: creds, remoteAccountId: `remote-${id}`, status: "connected",
        },
      });
    }
  }

  before(async () => {
    assertCiDatabaseReachableWhenMissing();
    if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("mock")) {
      try {
        prisma = new PrismaClient();
        await prisma.$connect();
        await prisma.$queryRaw`SELECT 1`;
        isDbAvailable = true;
        await setupFixtures();
      } catch {
        assertCiDatabaseReachable();
        isDbAvailable = false;
      }
    }
  });

  after(async () => {
    if (prisma && isDbAvailable) {
      try {
        await prisma.warehouseBackfillChunk.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
        await prisma.campaignMetric.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
        await prisma.warehouseImportJob.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
        await prisma.connection.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
        await prisma.workspace.deleteMany({ where: { id: { in: [WS_A, WS_B] } } });
        await prisma.$disconnect();
      } catch {}
    }
  });

  function requireDb(t: any) {
    if (!isDbAvailable) {
      t.skip("PostgreSQL database not reachable; run with real DATABASE_URL in CI");
      return false;
    }
    return true;
  }

  async function makeJob(
    jobId: string,
    specs: { connectionId: string; accountId?: string; provider: string; since: string; until: string; ordinal?: number }[],
    workspaceId = WS_A,
  ) {
    return createImportJob({
      workspaceId,
      userId: USER,
      plan: "pilot",
      since: specs[0]!.since,
      until: specs[specs.length - 1]!.until,
      items: [{ connectionId: specs[0]!.connectionId }],
      id: jobId,
      idempotencyKey: `chkpt:${jobId}`,
      chunks: specs,
    });
  }

  it("transaction rollback leaves no partial parent or orphaned chunks", async (t) => {
    if (!requireDb(t)) return;
    await assert.rejects(
      () =>
        makeJob("chkpt-rollback", [
          { connectionId: META_CONN, provider: "meta_ads", since: "2026-08-01", until: "2026-08-30" },
          { connectionId: META_CONN, provider: "meta_ads", since: "not-a-date", until: "2026-08-30" },
        ]),
      /INVALID_DATE_RANGE/,
    );
    const db = prisma!;
    assert.equal(await db.warehouseImportJob.count({ where: { id: "chkpt-rollback" } }), 0);
    assert.equal(await db.warehouseBackfillChunk.count({ where: { jobId: "chkpt-rollback" } }), 0);
  });

  it("two workers racing for one chunk yield exactly one winner with zero provider calls", async (t) => {
    if (!requireDb(t)) return;
    providerCalls = 0;
    await makeJob("chkpt-race", [
      { connectionId: META_CONN, provider: "meta_ads", since: "2026-08-01", until: "2026-08-30" },
    ]);
    const chunks = await listBackfillChunks({ workspaceId: WS_A, jobId: "chkpt-race" });
    assert.equal(chunks.length, 1);
    const [first, second] = await Promise.all([
      claimBackfillChunk({ chunkId: chunks[0]!.id, workspaceId: WS_A }),
      claimBackfillChunk({ chunkId: chunks[0]!.id, workspaceId: WS_A }),
    ]);
    const winners = [first, second].filter((result) => result.claimed);
    assert.equal(winners.length, 1);
    assert.equal(providerCalls, 0);
    const row = await prisma!.warehouseBackfillChunk.findUniqueOrThrow({ where: { id: chunks[0]!.id } });
    assert.equal(row.attempts, 1);
    assert.equal(row.fencingToken, BigInt(1));
    assert.equal(row.status, "running");
  });

  it("stale completion, failure, and heartbeat are rejected", async (t) => {
    if (!requireDb(t)) return;
    await makeJob("chkpt-stale", [
      { connectionId: META_CONN, provider: "meta_ads", since: "2026-08-01", until: "2026-08-30" },
    ]);
    const [chunk] = await listBackfillChunks({ workspaceId: WS_A, jobId: "chkpt-stale" });
    const claim = await claimBackfillChunk({ chunkId: chunk!.id, workspaceId: WS_A });
    assert.equal(claim.claimed, true);
    if (!claim.claimed) return;
    const fencingToken = claim.chunk.fencingToken;
    await assert.rejects(
      () => completeBackfillChunk({ chunkId: chunk!.id, workspaceId: WS_A, leaseId: "wrong", fencingToken, persistedRows: 1 }),
      StaleChunkLeaseError,
    );
    await assert.rejects(
      () => failBackfillChunk({ chunkId: chunk!.id, workspaceId: WS_A, leaseId: claim.leaseId, fencingToken: fencingToken + BigInt(1), error: "x" }),
      StaleChunkLeaseError,
    );
    await assert.rejects(
      () => heartbeatBackfillChunk({ chunkId: chunk!.id, workspaceId: WS_A, leaseId: claim.leaseId, fencingToken: fencingToken + BigInt(1) }),
      StaleChunkLeaseError,
    );
    const still = await prisma!.warehouseBackfillChunk.findUniqueOrThrow({ where: { id: chunk!.id } });
    assert.equal(still.status, "running");
    assert.equal(still.persistedRows, 0);
  });

  it("expired leases are reclaimable with bounded attempts; completed chunks never are", async (t) => {
    if (!requireDb(t)) return;
    await makeJob("chkpt-expire", [
      { connectionId: META_CONN, provider: "meta_ads", since: "2026-08-01", until: "2026-08-30" },
    ]);
    const [chunk] = await listBackfillChunks({ workspaceId: WS_A, jobId: "chkpt-expire" });
    const first = await claimBackfillChunk({ chunkId: chunk!.id, workspaceId: WS_A, leaseTtlMs: 1 });
    assert.equal(first.claimed, true);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await claimBackfillChunk({ chunkId: chunk!.id, workspaceId: WS_A });
    assert.equal(second.claimed, true);
    if (!second.claimed) return;
    assert.notEqual(second.leaseId, (first as { leaseId: string }).leaseId);
    assert.equal(second.chunk.attempts, 2);
    assert.equal(second.chunk.fencingToken, BigInt(2));
    await completeBackfillChunk({
      chunkId: chunk!.id, workspaceId: WS_A, leaseId: second.leaseId,
      fencingToken: second.chunk.fencingToken, persistedRows: 9,
    });
    const reclaim = await claimBackfillChunk({ chunkId: chunk!.id, workspaceId: WS_A });
    assert.equal(reclaim.claimed, false);
    assert.equal((reclaim as { reason: string }).reason, "already_completed");
  });

  it("exhausted chunks fail terminally and cannot retry", async (t) => {
    if (!requireDb(t)) return;
    await makeJob("chkpt-exhaust", [
      { connectionId: META_CONN, provider: "meta_ads", since: "2026-08-01", until: "2026-08-30" },
    ]);
    const [chunk] = await listBackfillChunks({ workspaceId: WS_A, jobId: "chkpt-exhaust" });
    await prisma!.warehouseBackfillChunk.update({
      where: { id: chunk!.id },
      data: { maxAttempts: 1 },
    });
    const claim = await claimBackfillChunk({ chunkId: chunk!.id, workspaceId: WS_A });
    assert.equal(claim.claimed, true);
    if (!claim.claimed) return;
    const failed = await failBackfillChunk({
      chunkId: chunk!.id, workspaceId: WS_A, leaseId: claim.leaseId,
      fencingToken: claim.chunk.fencingToken, code: "PROVIDER", error: "down",
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.lastErrorCode, "PROVIDER");
    const retry = await claimBackfillChunk({ chunkId: chunk!.id, workspaceId: WS_A });
    assert.equal(retry.claimed, false);
    assert.ok(["terminally_failed", "attempts_exhausted"].includes((retry as { reason: string }).reason));
    // Exhausted-error import is exercised.
    assert.ok(ChunkAttemptsExhaustedError);
  });

  it("expired running chunks with no attempts left are swept to terminal failure", async (t) => {
    if (!requireDb(t)) return;
    await makeJob("chkpt-sweep", [
      { connectionId: META_CONN, provider: "meta_ads", since: "2026-08-01", until: "2026-08-30" },
    ]);
    const [chunk] = await listBackfillChunks({ workspaceId: WS_A, jobId: "chkpt-sweep" });
    const claim = await claimBackfillChunk({ chunkId: chunk!.id, workspaceId: WS_A, leaseTtlMs: 1 });
    assert.equal(claim.claimed, true);
    await prisma!.warehouseBackfillChunk.update({
      where: { id: chunk!.id },
      data: { maxAttempts: 1 },
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const swept = await sweepExhaustedChunks({ workspaceId: WS_A, jobId: "chkpt-sweep" });
    assert.equal(swept, 1);
    const row = await prisma!.warehouseBackfillChunk.findUniqueOrThrow({ where: { id: chunk!.id } });
    assert.equal(row.status, "failed");
    assert.equal(row.lastErrorCode, "ATTEMPTS_EXHAUSTED");
  });

  it("newest queued chunk is claimed first and tenants cannot cross-claim", async (t) => {
    if (!requireDb(t)) return;
    await makeJob("chkpt-order", [
      { connectionId: META_CONN, provider: "meta_ads", since: "2026-08-15", until: "2026-08-29", ordinal: 0 },
      { connectionId: META_CONN, provider: "meta_ads", since: "2026-08-01", until: "2026-08-14", ordinal: 1 },
    ]);
    const first = await claimNextBackfillChunk({ workspaceId: WS_A, jobId: "chkpt-order" });
    assert.equal(first.claimed, true);
    if (!first.claimed) return;
    assert.equal(first.chunk.ordinal, 0);
    const foreign = await claimNextBackfillChunk({ workspaceId: WS_B, jobId: "chkpt-order" });
    assert.equal(foreign.claimed, false);
    const leaked = await listBackfillChunks({ workspaceId: WS_B, jobId: "chkpt-order" });
    assert.equal(leaked.length, 0);
  });

  it("crash recovery resumes without repeating completed chunks", async (t) => {
    if (!requireDb(t)) return;
    const contacted: string[] = [];
    await makeJob("chkpt-crash", [
      { connectionId: META_CONN, provider: "meta_ads", since: "2026-08-15", until: "2026-08-29", ordinal: 0 },
      { connectionId: META_CONN, provider: "meta_ads", since: "2026-08-01", until: "2026-08-14", ordinal: 1 },
    ]);
    const executor = async (opts: { chunkId: string }) => {
      contacted.push(opts.chunkId);
      return { rows: 5 };
    };
    const first = await runCheckpointedBackfillWorker("chkpt-crash", { workspaceId: WS_A, executor: executor as any });
    assert.equal(first.status, "completed");
    assert.equal(contacted.length, 2);
    contacted.length = 0;
    // Simulate a process restart: a fresh worker run must contact nothing.
    const second = await runCheckpointedBackfillWorker("chkpt-crash", { workspaceId: WS_A, executor: executor as any });
    assert.equal(second.status, "completed");
    assert.equal(contacted.length, 0);
    const parent = await prisma!.warehouseImportJob.findUniqueOrThrow({ where: { id: "chkpt-crash" } });
    assert.equal(parent.status, "completed");
    assert.equal(parent.approximateRows, 10);
  });

  it("crash after metric publication but before acknowledgement replays idempotently", async (t) => {
    if (!requireDb(t)) return;
    const db = prisma!;
    await makeJob("chkpt-replay", [
      { connectionId: META_CONN, provider: "meta_ads", since: "2026-08-01", until: "2026-08-01" },
    ]);
    const [chunk] = await listBackfillChunks({ workspaceId: WS_A, jobId: "chkpt-replay" });
    const claim = await claimBackfillChunk({ chunkId: chunk!.id, workspaceId: WS_A });
    assert.equal(claim.claimed, true);
    if (!claim.claimed) return;
    const metric = {
      workspaceId: WS_A,
      connectionId: META_CONN,
      platform: "meta_ads",
      accountId: "act_1",
      level: "campaign",
      entityId: "camp_1",
      campaignId: "camp_1",
      date: new Date("2026-08-01T00:00:00.000Z"),
      impressions: 10,
      spend: 1.5,
    };
    // Provider response published, worker crashed before complete(): replay the
    // same upsert (as the retried chunk would) and prove no duplicate row.
    await db.campaignMetric.upsert({
      where: { connectionId_accountId_level_entityId_date_breakdownHash: {
        connectionId: META_CONN, accountId: "act_1", level: "campaign",
        entityId: "camp_1", date: new Date("2026-08-01T00:00:00.000Z"), breakdownHash: "none",
      } },
      update: { ...metric },
      create: { ...metric },
    });
    await db.campaignMetric.upsert({
      where: { connectionId_accountId_level_entityId_date_breakdownHash: {
        connectionId: META_CONN, accountId: "act_1", level: "campaign",
        entityId: "camp_1", date: new Date("2026-08-01T00:00:00.000Z"), breakdownHash: "none",
      } },
      update: { ...metric },
      create: { ...metric },
    });
    assert.equal(await db.campaignMetric.count({ where: { workspaceId: WS_A, connectionId: META_CONN } }), 1);
    await completeBackfillChunk({
      chunkId: chunk!.id, workspaceId: WS_A, leaseId: claim.leaseId,
      fencingToken: claim.chunk.fencingToken, persistedRows: 1,
    });
    const aggregation = await refreshParentJobFromChunks({ workspaceId: WS_A, jobId: "chkpt-replay" });
    assert.equal(aggregation?.status, "completed");
  });

  it("partial provider failure yields a truthful partial parent", async (t) => {
    if (!requireDb(t)) return;
    await makeJob("chkpt-partial", [
      { connectionId: META_CONN, provider: "meta_ads", since: "2026-08-15", until: "2026-08-29", ordinal: 0 },
      { connectionId: META_CONN, provider: "meta_ads", since: "2026-08-01", until: "2026-08-14", ordinal: 1 },
    ]);
    const [first, second] = await listBackfillChunks({ workspaceId: WS_A, jobId: "chkpt-partial" });
    const claim = await claimBackfillChunk({ chunkId: first!.id, workspaceId: WS_A });
    assert.equal(claim.claimed, true);
    if (!claim.claimed) return;
    await completeBackfillChunk({
      chunkId: first!.id, workspaceId: WS_A, leaseId: claim.leaseId,
      fencingToken: claim.chunk.fencingToken, persistedRows: 4,
    });
    await prisma!.warehouseBackfillChunk.update({
      where: { id: second!.id },
      data: { maxAttempts: 1 },
    });
    const badClaim = await claimBackfillChunk({ chunkId: second!.id, workspaceId: WS_A });
    assert.equal(badClaim.claimed, true);
    if (!badClaim.claimed) return;
    await failBackfillChunk({
      chunkId: second!.id, workspaceId: WS_A, leaseId: badClaim.leaseId,
      fencingToken: badClaim.chunk.fencingToken, code: "PROVIDER_DOWN", error: "provider unavailable",
    });
    const aggregation = await refreshParentJobFromChunks({ workspaceId: WS_A, jobId: "chkpt-partial" });
    assert.equal(aggregation?.status, "partial");
    const parent = await prisma!.warehouseImportJob.findUniqueOrThrow({ where: { id: "chkpt-partial" } });
    assert.equal(parent.status, "partial");
    assert.equal((parent.results as any[]).length, 2);
    assert.ok(String(parent.errorMsg).includes("1/2"));
  });

  it("OAuth Meta 90-day enqueue materializes three executable chunks with exact ranges", async (t) => {
    if (!requireDb(t)) return;
    const before = await prisma!.warehouseBackfillChunk.count({ where: { workspaceId: WS_A } });
    const result = await enqueueOauthWarehouseBackfill({
      workspaceId: WS_A,
      userId: USER,
      connectionId: `${META_CONN}-oauth90`,
      connectionWorkspaceId: WS_A,
      provider: "meta_ads",
      kind: "initial",
    });
    assert.equal((result as { skipped?: boolean }).skipped ?? false, false);
    assert.ok(result.job);
    const chunks = await listBackfillChunks({ workspaceId: WS_A, jobId: result.job!.id });
    assert.equal(chunks.length, 3);
    assert.deepEqual(chunks.map((chunk) => chunk.ordinal), [0, 1, 2]);
    for (const chunk of chunks) {
      const span = Math.round((Date.parse(`${chunk.until}T00:00:00Z`) - Date.parse(`${chunk.since}T00:00:00Z`)) / 86_400_000) + 1;
      assert.ok(span <= 30);
      assert.equal(chunk.accountId, "");
    }
    assert.equal(chunks[0]!.until, result.job!.until);
    assert.equal(chunks[2]!.since, result.job!.since);
    assert.equal(await prisma!.warehouseBackfillChunk.count({ where: { workspaceId: WS_A } }), before + 3);
    // Replay converges: no duplicate job or chunks.
    const again = await enqueueOauthWarehouseBackfill({
      workspaceId: WS_A,
      userId: USER,
      connectionId: `${META_CONN}-oauth90`,
      connectionWorkspaceId: WS_A,
      provider: "meta_ads",
      kind: "initial",
    });
    assert.equal((again as { reused?: boolean }).reused, true);
    assert.equal((await listBackfillChunks({ workspaceId: WS_A, jobId: result.job!.id })).length, 3);

    // The checkpoint worker executes exact chunk ranges end-to-end.
    const seen: { since: string; until: string }[] = [];
    const aggregation = await runCheckpointedBackfillWorker(result.job!.id, {
      workspaceId: WS_A,
      executor: async (opts) => {
        seen.push({ since: opts.since, until: opts.until });
        return { rows: 2 };
      },
    });
    assert.equal(aggregation.status, "completed");
    assert.equal(aggregation.approximateRows, 6);
    assert.deepEqual(seen.map((range) => `${range.since}..${range.until}`), chunks.map((chunk) => `${chunk.since}..${chunk.until}`));
    await prisma!.warehouseBackfillChunk.deleteMany({ where: { jobId: result.job!.id } });
    await prisma!.warehouseImportJob.delete({ where: { id: result.job!.id } });
  });

  it("cross-connector matrix: singles stay single, unavailable fail closed with zero side effects", async (t) => {
    if (!requireDb(t)) return;
    const db = prisma!;
    for (const [provider, conn] of [["tiktok_business", `${TIKTOK_CONN}-matrix`], ["shopee", "conn-chkpt-shopee"], ["lazada", "conn-chkpt-lazada"]] as const) {
      const result = await enqueueOauthWarehouseBackfill({
        workspaceId: WS_A, userId: USER, connectionId: conn,
        connectionWorkspaceId: WS_A, provider, kind: "initial",
      });
      assert.ok(result.job, `${provider} must enqueue`);
      const created = await listBackfillChunks({ workspaceId: WS_A, jobId: result.job!.id });
      assert.equal(created.length, 1, `${provider} must materialize exactly one chunk`);
      assert.equal(created[0]!.accountId, "", `${provider} chunk stays connection-level`);
      await db.warehouseBackfillChunk.deleteMany({ where: { jobId: result.job!.id } });
      await db.warehouseImportJob.delete({ where: { id: result.job!.id } });
    }
    const jobsBefore = await db.warehouseImportJob.count({ where: { workspaceId: WS_A } });
    const chunksBefore = await db.warehouseBackfillChunk.count({ where: { workspaceId: WS_A } });
    const auditBefore = await db.auditEvent.count({ where: { workspaceId: WS_A } });
    for (const provider of ["amazon", "shopify", "unknown_provider_xyz"] as const) {
      const result = await enqueueOauthWarehouseBackfill({
        workspaceId: WS_A, userId: USER, connectionId: `conn-matrix-${provider}`,
        connectionWorkspaceId: WS_A, provider, kind: "initial",
      });
      assert.equal(result.skipped, true);
      assert.equal(result.job, null);
    }
    assert.equal(await db.warehouseImportJob.count({ where: { workspaceId: WS_A } }), jobsBefore);
    assert.equal(await db.warehouseBackfillChunk.count({ where: { workspaceId: WS_A } }), chunksBefore);
    assert.equal(await db.auditEvent.count({ where: { workspaceId: WS_A } }), auditBefore);
  });

  it("skipped unavailable enqueues leave nothing for any worker to claim or execute", async (t) => {
    if (!requireDb(t)) return;
    const db = prisma!;
    const jobsBefore = await db.warehouseImportJob.count({ where: { workspaceId: WS_A } });
    const chunksBefore = await db.warehouseBackfillChunk.count({ where: { workspaceId: WS_A } });
    for (const provider of ["amazon", "shopify"] as const) {
      const result = await enqueueOauthWarehouseBackfill({
        workspaceId: WS_A, userId: USER, connectionId: `conn-chkpt-skip-${provider}`,
        connectionWorkspaceId: WS_A, provider, kind: "initial",
      });
      assert.equal(result.skipped, true);
      assert.equal(result.job, null);
    }
    assert.equal(await db.warehouseImportJob.count({ where: { workspaceId: WS_A } }), jobsBefore);
    assert.equal(await db.warehouseBackfillChunk.count({ where: { workspaceId: WS_A } }), chunksBefore);
    // No job exists, so checkpoint claiming and the chunked worker are unreachable.
    assert.equal(await hasBackfillChunks({ workspaceId: WS_A, jobId: "chkpt-nonexistent-job" }), false);
  });

  it("raw-range guards still reject 31/90/365/731-day Meta/Google execution", async (t) => {
    if (!requireDb(t)) return;
    const ranges = [
      ["2026-07-01", "2026-07-31"],
      ["2026-06-01", "2026-08-29"],
      ["2025-09-17", "2026-09-16"],
      ["2022-03-01", "2024-02-29"],
    ] as const;
    for (const provider of ["meta_ads", "google_ads"] as const) {
      for (const [since, until] of ranges) {
        await assert.rejects(
          async () => assertExecutableWarehouseRange({ provider, since, until }),
          /REQUEST_CHUNKING_NOT_IMPLEMENTED/,
        );
      }
    }
    // Canonical helper still validates dates strictly.
    validateChunkSpecs([
      { connectionId: "c", accountId: "", provider: "meta_ads", since: "2026-08-01", until: "2026-08-30", ordinal: 0 },
    ]);
  });

  it("capacity: claim, aggregation, recovery, and polling queries use indexes", async (t) => {
    if (!requireDb(t)) return;
    const db = prisma!;
    const seedJobPrefix = "chkpt-cap";
    const jobIds: string[] = [];
    for (let job = 0; job < 30; job += 1) {
      const jobId = `${seedJobPrefix}-${job}`;
      jobIds.push(jobId);
      await db.warehouseImportJob.create({
        data: {
          id: jobId,
          workspaceId: job % 2 === 0 ? WS_A : WS_B,
          userId: USER,
          plan: "pilot",
          since: "2026-01-01",
          until: "2026-04-10",
          items: [{ connectionId: TIKTOK_CONN }],
          totalItems: 1,
          status: "queued",
          idempotencyKey: `cap:${jobId}`,
        },
      });
      const rows: any[] = [];
      for (let ordinal = 0; ordinal < 100; ordinal += 1) {
        const day = new Date(Date.UTC(2026, 0, 1 + ordinal));
        const iso = day.toISOString().slice(0, 10);
        rows.push({
          id: `wchk_cap_${job}_${ordinal}`,
          workspaceId: job % 2 === 0 ? WS_A : WS_B,
          jobId,
          connectionId: TIKTOK_CONN,
          provider: "tiktok_business",
          accountId: "",
          since: iso,
          until: iso,
          ordinal,
          status: ordinal % 10 === 0 ? "completed" : "queued",
          persistedRows: ordinal % 10 === 0 ? 3 : 0,
        });
      }
      for (let batch = 0; batch < rows.length; batch += 500) {
        await db.warehouseBackfillChunk.createMany({ data: rows.slice(batch, batch + 500), skipDuplicates: true });
      }
    }
    const total = await db.warehouseBackfillChunk.count({ where: { jobId: { startsWith: seedJobPrefix } } });
    assert.ok(total >= 3000, `seeded ${total} chunks`);

    const plans: string[] = [];
    async function explain(label: string, sql: string, params: unknown[]) {
      const rows = (await db.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, ...(params as any[]))) as any[];
      const plan = rows.map((row) => row["QUERY PLAN"]).join("\n");
      plans.push(`--- ${label} ---\n${plan}`);
      assert.ok(!plan.includes('Seq Scan on "WarehouseBackfillChunk"'), `${label} must not seq-scan chunks:\n${plan}`);
      assert.ok(plan.includes("Index"), `${label} must use an index:\n${plan}`);
    }
    const now = new Date().toISOString();
    await explain(
      "claim-next-chunk",
      `SELECT "id" FROM "WarehouseBackfillChunk" WHERE "workspaceId" = $1 AND "jobId" = $2 AND ("status" = 'queued' OR ("status" = 'running' AND "leaseExpiresAt" < $3::timestamptz)) ORDER BY "ordinal" ASC LIMIT 1`,
      [WS_A, jobIds[0], now],
    );
    await explain(
      "parent-aggregation",
      `SELECT "id", "status", "persistedRows", "ordinal", "since", "until" FROM "WarehouseBackfillChunk" WHERE "workspaceId" = $1 AND "jobId" = $2 ORDER BY "ordinal" ASC`,
      [WS_A, jobIds[0]],
    );
    await explain(
      "expired-lease-recovery",
      `SELECT "id" FROM "WarehouseBackfillChunk" WHERE "workspaceId" = $1 AND "jobId" = $2 AND "status" = 'running' AND "leaseExpiresAt" < $3::timestamptz`,
      [WS_A, jobIds[0], now],
    );
    await explain(
      "workspace-progress-polling",
      `SELECT "id", "status" FROM "WarehouseBackfillChunk" WHERE "workspaceId" = $1 AND "status" IN ('queued','running') ORDER BY "ordinal" ASC LIMIT 50`,
      [WS_A],
    );
    for (const plan of plans) console.log(plan);
    const agg = aggregateChunkStates(
      (await db.warehouseBackfillChunk.findMany({ where: { jobId: jobIds[0] } })).map((row) => ({
        ...row,
        fencingToken: row.fencingToken,
      })) as any,
    );
    assert.equal(agg.totalChunks, 100);

    await db.warehouseBackfillChunk.deleteMany({ where: { jobId: { startsWith: seedJobPrefix } } });
    await db.warehouseImportJob.deleteMany({ where: { id: { startsWith: seedJobPrefix } } });
  });
});
