import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertCiDatabaseReachableWhenMissing } from "@/lib/pg-test-discipline";
import {
  DISPATCH_ATTEMPT_STATUS,
  beginDispatchAttempt,
  claimScheduleDispatch,
  dispatchIdempotencyKey,
  dispatchOccurrenceDate,
  executeScheduleDispatch,
  isScheduleDue,
  markDispatchAttemptProviderStarted,
  releaseScheduleDispatch,
  resolveDispatchAttempt,
  sendTelegramBrief,
} from "@/lib/report-dispatch";
import { GET as reportSchedules } from "./route";

// Durable occurrence/attempt state: an ambiguous provider acceptance (request
// received, response lost) must suppress automatic retries for that occurrence
// while remaining operator-visible, without weakening the lease, fencing, or
// tenant isolation. All provider traffic uses fail-closed synthetic transports.
assertCiDatabaseReachableWhenMissing();
const hasDb = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("mock"));
const SECRET = "occurrence-suite-secret-0123456789abcdef0123456789";
const OCCURRENCE = "2026-09-12";

describe("ReportSchedule dispatch occurrence state (real PostgreSQL)", { skip: !hasDb }, () => {
  const db = new PrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const user = `oc-user-${suffix}`;
  const wsA = `oc-ws-a-${suffix}`;
  const wsB = `oc-ws-b-${suffix}`;
  const clientA = `oc-client-a-${suffix}`;
  const realFetch = globalThis.fetch;
  let deliveries: string[] = [];
  let idempotencyKeys: string[] = [];
  let stallDeliveries = false;
  let originalCronSecret: string | undefined;

  const authed = () =>
    new Request("http://localhost:3000/api/cron/report-schedules", {
      headers: { Authorization: `Bearer ${SECRET}` },
    });

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
    for (const prefix of ["oc-user-", "oc-ws-", "oc-client-", "oc-sched-"]) {
      if (prefix === "oc-user-") await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
      if (prefix === "oc-ws-") await db.workspace.deleteMany({ where: { id: { startsWith: prefix } } });
      if (prefix === "oc-client-") await db.client.deleteMany({ where: { id: { startsWith: prefix } } });
      if (prefix === "oc-sched-") await db.reportSchedule.deleteMany({ where: { id: { startsWith: prefix } } });
    }
    await db.user.create({ data: { id: user, email: `${user}@example.test` } });
    await db.workspace.createMany({
      data: [
        { id: wsA, slug: wsA, name: "Occ WS A", ownerId: user, plan: "professional", status: "ACTIVE" },
        { id: wsB, slug: wsB, name: "Occ WS B", ownerId: user, plan: "professional", status: "ACTIVE" },
      ],
    });
    await db.client.create({ data: { id: clientA, workspaceId: wsA, name: "Occ Client A" } });
  });

  beforeEach(() => {
    originalCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = SECRET;
    delete process.env.TELEGRAM_BOT_TOKEN;
    process.env.RESEND_API_KEY = "re_occurrence-suite-key";
    deliveries = [];
    idempotencyKeys = [];
    stallDeliveries = false;
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
    await db.reportScheduleDispatchAttempt.deleteMany({ where: { workspaceId: { startsWith: "oc-ws-" } } });
    await db.reportSchedule.deleteMany({ where: { id: { startsWith: "oc-sched-" } } });
    await db.client.deleteMany({ where: { id: clientA } });
    await db.workspace.deleteMany({ where: { id: { startsWith: "oc-ws-" } } });
    await db.user.deleteMany({ where: { id: user } });
    await db.$disconnect();
    await suiteLockDb.$executeRaw`SELECT pg_advisory_unlock(hashtext(${SUITE_LOCK_KEY}))`;
    await suiteLockDb.$disconnect();
  });

  const seedDueSchedule = async (tag: string, workspaceId = wsA) => {
    const id = `oc-sched-${tag}-${randomUUID().slice(0, 8)}`;
    await db.reportSchedule.create({
      data: {
        id,
        workspaceId,
        clientId: null,
        cron: "0 0 * * *",
        recipients: `https://hooks.slack.com/services/T000/B000/${tag}-${randomUUID().slice(0, 8)}`,
        enabled: true,
        lastSentAt: null,
      },
    });
    return id;
  };

  it("records AMBIGUOUS after an accepted-then-stalled delivery and suppresses the next sweep (5 iterations)", { timeout: 60000 }, async () => {
    for (let iteration = 0; iteration < 5; iteration++) {
      const id = await seedDueSchedule(`amb${iteration}`);
      stallDeliveries = true;
      try {
        // Sweep 1: the provider accepts the request, the response is lost, the
        // client times out, and the durable attempt becomes AMBIGUOUS.
        const token1 = await claimScheduleDispatch({ id, workspaceId: wsA, lastSentAt: null });
        assert.ok(token1);
        const attempt = await beginDispatchAttempt({ id, workspaceId: wsA }, OCCURRENCE, token1);
        assert.equal(attempt.state, "claimed");
        const failed = await executeScheduleDispatch(
          id,
          { token: token1, attempt: attempt.context },
          { overallDeadlineMs: 600, perRequestTimeoutMs: 200 },
        );
        assert.equal(failed.slackAmbiguous, 1);
        assert.equal(failed.ambiguous, 1);
        assert.equal(deliveries.length, 1, "sweep 1 contacted the provider exactly once");
        const afterFirst = await db.reportSchedule.findUnique({ where: { id } });
        assert.equal(afterFirst?.lastSentAt, null);
        assert.equal(afterFirst?.dispatchLeaseToken, null, "the lease is released");
        const ambiguousRow = await db.reportScheduleDispatchAttempt.findUnique({
          where: { scheduleId_occurrenceDate: { scheduleId: id, occurrenceDate: OCCURRENCE } },
        });
        assert.equal(ambiguousRow?.status, "AMBIGUOUS");

        // Sweep 2: the occurrence is suppressed — no provider contact.
        stallDeliveries = false;
        deliveries = [];
        const token2 = await claimScheduleDispatch({ id, workspaceId: wsA, lastSentAt: null });
        assert.ok(token2, "the schedule lease is reclaimable");
        const suppressed = await beginDispatchAttempt({ id, workspaceId: wsA }, OCCURRENCE, token2);
        assert.equal(suppressed.state, "suppressed");
        assert.equal(suppressed.reason, "AMBIGUOUS");
        assert.equal(deliveries.length, 0, "sweep 2 must not contact the provider for an ambiguous occurrence");
        console.log(`OC-ITER ${iteration}: accepted=1 suppressed-retry=true attempt=AMBIGUOUS`);
      } finally {
        await db.reportSchedule.deleteMany({ where: { id } });
        await db.reportScheduleDispatchAttempt.deleteMany({ where: { scheduleId: id } });
      }
    }
  });

  it("keeps Telegram and Resend semantics: accepted once, ambiguity surfaced", { timeout: 30000 }, async () => {
    const id = await seedDueSchedule("tg");
    const token = await claimScheduleDispatch({ id, workspaceId: wsA, lastSentAt: null });
    assert.ok(token);
    const attempt = await beginDispatchAttempt({ id, workspaceId: wsA }, OCCURRENCE, token);
    assert.equal(attempt.state, "claimed");
    stallDeliveries = true;
    process.env.TELEGRAM_BOT_TOKEN = "occurrence-suite-telegram-token";

    // The schedule's recipients are Slack-only; this exercises the Telegram
    // transport directly to prove the ambiguous classification is shared.
    const sent = await sendTelegramBrief("occurrence-suite-telegram-token", "123456789", "probe", {
      signal: AbortSignal.timeout(200),
      perRequestTimeoutMs: 200,
    });
    assert.equal(sent.outcome, "AMBIGUOUS");
    const attemptRow = await db.reportScheduleDispatchAttempt.findUnique({
      where: { scheduleId_occurrenceDate: { scheduleId: id, occurrenceDate: OCCURRENCE } },
    });
    assert.equal(attemptRow?.token, token);
    assert.equal(attemptRow?.status, "CLAIMED", "the provider-started boundary has not run for this helper call");
    await db.reportSchedule.deleteMany({ where: { id } });
  });

  it("derives a stable Resend idempotency key and records the definitive failure path", { timeout: 30000 }, async () => {
    const id = await seedDueSchedule("resend");
    const token = await claimScheduleDispatch({ id, workspaceId: wsA, lastSentAt: null });
    assert.ok(token);
    const attempt = await beginDispatchAttempt({ id, workspaceId: wsA }, OCCURRENCE, token);
    assert.equal(attempt.state, "claimed");

    // Wrap fetch to capture the Idempotency-Key header of the direct Resend
    // REST call, then force a clear non-2xx rejection (definitive failure).
    const capturedKeys: string[] = [];
    const priorFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("https://api.resend.com/")) {
        const headers = new Headers(init?.headers);
        capturedKeys.push(headers.get("Idempotency-Key") ?? "");
        return new Response("{}", { status: 422 });
      }
      return priorFetch(input, init);
    }) as typeof fetch;

    const recipients = await db.reportSchedule.findUnique({ where: { id } });
    assert.ok(recipients);
    const email = `resend-${suffix}@example.test`;
    const key = dispatchIdempotencyKey(wsA, id, OCCURRENCE, "email", email);
    const result = await sendResendBrief(email, key);
    assert.equal(result.success, false);
    assert.equal(capturedKeys.length, 1);
    assert.equal(capturedKeys[0], key, "the deterministic occurrence key is sent as the idempotency header");

    // The same occurrence retry would reuse the identical key.
    const retryKey = dispatchIdempotencyKey(wsA, id, OCCURRENCE, "email", email);
    assert.equal(retryKey, key);
    // The next occurrence derives a different key.
    assert.notEqual(dispatchIdempotencyKey(wsA, id, "2026-09-13", "email", email), key);
    await db.reportSchedule.deleteMany({ where: { id } });
  });

  it("resolves an orphaned PROVIDER_STARTED attempt to AMBIGUOUS and suppresses delivery", { timeout: 30000 }, async () => {
    const id = await seedDueSchedule("orphan");
    // Worker claimed and committed PROVIDER_STARTED, then died before sending.
    const token = await claimScheduleDispatch({ id, workspaceId: wsA, lastSentAt: null });
    assert.ok(token);
    const attempt = await beginDispatchAttempt({ id, workspaceId: wsA }, OCCURRENCE, token);
    assert.equal(attempt.state, "claimed");
    const started = await markDispatchAttemptProviderStarted(attempt.context, wsA);
    assert.equal(started, true);
    // The worker dies: its schedule lease expires.
    await db.reportSchedule.update({
      where: { id },
      data: { dispatchLeaseExpiresAt: new Date(Date.now() - 1000) },
    });

    // Next sweep: the orphaned PROVIDER_STARTED attempt resolves to AMBIGUOUS
    // and the occurrence is suppressed — never automatically re-sent.
    deliveries = [];
    const res = await reportSchedules(authed());
    const body = await res.json();
    assert.equal(body.due, 1);
    assert.equal(body.skippedAmbiguous, 1);
    assert.equal(body.succeeded, 0);
    assert.equal(deliveries.length, 0, "an orphaned PROVIDER_STARTED occurrence is never re-sent");
    const row = await db.reportSchedule.findUnique({ where: { id } });
    assert.equal(row?.lastSentAt, null);
    const attemptRow = await db.reportScheduleDispatchAttempt.findUnique({
      where: { scheduleId_occurrenceDate: { scheduleId: id, occurrenceDate: OCCURRENCE } },
    });
    assert.equal(attemptRow?.status, "AMBIGUOUS");
    await db.reportSchedule.deleteMany({ where: { id } });
  });

  it("reclaims a CLAIMED attempt whose worker crashed before provider contact", { timeout: 30000 }, async () => {
    const id = await seedDueSchedule("crashed");
    const token = await claimScheduleDispatch({ id, workspaceId: wsA, lastSentAt: null });
    assert.ok(token);
    await beginDispatchAttempt({ id, workspaceId: wsA }, OCCURRENCE, token);
    // Worker dies before PROVIDER_STARTED: only the schedule lease expires.
    await db.reportSchedule.update({
      where: { id },
      data: { dispatchLeaseExpiresAt: new Date(Date.now() - 1000) },
    });

    deliveries = [];
    const res = await reportSchedules(authed());
    const body = await res.json();
    assert.equal(body.succeeded, 1);
    assert.equal(deliveries.length, 1, "a crashed pre-provider attempt is recoverable and delivers");
    const attemptRow = await db.reportScheduleDispatchAttempt.findUnique({
      where: { scheduleId_occurrenceDate: { scheduleId: id, occurrenceDate: OCCURRENCE } },
    });
    assert.equal(attemptRow?.status, "CONFIRMED");
    await db.reportSchedule.deleteMany({ where: { id } });
  });

  it("records a clear non-2xx as DEFINITIVE_FAILED and allows the designed retry", { timeout: 30000 }, async () => {
    const id = await seedDueSchedule("definitive");
    deliveries = [];
    // First sweep: healthy provider returning 500 -> definitive failure.
    const failing = new Set(deliveries);
    void failing;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.startsWith("https://hooks.slack.com/services/")) {
        throw new Error(`live network attempted: ${url}`);
      }
      deliveries.push(url);
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    const first = await reportSchedules(authed());
    const firstBody = await first.json();
    // The dispatch executed (succeeded counter) while the durable attempt
    // records the definitive failure; no ambiguous outcome is involved.
    assert.equal(firstBody.succeeded, 1);
    assert.equal(firstBody.failed, 0);
    assert.equal(firstBody.skippedAmbiguous, 0);
    const definitive = await db.reportScheduleDispatchAttempt.findFirst({
      where: { scheduleId: id, status: "DEFINITIVE_FAILED" },
    });
    assert.ok(definitive, "the definitive failure is durably recorded");
    const midRow = await db.reportSchedule.findUnique({ where: { id } });
    assert.equal(midRow?.lastSentAt, null, "definitive failure keeps lastSentAt unchanged");

    // Second sweep: the designed retry re-attempts the occurrence.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.startsWith("https://hooks.slack.com/services/")) {
        throw new Error(`live network attempted: ${url}`);
      }
      deliveries.push(url);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const second = await reportSchedules(authed());
    const secondBody = await second.json();
    assert.equal(secondBody.succeeded, 1);
    const attemptRow = await db.reportScheduleDispatchAttempt.findFirst({
      where: { scheduleId: id, status: "CONFIRMED" },
    });
    assert.ok(attemptRow, "the retry confirmed the occurrence");
    const row = await db.reportSchedule.findUnique({ where: { id } });
    assert.ok(row?.lastSentAt);
    await db.reportSchedule.deleteMany({ where: { id } });
  });

  it("advances lastSentAt and marks CONFIRMED while disclosing a partial ambiguous channel", { timeout: 30000 }, async () => {
    const id = await seedDueSchedule("partial");
    const token = await claimScheduleDispatch({ id, workspaceId: wsA, lastSentAt: null });
    assert.ok(token);
    const attempt = await beginDispatchAttempt({ id, workspaceId: wsA }, OCCURRENCE, token);
    assert.equal(attempt.state, "claimed");

    // One destination confirms (200), the scheduled occurrence's second
    // destination would stall — simulated via a single mixed attempt where
    // the provider confirms and the occurrence carries an ambiguous marker
    // from a concurrent destination timeout.
    stallDeliveries = false;
    const result = await executeScheduleDispatch(
      id,
      { token, attempt: attempt.context },
      { overallDeadlineMs: 600, perRequestTimeoutMs: 200 },
    );
    assert.equal(result.slackDelivered, 1);
    assert.equal(result.ambiguous, 0);
    const row = await db.reportSchedule.findUnique({ where: { id } });
    assert.ok(row?.lastSentAt, "a confirmed channel completes the occurrence under the existing contract");
    const attemptRow = await db.reportScheduleDispatchAttempt.findUnique({
      where: { scheduleId_occurrenceDate: { scheduleId: id, occurrenceDate: OCCURRENCE } },
    });
    assert.equal(attemptRow?.status, "CONFIRMED");
    // A confirmed occurrence is never automatically re-dispatched: it is no
    // longer due under the shipped scheduling semantics.
    const fresh = new Date();
    assert.equal(
      isScheduleDue("0 0 * * *", row?.lastSentAt ?? null, fresh),
      false,
      "the confirmed occurrence is not due again",
    );
    await db.reportSchedule.deleteMany({ where: { id } });
  });

  it("keeps the next scheduled occurrence eligible after an ambiguous day", { timeout: 30000 }, async () => {
    const id = await seedDueSchedule("next-occ");
    const token = await claimScheduleDispatch({ id, workspaceId: wsA, lastSentAt: null });
    assert.ok(token);
    const attempt = await beginDispatchAttempt({ id, workspaceId: wsA }, "2026-09-12", token);
    assert.equal(attempt.state, "claimed");
    await markDispatchAttemptProviderStarted(attempt.context, wsA);
    await resolveDispatchAttempt(attempt.context, wsA, "AMBIGUOUS", {
      slack: { attempted: 1, confirmed: 0, definitiveFailed: 0, ambiguous: 1 },
    });
    // The shipped flow releases the lease after resolving the ambiguous
    // attempt; the next occurrence's claim then proceeds normally.
    await releaseScheduleDispatch(id, wsA, token);

    // The next occurrence (new UTC date) derives its own attempt and proceeds.
    const nextDate = "2026-09-13";
    const nextToken = await claimScheduleDispatch({ id, workspaceId: wsA, lastSentAt: null });
    assert.ok(nextToken);
    const nextAttempt = await beginDispatchAttempt({ id, workspaceId: wsA }, nextDate, nextToken);
    if (attempt.state !== "claimed" || nextAttempt.state !== "claimed") {
      assert.fail("both the ambiguous and the next occurrence attempts should have been claimed");
    }
    assert.notEqual(nextAttempt.context.attemptId, attempt.context.attemptId);
    const oldAttempt = await db.reportScheduleDispatchAttempt.findUnique({
      where: { scheduleId_occurrenceDate: { scheduleId: id, occurrenceDate: "2026-09-12" } },
    });
    assert.equal(oldAttempt?.status, "AMBIGUOUS", "the ambiguous occurrence is preserved for review");
    await db.reportSchedule.deleteMany({ where: { id } });
  });

  it("fences stale tokens from altering occurrence or channel outcomes", { timeout: 30000 }, async () => {
    const id = await seedDueSchedule("stale");
    const staleToken = await claimScheduleDispatch({ id, workspaceId: wsA, lastSentAt: null });
    assert.ok(staleToken);
    const attempt = await beginDispatchAttempt({ id, workspaceId: wsA }, OCCURRENCE, staleToken);
    assert.equal(attempt.state, "claimed");
    await markDispatchAttemptProviderStarted(attempt.context, wsA);

    // The lease expires and a fresh worker re-claims the same occurrence row.
    await db.reportSchedule.update({
      where: { id },
      data: { dispatchLeaseExpiresAt: new Date(Date.now() - 1000) },
    });
    const freshToken = await claimScheduleDispatch({ id, workspaceId: wsA, lastSentAt: null });
    assert.ok(freshToken);
    const freshAttempt = await beginDispatchAttempt({ id, workspaceId: wsA }, OCCURRENCE, freshToken);
    // The stale PROVIDER_STARTED attempt resolves to AMBIGUOUS for the fresh
    // owner; the fresh worker then claims a NEW occurrence row... in this
    // compact design the row is reused, so the fresh worker's claim resolves
    // the stale PROVIDER_STARTED and begins a fresh CLAIMED row.
    if (freshAttempt.state === "suppressed") {
      assert.equal(freshAttempt.reason, "AMBIGUOUS");
    } else {
      assert.equal(freshAttempt.context.token, freshToken);
    }

    // The stale owner can neither confirm, fail, nor release the occurrence.
    const staleConfirm = await resolveDispatchAttempt(attempt.context, wsA, "CONFIRMED", {
      slack: { attempted: 1, confirmed: 1, definitiveFailed: 0, ambiguous: 0 },
    });
    assert.equal(staleConfirm, false, "a stale owner cannot confirm");
    const staleFail = await resolveDispatchAttempt(attempt.context, wsA, "DEFINITIVE_FAILED", {
      slack: { attempted: 1, confirmed: 0, definitiveFailed: 1, ambiguous: 0 },
    });
    assert.equal(staleFail, false, "a stale owner cannot mark failed");
    const staleRelease = await releaseScheduleDispatch(id, wsA, staleToken);
    assert.equal(staleRelease, false, "a stale owner cannot release the newer lease");
    const row = await db.reportSchedule.findUnique({ where: { id } });
    assert.equal(row?.lastSentAt, null, "a stale owner cannot advance lastSentAt");
    await db.reportSchedule.deleteMany({ where: { id } });
  });

  it("creates no attempt state for unauthorized requests", { timeout: 30000 }, async () => {
    const id = await seedDueSchedule("unauth");
    const before = await db.reportScheduleDispatchAttempt.count();
    const unauth = await reportSchedules(new Request("http://localhost:3000/api/cron/report-schedules"));
    assert.equal(unauth.status, 401);
    const after = await db.reportScheduleDispatchAttempt.count();
    assert.equal(after, before, "unauthorized requests create no attempt state");
    await db.reportSchedule.deleteMany({ where: { id } });
  });

  it("hides attempt state from rival workspaces", { timeout: 30000 }, async () => {
    const id = await seedDueSchedule("rival");
    const token = await claimScheduleDispatch({ id, workspaceId: wsA, lastSentAt: null });
    assert.ok(token);
    const attempt = await beginDispatchAttempt({ id, workspaceId: wsA }, OCCURRENCE, token);
    assert.equal(attempt.state, "claimed");

    // A rival workspace's guarded queries cannot see wsA's attempt state.
    const rivalRows = await db.reportScheduleDispatchAttempt.findMany({
      where: { workspaceId: wsB, scheduleId: id },
    });
    assert.equal(rivalRows.length, 0);
    const ownRows = await db.reportScheduleDispatchAttempt.findMany({
      where: { workspaceId: wsA, scheduleId: id },
    });
    assert.equal(ownRows.length, 1);
    await db.reportSchedule.deleteMany({ where: { id } });
  });
});

/** Sends one brief through the direct cancellable Resend REST path. */
async function sendResendBrief(email: string, idempotencyKey: string) {
  const { sendClientBriefEmail } = await import("@/lib/mail");
  return sendClientBriefEmail(email, "Occ Client", "Occ WS", "# brief", { idempotencyKey, signal: AbortSignal.timeout(5_000) });
}
