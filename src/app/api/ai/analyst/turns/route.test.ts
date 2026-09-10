import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertAllowedTestDatabase } from "@/lib/pg-test-discipline";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { FLAGSHIP_REFUSAL_QUESTION } from "@/lib/ai/classify";
import { POST } from "./route";

/**
 * Analyst turn client scoping: the All Clients sentinel is a browser URL
 * representation, never a database identity. Omitted and valid concrete
 * clients proceed; unknown ids (including a literal `all`) stay sanitized
 * 404s via the server's strict validation.
 *
 * The refusing flagship question keeps this suite hermetic: classification
 * refuses before tools, queueing, or provider contact, while the route still
 * exercises session, workspace, client, and budget gates plus job audit rows.
 */
describe("analyst turns client scope", () => {
  let db: PrismaClient;
  const suffix = `anly-${Date.now()}-${process.pid}`;
  const ids = {
    owner: `user-${suffix}`,
    workspace: `ws-${suffix}`,
    client: `client-${suffix}`,
  };

  async function json(res: Response) {
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
  }

  function post(body: object) {
    return POST(new Request("http://localhost/api/ai/analyst/turns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  before(async () => {
    const url = assertAllowedTestDatabase(process.env.DATABASE_URL);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    await db.user.create({
      data: { id: ids.owner, email: `${ids.owner}@example.test`, name: "Analyst Owner" },
    });
    await db.workspace.create({
      data: { id: ids.workspace, ownerId: ids.owner, name: "Analyst WS", slug: `anly-${suffix}`, plan: "professional" },
    });
    await db.workspaceMember.create({
      data: { workspaceId: ids.workspace, userId: ids.owner, role: "owner" },
    });
    await db.client.create({
      data: { id: ids.client, workspaceId: ids.workspace, name: "Analyst Client" },
    });
    setAuthSessionOverride(async () => ({
      user: { id: ids.owner, email: `${ids.owner}@example.test` },
      expires: "2099-01-01T00:00:00.000Z",
    }));
  });

  after(async () => {
    setAuthSessionOverride(null);
    try {
      await db.agentJob.deleteMany({ where: { workspaceId: ids.workspace } });
      await db.workspaceAiPolicy.deleteMany({ where: { workspaceId: ids.workspace } });
      await db.client.deleteMany({ where: { workspaceId: ids.workspace } });
      await db.workspaceMember.deleteMany({ where: { workspaceId: ids.workspace } });
      await db.workspace.delete({ where: { id: ids.workspace } });
      await db.user.delete({ where: { id: ids.owner } });
    } finally {
      await db.$disconnect();
    }
  });

  it("omitted client follows the workspace-wide path without a client 404", async () => {
    const result = await json(await post({ workspaceId: ids.workspace, question: FLAGSHIP_REFUSAL_QUESTION }));
    assert.equal(result.status, 200);
    assert.equal((result.body as { status?: string }).status, "refused");
    assert.notEqual(result.status, 404);
  });

  it("valid concrete client remains scoped and does not 404", async () => {
    const result = await json(await post({
      workspaceId: ids.workspace,
      clientId: ids.client,
      question: FLAGSHIP_REFUSAL_QUESTION,
    }));
    assert.equal(result.status, 200);
    assert.equal((result.body as { status?: string }).status, "refused");
  });

  it("genuinely unknown client remains a sanitized 404", async () => {
    const result = await json(await post({
      workspaceId: ids.workspace,
      clientId: `client-does-not-exist-${suffix}`,
      question: FLAGSHIP_REFUSAL_QUESTION,
    }));
    assert.equal(result.status, 404);
    assert.equal((result.body as { error?: string }).error, "Client not found");
    assert.equal("turnId" in result.body, false);
  });

  it("literal all sentinel stays a strict unknown-client 404 at the server boundary", async () => {
    // The browser must normalize `all` to an omitted client before sending;
    // the server keeps treating the literal as an unknown database identity.
    const result = await json(await post({
      workspaceId: ids.workspace,
      clientId: "all",
      question: FLAGSHIP_REFUSAL_QUESTION,
    }));
    assert.equal(result.status, 404);
    assert.equal((result.body as { error?: string }).error, "Client not found");
  });
});
