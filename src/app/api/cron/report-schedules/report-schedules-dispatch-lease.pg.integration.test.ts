import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertCiDatabaseReachableWhenMissing } from "@/lib/pg-test-discipline";
import prisma from "@/lib/prisma";
import {
  claimScheduleDispatch,
  completeScheduleDispatch,
  releaseScheduleDispatch,
} from "@/lib/report-dispatch";
import { GET as reportSchedules } from "./route";

// Concurrency contract of the report-schedule cron: overlapping authenticated
// callers (GitHub Pilot cron, Vercel master cron) must never deliver the same
// due schedule twice. These tests pin the durable lease lifecycle on real
// PostgreSQL with deterministic barriers — never sleeps.
assertCiDatabaseReachableWhenMissing();
const hasDb = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("mock"));
const SECRET = "lease-concurrency-suite-secret-0123456789abcdef";

describe("ReportSchedule dispatch lease (real PostgreSQL)", { skip: !hasDb }, () => {
  const db = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const user = `lease-user-${suffix}`;
  const wsA = `lease-ws-a-${suffix}`;
  const wsB = `lease-ws-b-${suffix}`;
  const clientA = `lease-client-a-${suffix}`;
  const clientB = `lease-client-b-${suffix}`;
  const realFetch = globalThis.fetch;
  let deliveries: string[] = [];
  let scopeChecks: boolean[] = [];
  let failingWebhooks: Set<string> = new Set();
  let originalCronSecret: string | undefined;

  const authed = () =>
    new Request("http://localhost:3000/api/cron/report-schedules", {
      headers: { Authorization: `Bearer ${SECRET}` },
    });

  // File-level runner parallelism would otherwise let two fleet-sweeping
  // suites contend for the same due schedules. A session-level advisory lock
  // on a dedicated single-connection client serializes the report-schedule pg
  // suites without affecting any other suite. Session locks die with the
  // connection, so a crashed process cannot leave a stale lock behind.
  const suiteLockDb = new PrismaClient({
    datasources: { db: { url: `${process.env.DATABASE_URL}${process.env.DATABASE_URL?.includes("?") ? "&" : "?"}connection_limit=1` } },
  });
  const SUITE_LOCK_KEY = "report-schedules-pg-suite";


  before(async () => {
    await suiteLockDb.$executeRaw`SELECT pg_advisory_lock(hashtext(${SUITE_LOCK_KEY}))`;
    const url = new URL(process.env.DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.ok(["/monstera_security_test", "/monstera_ci"].includes(url.pathname));
    await db.$connect();
    await db.reportSchedule.deleteMany({ where: { id: { startsWith: "lease-sched-" } } });
    await db.client.deleteMany({ where: { id: { startsWith: "lease-client-" } } });
    await db.workspace.deleteMany({ where: { id: { startsWith: "lease-ws-" } } });
    await db.user.deleteMany({ where: { id: { startsWith: "lease-user-" } } });
    await db.user.create({ data: { id: user, email: `${user}@example.test` } });
    await db.workspace.createMany({
      data: [
        { id: wsA, slug: wsA, name: "Lease WS A", ownerId: user, plan: "professional", status: "ACTIVE" },
        { id: wsB, slug: wsB, name: "Lease WS B", ownerId: user, plan: "professional", status: "ACTIVE" },
      ],
    });
    await db.client.createMany({
      data: [
        { id: clientA, workspaceId: wsA, name: "Lease Client A" },
        { id: clientB, workspaceId: wsB, name: "Lease Client B" },
      ],
    });
  });

  beforeEach(() => {
    originalCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = SECRET;
    delete process.env.TELEGRAM_BOT_TOKEN;
    deliveries = [];
    scopeChecks = [];
    // EVERY test in this suite must run with the recording stub installed so
    // no unstubbed outbound request is ever possible (T3/T4 make no delivery
    // by themselves but the routes they invoke can).
    const recordingStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      deliveries.push(url);
      if (!url.startsWith("https://hooks.slack.com/services/")) {
        throw new Error(`live network attempted: ${url}`);
      }
      return new Response("{}", { status: failingWebhooks.has(url) ? 500 : 200 });
    }) as typeof fetch;
    (recordingStub as any).__tag = "recording-stub";
    globalThis.fetch = recordingStub;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  after(async () => {
    if (!hasDb) return;
    await db.reportSchedule.deleteMany({ where: { id: { startsWith: "lease-sched-" } } });
    await db.client.deleteMany({ where: { id: { startsWith: "lease-client-" } } });
    await db.workspace.deleteMany({ where: { id: { startsWith: "lease-ws-" } } });
    await db.user.deleteMany({ where: { id: user } });
    await db.$disconnect();
    await suiteLockDb.$executeRaw`SELECT pg_advisory_unlock(hashtext(${SUITE_LOCK_KEY}))`;
    await suiteLockDb.$disconnect();
  });

  const seedDueSchedule = async (tag: string, workspaceId: string, clientId: string) => {
    const id = `lease-sched-${tag}-${randomUUID().slice(0, 8)}`;
    await db.reportSchedule.create({
      data: {
        id,
        workspaceId,
        clientId,
        cron: "0 0 * * *",
        recipients: `https://hooks.slack.com/services/T000/B000/${tag}-${randomUUID().slice(0, 8)}`,
        enabled: true,
        lastSentAt: null,
      },
    });
    return id;
  };

  /** Stubbed delivery that starts the contender sweep while the first sweep is
   * parked at the delivery boundary and only completes the delivery once the
   * contender has finished claiming. Fully deterministic: the test awaits the
   * contender through `contender.done`, never through an eager fallback. */
  const parkedDeliveryStub = (
    contenderStarted: { value: boolean },
    contender: { done: Promise<Response> | null },
  ) => {
    let handOff: ((p: Promise<Response>) => void) | null = null;
    contender.done = new Promise<Response>((resolve) => {
      handOff = resolve;
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.startsWith("https://hooks.slack.com/services/")) {
        throw new Error(`live network attempted: ${url}`);
      }
      deliveries.push(url);
      if (!contenderStarted.value) {
        contenderStarted.value = true;
        const sweep = reportSchedules(authed());
        // Executed inside the winner's dispatch context: the tenant guard must
        // still reject unscoped fleet reads while a delivery is in flight,
        // proving no elevated system scope survives into network awaits.
        const scopeStillGuarded = await prisma.reportSchedule
          .findMany({ where: { enabled: true } })
          .then(
            () => false,
            (err: unknown) => err instanceof Error && err.message === "ReportSchedule.findMany requires workspaceId",
          );
        scopeChecks.push(scopeStillGuarded);
        const settled = await sweep;
        handOff?.(Promise.resolve(settled));
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    (globalThis.fetch as any).__tag = "parked-stub";
  };

  it("delivers a due schedule exactly once under two concurrent authenticated sweeps", { timeout: 30000 }, async () => {
    for (let iteration = 0; iteration < 3; iteration++) {
      const scheduleId = await seedDueSchedule(`same${iteration}`, wsA, clientA);
      deliveries = [];
      scopeChecks = [];

      const contenderStarted = { value: false };
      const contender = { done: null as Promise<Response> | null };
      parkedDeliveryStub(contenderStarted, contender);

      try {
        const responses = await Promise.all([
          reportSchedules(authed()),
          contender.done as Promise<Response>,
        ]);
        const bodies = await Promise.all(responses.map((r) => r.json()));

        assert.equal(deliveries.length, 1, `iteration ${iteration}: exactly one delivery`);
        assert.deepEqual(scopeChecks, [true], "guard stays active during delivery awaits");

        const winner = bodies.find((b) => b.succeeded === 1);
        const loser = bodies.find((b) => b.skippedClaimed === 1);
        assert.ok(winner, "one sweep reports the dispatch success");
        assert.ok(loser, "one sweep reports the schedule as already claimed");
        assert.equal(winner.due, 1);
        assert.equal(winner.skippedClaimed, 0);
        assert.equal(loser.due, 1);
        assert.equal(loser.succeeded, 0);
        assert.deepEqual(
          loser.results.map((r: { scheduleId: string; status?: string }) => ({ scheduleId: r.scheduleId, status: r.status })),
          [{ scheduleId, status: "already_claimed" }],
        );
        // Sanitized responses: no lease tokens or internal markers.
        for (const body of bodies) {
          assert.equal(JSON.stringify(body).includes("dispatchLease"), false);
          assert.equal(JSON.stringify(body).includes("token"), false);
        }

        const row = await db.reportSchedule.findUnique({ where: { id: scheduleId } });
        assert.ok(row?.lastSentAt, `iteration ${iteration}: lastSentAt reflects the successful delivery`);
        assert.equal(row?.dispatchLeaseToken, null, `iteration ${iteration}: lease cleared`);
        assert.equal(row?.dispatchLeaseExpiresAt, null, `iteration ${iteration}: lease expiry cleared`);
      } finally {
        await db.reportSchedule.deleteMany({ where: { id: scheduleId } });
      }
    }
  });

  it("leases different schedules (across workspaces) independently", { timeout: 30000 }, async () => {
    const idA = await seedDueSchedule("multi-a", wsA, clientA);
    const idB = await seedDueSchedule("multi-b", wsB, clientB);
    deliveries = [];
    scopeChecks = [];

    const contenderStarted = { value: false };
    const contender = { done: null as Promise<Response> | null };
    parkedDeliveryStub(contenderStarted, contender);

    try {
      const responses = await Promise.all([
        reportSchedules(authed()),
        contender.done as Promise<Response>,
      ]);
      const bodies = await Promise.all(responses.map((r) => r.json()));

      // Each schedule delivered exactly once — a lease on one schedule never
      // blocks the other, and workspaces do not serialize each other.
      assert.equal(deliveries.length, 2);
      assert.equal(new Set(deliveries).size, 2);
      // Each sweep sees both schedules as due, delivers exactly one, and
      // observes the other schedule as already claimed — the leases fence
      // against each other without blocking independent progress.
      for (const body of bodies) {
        assert.equal(body.due, 2);
        assert.equal(body.succeeded, 1);
        assert.equal(body.skippedClaimed, 1);
        assert.equal(body.failed, 0);
      }
      assert.deepEqual(
        bodies.map((b: { results: Array<{ scheduleId: string; status?: string; slackDelivered?: number }> }) =>
          b.results.map((r) => ({ delivered: r.slackDelivered ?? 0, status: r.status ?? "dispatched" })).sort(),
        ).sort(),
        [
          [{ delivered: 1, status: "dispatched" }, { delivered: 0, status: "already_claimed" }],
          [{ delivered: 1, status: "dispatched" }, { delivered: 0, status: "already_claimed" }],
        ],
      );
      for (const body of bodies) {
        assert.equal(body.ok, true);
        assert.equal(JSON.stringify(body).includes("dispatchLease"), false);
      }
      for (const id of [idA, idB]) {
        const row = await db.reportSchedule.findUnique({ where: { id } });
        assert.ok(row?.lastSentAt, `lastSentAt advanced for ${id}`);
        assert.equal(row?.dispatchLeaseToken, null, `lease cleared for ${id}`);
      }
    } finally {
      await db.reportSchedule.deleteMany({ where: { id: { in: [idA, idB] } } });
    }
  });

  it("fences a stale owner: expired lease is reclaimed atomically and the old owner cannot complete or release", async () => {
    const scheduleId = await seedDueSchedule("stale", wsA, clientA);
    try {
      const tokenA = await claimScheduleDispatch({ id: scheduleId, workspaceId: wsA, lastSentAt: null });
      assert.ok(tokenA, "first owner acquires the lease");

      // Owner A crashes; its lease expires.
      await db.reportSchedule.update({
        where: { id: scheduleId },
        data: { dispatchLeaseExpiresAt: new Date(Date.now() - 1000) },
      });

      const tokenB = await claimScheduleDispatch({ id: scheduleId, workspaceId: wsA, lastSentAt: null });
      assert.ok(tokenB, "expired lease is reclaimed atomically");
      assert.notEqual(tokenB, tokenA);

      // Fenced owner A can neither mark success nor release owner B's lease.
      assert.equal(await completeScheduleDispatch(scheduleId, wsA, tokenA), false);
      assert.equal(await releaseScheduleDispatch(scheduleId, wsA, tokenA), false);
      const fencedRow = await db.reportSchedule.findUnique({ where: { id: scheduleId } });
      assert.equal(fencedRow?.lastSentAt, null, "fenced owner cannot advance lastSentAt");
      assert.equal(fencedRow?.dispatchLeaseToken, tokenB, "owner B's lease is untouched");

      // Owner B completes normally.
      const completedAt = new Date("2026-09-12T10:00:00.000Z");
      assert.equal(await completeScheduleDispatch(scheduleId, wsA, tokenB, { now: completedAt }), true);
      const doneRow = await db.reportSchedule.findUnique({ where: { id: scheduleId } });
      assert.equal(doneRow?.lastSentAt?.toISOString(), completedAt.toISOString());
      assert.equal(doneRow?.dispatchLeaseToken, null);
      assert.equal(doneRow?.dispatchLeaseExpiresAt, null);
    } finally {
      await db.reportSchedule.deleteMany({ where: { id: scheduleId } });
    }
  });

  it("recovers a crashed owner's lease only after expiry, through the route", async () => {
    const scheduleId = await seedDueSchedule("crash", wsB, clientB);
    try {
      // Simulated crash: lease present, unexpired, owner gone.
      await db.reportSchedule.update({
        where: { id: scheduleId },
        data: { dispatchLeaseToken: "crashed-owner-token", dispatchLeaseExpiresAt: new Date(Date.now() + 60_000) },
      });

      deliveries = [];
      const blocked = await reportSchedules(authed());
      const blockedBody = await blocked.json();
      assert.equal(blocked.status, 200);
      assert.equal(blockedBody.due, 1);
      assert.equal(blockedBody.skippedClaimed, 1);
      assert.equal(blockedBody.succeeded, 0);
      assert.equal(deliveries.length, 0, "active lease suppresses delivery");
      const row = await db.reportSchedule.findUnique({ where: { id: scheduleId } });
      assert.equal(row?.lastSentAt, null);
      assert.equal(row?.dispatchLeaseToken, "crashed-owner-token", "failed claim leaves the active lease untouched");
      assert.ok(row?.dispatchLeaseExpiresAt, "failed claim does not clear the lease expiry");

      // TTL expires: the next tick reclaims atomically, delivers, completes.
      await db.reportSchedule.update({
        where: { id: scheduleId },
        data: { dispatchLeaseExpiresAt: new Date(Date.now() - 1000) },
      });
      deliveries = [];
      const rowBeforeRecovery = await db.reportSchedule.findUnique({ where: { id: scheduleId } });
      console.log("T4 BEFORE RECOVERY:", JSON.stringify(rowBeforeRecovery));
      const recovered = await reportSchedules(authed());
      const recoveredBody = await recovered.json();
      console.log("T4 RECOVERED BODY:", JSON.stringify(recoveredBody));
      assert.equal(recovered.status, 200);
      assert.equal(recoveredBody.succeeded, 1);
      assert.equal(recoveredBody.skippedClaimed, 0);
      console.log("T4 FETCH_KIND:", (globalThis.fetch as any).__tag, "DELIVERIES:", JSON.stringify(deliveries));
      assert.equal(deliveries.length, 1, "expired lease is reclaimable and the schedule delivers once");
      const doneRow = await db.reportSchedule.findUnique({ where: { id: scheduleId } });
      assert.ok(doneRow?.lastSentAt);
      assert.equal(doneRow?.dispatchLeaseToken, null);
    } finally {
      await db.reportSchedule.deleteMany({ where: { id: scheduleId } });
    }
  });
});
