import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createResponsibilityDraft, updateDataHealthDraft, confirmResponsibilityAction } from "./responsibilities";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { PATCH as saveDraftPatch } from "@/app/api/agent-console/responsibilities/[id]/route";
import { encrypt } from "@/lib/encryption";
import { getAgentConsoleOperationalSummary } from "./console-summary";

// Synthetic accounts in an isolated workspace. No provider requests are made.
describe("Saved connected-data setup against PostgreSQL", { skip: !process.env.DATABASE_URL }, () => {
  const db = new PrismaClient();
  const previousEncryptionKey = process.env.ENCRYPTION_KEY;
  const suffix = randomUUID();
  const ownerId = `setup-owner-${suffix}`, memberId = `setup-member-${suffix}`, foreignId = `setup-foreign-${suffix}`;
  const workspaceId = `setup-workspace-${suffix}`, connectionId = `setup-source-${suffix}`;
  const scope = (account: string) => ({ connectionId, provider: "meta_ads", providerAccountId: account, accountName: `Synthetic ${account}` });
  const input = () => ({ workspaceId, kind: "data_health", cadence: "daily", timezone: "Asia/Ho_Chi_Minh",
    draftRequestId: randomUUID(), configuration: { recoveryPolicy: "retry_failed_window", permittedRecoveryModes: ["retry_failed_window"] }, scopeItems: [scope("act_101")] });
  let draftId: string, draftVersion: number;
  before(async () => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
    for (const id of [ownerId, memberId, foreignId]) await db.user.create({ data: { id, email: `${id}@example.test`, plan: "professional" } });
    await db.workspace.create({ data: { id: workspaceId, ownerId, name: "Synthetic saved setup", slug: `setup-${suffix}`, plan: "professional" } });
    await db.workspaceMember.createMany({ data: [{ workspaceId, userId: ownerId, role: "owner" }, { workspaceId, userId: memberId, role: "member" }] });
    await db.connection.create({ data: { id: connectionId, workspaceId, name: "Synthetic Meta", type: "source", provider: "meta_ads", status: "connected",
      credentials: encrypt(JSON.stringify({ adAccountIds: ["act_101", "act_202"] })) } });
  });
  after(async () => {
    await db.workspace.deleteMany({ where: { id: workspaceId } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, memberId, foreignId] } } });
    await db.$disconnect();
    if (previousEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousEncryptionKey;
  });
  it("concurrent retry saves one draft and grants no monitoring authority", async () => {
    const payload = input();
    const [first, replay] = await Promise.all([createResponsibilityDraft(ownerId, payload), createResponsibilityDraft(ownerId, payload)]);
    assert.equal(first.responsibility.id, replay.responsibility.id);
    draftId = first.responsibility.id; draftVersion = first.responsibility.version;
    assert.equal(await db.agentResponsibility.count({ where: { workspaceId } }), 1);
    assert.equal(first.responsibility.status, "draft");
    assert.equal(first.responsibility.nextDueAt, null);
    assert.equal(await db.agentAuthorization.count({ where: { workspaceId } }), 0);
    assert.equal(await db.agentEvaluation.count({ where: { workspaceId } }), 0);
    await assert.rejects(createResponsibilityDraft(ownerId, { ...payload, scopeItems: [scope("act_202")] }), { code: "idempotency_conflict" });
  });
  it("reload restores choices; edits retain only current scope in the setup summary", async () => {
    const original = await getAgentConsoleOperationalSummary(workspaceId, ownerId);
    assert.equal(original.setupDrafts[0].id, draftId);
    assert.deepEqual(original.setupDrafts[0].scopes.map(s => s.providerAccountId), ["act_101"]);
    const edited = await updateDataHealthDraft(ownerId, draftId, { workspaceId, expectedVersion: draftVersion, scopeItems: [scope("act_202")] });
    assert.equal(edited.responsibility.status, "draft");
    assert.equal(edited.responsibility.nextDueAt, null);
    draftVersion = edited.responsibility.version;
    const reloaded = await getAgentConsoleOperationalSummary(workspaceId, ownerId);
    assert.deepEqual(reloaded.setupDrafts[0].scopes.map(s => s.providerAccountId), ["act_202"]);
    assert.equal(reloaded.responsibilities[0].scopeCount, 1);
    assert.equal(await db.agentAuthorization.count({ where: { workspaceId } }), 0);
    assert.equal(await db.agentConsoleEvent.count({ where: { workspaceId, type: "responsibility_draft_updated" } }), 1);
  });
  it("stale edits cannot overwrite choices and add no scope revision", async () => {
    await assert.rejects(updateDataHealthDraft(ownerId, draftId, { workspaceId, expectedVersion: draftVersion - 1, scopeItems: [scope("act_101")] }), { code: "stale_version" });
    assert.equal((await db.agentResponsibility.findUniqueOrThrow({ where: { id: draftId } })).version, draftVersion);
  });
  it("foreign users and members editing another author fail closed", async () => {
    const payload = { workspaceId, expectedVersion: draftVersion, scopeItems: [scope("act_101")] };
    await assert.rejects(updateDataHealthDraft(foreignId, draftId, payload));
    await assert.rejects(updateDataHealthDraft(memberId, draftId, payload), { code: "forbidden" });
  });
  it("draft edits revalidate saved provider account grants", async () => {
    await assert.rejects(updateDataHealthDraft(ownerId, draftId, { workspaceId, expectedVersion: draftVersion, scopeItems: [scope("act_not_granted")] }), { code: "account_scope_unverified" });
    assert.equal((await db.agentResponsibility.findUniqueOrThrow({ where: { id: draftId } })).version, draftVersion);
  });
  it("saving a draft cannot assign its owner to someone outside the workspace", async () => {
    const before = await db.agentResponsibility.count({ where: { workspaceId } });
    await assert.rejects(createResponsibilityDraft(ownerId, { ...input(), ownerId: foreignId }), { code: "access_denied" });
    assert.equal(await db.agentResponsibility.count({ where: { workspaceId } }), before);
    assert.equal(await db.agentAuthorization.count({ where: { workspaceId } }), 0);
  });
  it("members can save their own setup without authorizing execution", async () => {
    const created = await createResponsibilityDraft(memberId, input());
    const edited = await updateDataHealthDraft(memberId, created.responsibility.id, { workspaceId, expectedVersion: created.responsibility.version, scopeItems: [scope("act_202")] });
    assert.equal(edited.responsibility.status, "draft");
    assert.equal(await db.agentAuthorization.count({ where: { workspaceId } }), 0);
  });
  it("an unavailable worker cannot activate a saved draft", async () => {
    const previous = process.env.ENABLE_AGENT_CONSOLE_MONITORING;
    delete process.env.ENABLE_AGENT_CONSOLE_MONITORING;
    try {
      await assert.rejects(confirmResponsibilityAction(ownerId, draftId, { workspaceId, expectedVersion: draftVersion,
        scopeHash: "not-authorized", allowlistedTools: ["submit_recovery_import"], allowedPairs: [scope("act_202")] }), { code: "monitoring_unavailable" });
      assert.equal((await db.agentResponsibility.findUniqueOrThrow({ where: { id: draftId } })).status, "draft");
    } finally {
      if (previous === undefined) delete process.env.ENABLE_AGENT_CONSOLE_MONITORING;
      else process.env.ENABLE_AGENT_CONSOLE_MONITORING = previous;
    }
  });
  it("the PATCH route enforces authentication, feature availability and optimistic versioning", async () => {
    const previousFlag = process.env.ENABLE_AGENT_CONSOLE;
    const request = () => new Request(`http://localhost/api/agent-console/responsibilities/${draftId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, expectedVersion: draftVersion, scopeItems: [scope("act_101")] }),
    });
    const params = { params: Promise.resolve({ id: draftId }) };
    try {
      process.env.ENABLE_AGENT_CONSOLE = "1";
      setAuthSessionOverride(async () => null);
      assert.equal((await saveDraftPatch(request(), params)).status, 401);
      setAuthSessionOverride(async () => ({ user: { id: foreignId, email: `${foreignId}@example.test` }, expires: "2099-01-01T00:00:00Z" }));
      assert.equal((await saveDraftPatch(request(), params)).status, 403);
      setAuthSessionOverride(async () => ({ user: { id: ownerId, email: `${ownerId}@example.test` }, expires: "2099-01-01T00:00:00Z" }));
      const staleRequest = request();
      const response = await saveDraftPatch(request(), params);
      assert.equal(response.status, 200);
      draftVersion = (await response.json()).responsibility.version;
      assert.equal((await saveDraftPatch(staleRequest, params)).status, 409);
      delete process.env.ENABLE_AGENT_CONSOLE;
      assert.equal((await saveDraftPatch(request(), params)).status, 404);
    } finally {
      setAuthSessionOverride(null);
      if (previousFlag === undefined) delete process.env.ENABLE_AGENT_CONSOLE;
      else process.env.ENABLE_AGENT_CONSOLE = previousFlag;
    }
  });
  it("the draft endpoint cannot alter a responsibility after activation", async () => {
    // Status guard exercised without enabling a live scheduler.
    await db.agentResponsibility.update({ where: { id: draftId }, data: { status: "active" } });
    await assert.rejects(updateDataHealthDraft(ownerId, draftId, { workspaceId, expectedVersion: draftVersion, scopeItems: [scope("act_101")] }), { code: "draft_only" });
    assert.equal((await getAgentConsoleOperationalSummary(workspaceId, ownerId)).setupDrafts.some(d => d.id === draftId), false);
  });
});
