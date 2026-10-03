import assert from "node:assert/strict";
import { it } from "node:test";
import prisma from "./prisma";
import { deliverPendingAgencyAlerts, shouldFailHealthTickForAlertDelivery } from "./alerts";

it("counts failed alert transitions only when the worker still owns the lease", async (t) => {
  // Prisma delegates expose proxy getters; restore direct stubs after this test.
  const restores: Array<() => void> = [];
  function stub(target: object, key: string, implementation: unknown) {
    const record = target as Record<string, unknown>;
    const original = record[key];
    record[key] = implementation;
    restores.push(() => { record[key] = original; });
  }
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  t.after(() => {
    restores.reverse().forEach(restore => restore());
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
  });
  process.env.TELEGRAM_BOT_TOKEN = "fixture-only";
  let attempts = 11;
  let ownsLease = false;
  let selected = false;
  const candidate = { id: "fixture-alert", workspaceId: "fixture-workspace", pipelineName: "source",
    clientId: null, errorMsg: "failure", actionHint: null };
  let claimLease: unknown;
  let deferredStatus: unknown;
  stub(prisma.agencyAlertDelivery, "findFirst", async () => {
    if (selected) return null;
    selected = true;
    return { ...candidate, attempts };
  });
  stub(prisma.agencyAlertDelivery, "updateMany", async (args: {
    where: { id: string; status?: string; leaseId?: string };
    data: { status: string; leaseId?: string };
  }) => {
    if (args.data.status === "sending") {
      claimLease = args.data.leaseId;
      return { count: 1 };
    }
    assert.equal(args.where.id, candidate.id);
    assert.equal(args.where.status, "sending");
    assert.equal(args.where.leaseId, claimLease);
    assert.equal(typeof claimLease, "string");
    deferredStatus = args.data.status;
    return { count: ownsLease ? 1 : 0 };
  });
  stub(prisma.workspace, "findUnique", async () => ({ telegramChatId: "fixture-recipient" }));
  // Simulate another worker completing the alert before this worker defers it.
  stub(prisma.agencyAlertDelivery, "count", async () => 0);
  stub(prisma.agencyAlertDelivery, "deleteMany", async () => ({ count: 0 }));
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));

  for (const testCase of [
    { attempts: 11, ownsLease: false, dead: 0, retry: 0, idle: 1 },
    { attempts: 0, ownsLease: false, dead: 0, retry: 0, idle: 1 },
    { attempts: 11, ownsLease: true, dead: 1, retry: 0, idle: 1 },
    { attempts: 0, ownsLease: true, dead: 0, retry: 1, idle: 1 },
  ]) {
    attempts = testCase.attempts; ownsLease = testCase.ownsLease; selected = false;
    const result = await deliverPendingAgencyAlerts(2);
    assert.equal(deferredStatus, attempts === 11 ? "dead" : "pending");
    assert.equal(result.deadLettered, testCase.dead);
    assert.equal(result.retry_scheduled, testCase.retry);
    assert.equal(result.idle, testCase.idle);
    assert.equal(shouldFailHealthTickForAlertDelivery(result), testCase.dead === 1);
  }
});
