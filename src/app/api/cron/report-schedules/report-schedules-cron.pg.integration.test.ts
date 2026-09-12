import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertCiDatabaseReachableWhenMissing } from "@/lib/pg-test-discipline";
import prisma from "@/lib/prisma";
import { TENANT_GUARDED_MODELS } from "@/lib/tenant-guard";
import { GET as reportSchedules } from "./route";

assertCiDatabaseReachableWhenMissing();
const hasDb = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("mock"));

// The cron sweep is inherently cross-workspace. These tests prove the route
// runs its fleet scan inside the bounded fleet system scope while the tenant
// guard stays fully active for every path outside that scope.
describe("CRON /api/cron/report-schedules fleet system scope (real PostgreSQL)", { skip: !hasDb }, () => {
  const db = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const userA = `cron-user-a-${suffix}`;
  const userB = `cron-user-b-${suffix}`;
  const wsA = `cron-ws-a-${suffix}`;
  const wsB = `cron-ws-b-${suffix}`;
  const dueA = `cron-sched-due-a-${suffix}`;
  const dueB = `cron-sched-due-b-${suffix}`;
  const notDue = `cron-sched-notdue-${suffix}`;
  const disabled = `cron-sched-disabled-${suffix}`;
  const failing = `cron-sched-failing-${suffix}`;
  const catchUp = `cron-sched-catchup-${suffix}`;
  const slack = (tag: string) => `https://hooks.slack.com/services/T000/B000/${tag}-${suffix}`;
  const SECRET = "local-report-schedules-cron-secret-0123456789abcdef";
  const realFetch = globalThis.fetch;
  const notDueSentAt = new Date(Date.now() - 1 * 3600_000);
  let deliveries: string[] = [];
  let failingWebhooks: Set<string> = new Set();
  let originalCronSecret: string | undefined;

  const authed = () =>
    new Request("http://localhost:3000/api/cron/report-schedules", {
      headers: { Authorization: `Bearer ${SECRET}` },
    });

  before(async () => {
    // Never permit this suite against anything but the isolated loopback DB.
    const url = new URL(process.env.DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.ok(["/monstera_security_test", "/monstera_ci"].includes(url.pathname));
    await db.$connect();
    // Defensive sweep of this suite's own prefixed fixtures from any earlier
    // aborted run, so fleet-wide assertions only ever see the current seed.
    await db.reportSchedule.deleteMany({ where: { id: { startsWith: "cron-sched-" } } });
    await db.workspace.deleteMany({ where: { id: { startsWith: "cron-ws-" } } });
    await db.user.deleteMany({ where: { id: { startsWith: "cron-user-" } } });
    await db.user.createMany({
      data: [userA, userB].map((id) => ({ id, email: `${id}@example.test` })),
    });
    await db.workspace.createMany({
      data: [
        { id: wsA, slug: wsA, name: "Cron WS A", ownerId: userA, plan: "professional", status: "ACTIVE" },
        { id: wsB, slug: wsB, name: "Cron WS B", ownerId: userB, plan: "professional", status: "ACTIVE" },
      ],
    });
    // Daily cron at hour 0 UTC is always due for a schedule that never sent.
    // A send within the last 20h suppresses due-ness; 25h ago does not.
    await db.reportSchedule.createMany({
      data: [
        { id: dueA, workspaceId: wsA, cron: "0 0 * * *", recipients: slack("due-a"), enabled: true, lastSentAt: null },
        { id: dueB, workspaceId: wsB, cron: "0 0 * * *", recipients: slack("due-b"), enabled: true, lastSentAt: null },
        { id: notDue, workspaceId: wsA, cron: "0 0 * * *", recipients: slack("notdue"), enabled: true, lastSentAt: notDueSentAt },
        { id: disabled, workspaceId: wsB, cron: "0 0 * * *", recipients: slack("disabled"), enabled: false, lastSentAt: null },
        { id: failing, workspaceId: wsA, cron: "0 0 * * *", recipients: slack("failing"), enabled: true, lastSentAt: null },
        { id: catchUp, workspaceId: wsB, cron: "0 0 * * *", recipients: slack("catchup"), enabled: true, lastSentAt: new Date(Date.now() - 25 * 3600_000) },
      ],
    });
  });

  beforeEach(() => {
    originalCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = SECRET;
    delete process.env.TELEGRAM_BOT_TOKEN;
    deliveries = [];
    failingWebhooks = new Set();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      deliveries.push(url);
      // Any transport other than the synthetic Slack webhooks (mail, Telegram,
      // analytics, ...) must fail the suite immediately.
      if (!url.startsWith("https://hooks.slack.com/services/")) {
        throw new Error(`live network attempted by cron dispatch: ${url}`);
      }
      return new Response("{}", { status: failingWebhooks.has(url) ? 500 : 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  after(async () => {
    if (!hasDb) return;
    for (const ws of [wsA, wsB]) {
      await db.reportSchedule.deleteMany({ where: { workspaceId: ws } });
      await db.workspace.deleteMany({ where: { id: ws } });
    }
    await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await db.$disconnect();
  });

  it("keeps ReportSchedule in the tenant-guarded model set", () => {
    assert.ok(TENANT_GUARDED_MODELS.has("ReportSchedule"));
  });

  it("rejects a missing cron secret before any dispatch or write", async () => {
    const res = await reportSchedules(new Request("http://localhost:3000/api/cron/report-schedules"));
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Unauthorized" });
    assert.equal(deliveries.length, 0);
    const row = await db.reportSchedule.findUnique({ where: { id: dueA } });
    assert.equal(row?.lastSentAt, null);
  });

  it("rejects an incorrect cron secret before any dispatch or write", async () => {
    const res = await reportSchedules(
      new Request("http://localhost:3000/api/cron/report-schedules", {
        headers: { Authorization: `Bearer ${"x".repeat(SECRET.length)}` },
      }),
    );
    assert.equal(res.status, 401);
    assert.equal(deliveries.length, 0);
    const row = await db.reportSchedule.findUnique({ where: { id: dueB } });
    assert.equal(row?.lastSentAt, null);
  });

  it("reports cron misconfiguration without touching schedules", async () => {
    process.env.CRON_SECRET = "too-short";
    const res = await reportSchedules(authed());
    assert.equal(res.status, 503);
    assert.equal(deliveries.length, 0);
    const row = await db.reportSchedule.findUnique({ where: { id: dueA } });
    assert.equal(row?.lastSentAt, null);
  });

  it("discovers due schedules across two workspaces through the guarded client and dispatches each once", async () => {
    // The failing webhook fails inside this same tick: the dispatch executes
    // without throwing, but no successful delivery means no lastSentAt.
    failingWebhooks = new Set([slack("failing")]);
    const res = await reportSchedules(authed());
    assert.equal(res.status, 200);
    const body = await res.json();
    // Enabled schedules: dueA, dueB, notDue, failing, catchUp (disabled excluded).
    assert.equal(body.ok, true);
    assert.equal(body.totalActive, 5);
    assert.equal(body.due, 4);
    assert.equal(body.skipped, 1);
    assert.equal(body.succeeded, 4);
    assert.equal(body.failed, 0);
    assert.deepEqual(
      body.results.map((r: { scheduleId: string }) => r.scheduleId).sort(),
      [dueA, dueB, failing, catchUp].sort(),
    );
    // Exactly one delivery attempt per dispatched schedule, nothing else.
    assert.deepEqual(deliveries.sort(), [slack("due-a"), slack("due-b"), slack("failing"), slack("catchup")].sort());
    // lastSentAt advanced only for schedules with a successful delivery.
    for (const id of [dueA, dueB, catchUp]) {
      const row = await db.reportSchedule.findUnique({ where: { id } });
      assert.ok(row?.lastSentAt, `lastSentAt advanced for ${id}`);
    }
    const failedRow = await db.reportSchedule.findUnique({ where: { id: failing } });
    assert.equal(failedRow?.lastSentAt, null, "failed delivery must not advance lastSentAt");
    const notDueRow = await db.reportSchedule.findUnique({ where: { id: notDue } });
    assert.equal(notDueRow?.lastSentAt?.toISOString(), notDueSentAt.toISOString(), "not-due schedule left untouched");
    const disabledRow = await db.reportSchedule.findUnique({ where: { id: disabled } });
    assert.equal(disabledRow?.lastSentAt, null, "disabled schedule left untouched");
  });

  it("retries a previously failed schedule on a later tick once delivery succeeds", async () => {
    failingWebhooks = new Set();
    const res = await reportSchedules(authed());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.due, 1);
    assert.equal(body.skipped, 4);
    assert.deepEqual(deliveries, [slack("failing")]);
    const row = await db.reportSchedule.findUnique({ where: { id: failing } });
    assert.ok(row?.lastSentAt);
  });

  it("does not re-send a schedule already sent within its cycle", async () => {
    const res = await reportSchedules(authed());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.due, 0);
    assert.equal(body.skipped, 5);
    assert.equal(deliveries.length, 0);
  });

  it("leaves the tenant guard active for callers after the route succeeds", async () => {
    assert.equal(
      (await reportSchedules(authed())).status,
      200,
    );
    await assert.rejects(
      () => prisma.reportSchedule.findMany({ where: { enabled: true } }),
      (err: unknown) => err instanceof Error && err.message === "ReportSchedule.findMany requires workspaceId",
    );
  });

  it("keeps unscoped fleet reads rejected outside the system scope", async () => {
    await assert.rejects(
      () => prisma.reportSchedule.findMany({ where: { enabled: true } }),
      (err: unknown) => err instanceof Error && err.message === "ReportSchedule.findMany requires workspaceId",
    );
  });

  it("serves workspace-scoped reads and hides rival-workspace schedules", async () => {
    const rowsA = await prisma.reportSchedule.findMany({ where: { workspaceId: wsA, enabled: true } });
    assert.ok(rowsA.length >= 3);
    assert.ok(rowsA.every((r) => r.workspaceId === wsA));
    assert.ok(!rowsA.some((r) => r.id === dueB));
  });
});
