import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertCiDatabaseReachableWhenMissing } from "@/lib/pg-test-discipline";
import {
  claimScheduleDispatch,
  executeScheduleDispatch,
} from "@/lib/report-dispatch";

// Real-PostgreSQL proof that the delivery deadline integrates with the lease
// lifecycle: a fully timed-out delivery releases the owner's lease without
// advancing lastSentAt, and a later invocation reclaims and completes it.
assertCiDatabaseReachableWhenMissing();
const hasDb = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("mock"));
const SECRET = "deadline-suite-secret-0123456789abcdef0123456789";

describe("ReportSchedule dispatch deadline vs lease (real PostgreSQL)", { skip: !hasDb }, () => {
  const db = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const user = `dl-user-${suffix}`;
  const ws = `dl-ws-${suffix}`;
  const client = `dl-client-${suffix}`;
  const realFetch = globalThis.fetch;
  let deliveries: string[] = [];
  let stallDeliveries = false;
  let originalCronSecret: string | undefined;


  // File-level runner parallelism would let fleet-sweeping suites see this
  // suite's due schedules. The same session-level advisory lock used by the
  // other report-schedule pg suites serializes them; session locks die with
  // the connection, so a crashed process cannot leave a stale lock behind.
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
    await db.reportSchedule.deleteMany({ where: { id: { startsWith: "dl-sched-" } } });
    await db.client.deleteMany({ where: { id: { startsWith: "dl-client-" } } });
    await db.workspace.deleteMany({ where: { id: { startsWith: "dl-ws-" } } });
    await db.user.deleteMany({ where: { id: { startsWith: "dl-user-" } } });
    await db.user.create({ data: { id: user, email: `${user}@example.test` } });
    await db.workspace.create({
      data: { id: ws, slug: ws, name: "Deadline WS", ownerId: user, plan: "professional", status: "ACTIVE" },
    });
    await db.client.create({ data: { id: client, workspaceId: ws, name: "Deadline Client" } });
  });

  beforeEach(() => {
    originalCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = SECRET;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.RESEND_API_KEY;
    deliveries = [];
    stallDeliveries = false;
    // Deny-by-default: only the synthetic Slack webhooks this suite seeds may
    // be contacted, and every fetch honors the deadline signal it is given
    // (when stalling, it never settles until the signal aborts — the same
    // contract undici implements for real transports).
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.startsWith("https://hooks.slack.com/services/")) {
        throw new Error(`live network attempted: ${url}`);
      }
      deliveries.push(url);
      if (stallDeliveries) {
        await new Promise<void>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  after(async () => {
    if (!hasDb) return;
    await db.reportSchedule.deleteMany({ where: { id: { startsWith: "dl-sched-" } } });
    await db.client.deleteMany({ where: { id: client } });
    await db.workspace.deleteMany({ where: { id: ws } });
    await db.user.deleteMany({ where: { id: user } });
    await db.$disconnect();
    await suiteLockDb.$executeRaw`SELECT pg_advisory_unlock(hashtext(${SUITE_LOCK_KEY}))`;
    await suiteLockDb.$disconnect();
  });

  const seedDueSchedule = async (tag: string, webhookCount: number) => {
    const id = `dl-sched-${tag}-${randomUUID().slice(0, 8)}`;
    const webhooks = Array.from(
      { length: webhookCount },
      (_, i) => `https://hooks.slack.com/services/T000/B000/${tag}${i}-${suffix}`,
    );
    await db.reportSchedule.create({
      data: { id, workspaceId: ws, clientId: client, cron: "0 0 * * *", recipients: webhooks.join(","), enabled: true, lastSentAt: null },
    });
    return { id, webhooks };
  };

  it("times out every stalled recipient, sanitizes errors, releases the lease, and keeps lastSentAt unchanged", { timeout: 30000 }, async () => {
    const { id, webhooks } = await seedDueSchedule("timeout", 3);
    const token = await claimScheduleDispatch({ id, workspaceId: ws, lastSentAt: null });
    assert.ok(token, "owner acquires the lease");

    stallDeliveries = true;
    const startedAt = Date.now();
    const result = await executeScheduleDispatch(
      id,
      { token },
      { overallDeadlineMs: 600, perRequestTimeoutMs: 200 },
    );
    const elapsed = Date.now() - startedAt;

    // All three sequential recipients were attempted and every one of them
    // failed; the overall deadline bounded the whole sequence.
    assert.equal(result.slackDelivered, 0);
    assert.equal(result.slackFailed, 3);
    assert.equal(result.errors.length, 3);
    assert.ok(elapsed < 15_000, `three stalled requests were bounded by the deadline (took ${elapsed}ms)`);
    // Sanitized: no URLs, hosts, tokens, or raw provider responses.
    const raw = JSON.stringify({ errors: result.errors, results: result });
    assert.equal(raw.includes("https://"), false);
    assert.equal(raw.includes("hooks.slack.com"), false);
    assert.equal(raw.includes(token), false);
    assert.ok(result.errors.every((e) => e.includes("deadline exceeded") || e === "Slack webhook failed."));

    // All-channel timeout/failure releases the owner's lease; lastSentAt stays.
    const row = await db.reportSchedule.findUnique({ where: { id } });
    assert.equal(row?.lastSentAt, null, "a fully failed delivery never advances lastSentAt");
    assert.equal(row?.dispatchLeaseToken, null, "the owner's lease is released");
    assert.equal(row?.dispatchLeaseExpiresAt, null, "the lease expiry is cleared");
  });

  it("lets a later invocation reclaim and complete the schedule after deadline failure", { timeout: 30000 }, async () => {
    const { id } = await seedDueSchedule("retry", 1);

    // First sweep: delivery times out and the lease is released.
    stallDeliveries = true;
    const firstToken = await claimScheduleDispatch({ id, workspaceId: ws, lastSentAt: null });
    assert.ok(firstToken);
    const failed = await executeScheduleDispatch(
      id,
      { token: firstToken },
      { overallDeadlineMs: 600, perRequestTimeoutMs: 200 },
    );
    assert.equal(failed.slackFailed, 1);
    const failedRow = await db.reportSchedule.findUnique({ where: { id } });
    assert.equal(failedRow?.lastSentAt, null);
    assert.equal(failedRow?.dispatchLeaseToken, null);

    // Second sweep: healthy delivery reclaims (CAS on the unchanged
    // lastSentAt) and completes ownership-checked.
    stallDeliveries = false;
    const secondToken = await claimScheduleDispatch({ id, workspaceId: ws, lastSentAt: null });
    assert.ok(secondToken, "the schedule is reclaimable after the deadline failure");
    const recovered = await executeScheduleDispatch(
      id,
      { token: secondToken },
      { overallDeadlineMs: 600, perRequestTimeoutMs: 200 },
    );
    assert.equal(recovered.slackDelivered, 1);
    const doneRow = await db.reportSchedule.findUnique({ where: { id } });
    assert.ok(doneRow?.lastSentAt, "successful retry advances lastSentAt exactly once");
    assert.equal(doneRow?.dispatchLeaseToken, null);
    assert.equal(doneRow?.dispatchLeaseExpiresAt, null);
  });
});
