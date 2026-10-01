import assert from "node:assert/strict";
import { it, mock } from "node:test";
import prisma from "./prisma";
import { sendAgencyAlert, shouldFailHealthTickForAlertDelivery } from "./alerts";

it("stops treating an old dead-letter count as a permanent health-tick failure", () => {
  assert.equal(shouldFailHealthTickForAlertDelivery({ pending: 0, deadLettered: 0 }), false);
  assert.equal(shouldFailHealthTickForAlertDelivery({ pending: 0, deadLettered: 1 }), true);
  assert.equal(shouldFailHealthTickForAlertDelivery({ pending: 1, deadLettered: 0 }), true);
  // A historical dead letter remains visible in telemetry but does not keep
  // all later health checks red once no delivery attempt failed this tick.
  assert.equal(shouldFailHealthTickForAlertDelivery({ pending: 0, deadLettered: 0 }), false);
});


it("only completes a leased alert after a Telegram message receipt, and sends arbitrary errors as plain text", async () => {
  const previous = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "fixture-only-token";
  const writes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const candidate = { id: "alert-fixture", workspaceId: "ws-fixture", pipelineName: "Source_[broken]", clientId: null,
    errorMsg: "Error * [ unmatched _ access_token=secret", actionHint: null, attempts: 0 };
  // Prisma delegates use proxy getters rather than method descriptors, so install
  // scoped stubs directly and restore every delegate after this test.
  function stub(target: object, key: string, implementation: unknown) {
    const record = target as Record<string, unknown>;
    const original = record[key];
    record[key] = implementation;
    return () => { record[key] = original; };
  }
  const restores = [
    stub(prisma.agencyAlertDelivery, "create", async () => ({ id: candidate.id })),
    stub(prisma.agencyAlertDelivery, "findFirst", async () => candidate),
    stub(prisma.agencyAlertDelivery, "updateMany", async (args: typeof writes[number]) => { writes.push(args); return { count: 1 }; }),
    stub(prisma.workspace, "findUnique", async () => ({ telegramChatId: "fixture-recipient" })),
  ];
  let payload: unknown = { ok: true, result: { message_id: 42 } };
  let malformed = false;
  let httpStatus = 200;
  let requestFails = false;
  const fetchMock = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.parse_mode, undefined);
    assert.match(body.text, /Source_\[broken\]/);
    assert.ok(init?.signal);
    if (requestFails) throw new Error("fixture network failure with secret");
    return new Response(malformed ? "not-json" : JSON.stringify(payload), { status: httpStatus });
  });
  try {
    for (const receipt of [{ ok: true, result: { message_id: 42 } }, { ok: false, description: "secret" },
      { ok: true }, { ok: true, result: { message_id: "42" } }, { ok: true, result: { message_id: 4.2 } }, null]) {
      payload = receipt; writes.length = 0;
      await sendAgencyAlert({ workspaceId: candidate.workspaceId, pipelineName: candidate.pipelineName, errorMsg: candidate.errorMsg });
      const completion = writes.at(-1)!;
      assert.equal(completion.data.status, receipt?.ok === true && Number.isInteger(receipt.result?.message_id) ? "sent" : "pending");
      assert.equal(completion.where.status, "sending");
      assert.equal(typeof completion.where.leaseId, "string");
      assert.ok(!JSON.stringify(completion.data).includes("secret"));
    }
    malformed = true; writes.length = 0;
    await sendAgencyAlert({ workspaceId: candidate.workspaceId, pipelineName: "source", errorMsg: "error" });
    assert.equal(writes.at(-1)!.data.status, "pending");
    malformed = false; payload = { ok: true, result: { message_id: 42 } }; httpStatus = 429; writes.length = 0;
    await sendAgencyAlert({ workspaceId: candidate.workspaceId, pipelineName: "source", errorMsg: "error" });
    assert.equal(writes.at(-1)!.data.status, "pending");
    assert.equal(writes.at(-1)!.data.lastError, "Telegram returned HTTP 429");
    httpStatus = 200; requestFails = true; writes.length = 0;
    await sendAgencyAlert({ workspaceId: candidate.workspaceId, pipelineName: "source", errorMsg: "error" });
    assert.equal(writes.at(-1)!.data.status, "pending");
    assert.equal(writes.at(-1)!.data.lastError, "Telegram request failed or timed out");
  } finally {
    fetchMock.mock.restore(); restores.forEach(restore => restore());
    if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = previous;
  }
});
