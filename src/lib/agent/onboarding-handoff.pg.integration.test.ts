import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { before, after, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { encrypt } from "@/lib/encryption";
import { createOrResumeOnboardingRun, getAgentRun } from "./runs";
import { saveRunGoal } from "./saved-goal";
import { getOnboardingHandoff, prepareOnboardingMonitoringDraft } from "./onboarding-handoff";
import { getAgentConsoleOperationalSummary } from "@/lib/agent-console/console-summary";

describe("Owned onboarding to monitoring draft handoff (synthetic PostgreSQL)", { skip: !process.env.DATABASE_URL }, () => {
  const db = new PrismaClient(), suffix = randomUUID();
  const ownerId = `handoff-owner-${suffix}`, peerId = `handoff-peer-${suffix}`, workspaceId = `handoff-workspace-${suffix}`, connectionId = `handoff-source-${suffix}`;
  const scope = { userId: ownerId, workspaceId };
  const previous = { onboarding: process.env.ENABLE_AGENT_ONBOARDING, cohort: process.env.AGENT_ONBOARDING_WORKSPACE_IDS, console: process.env.ENABLE_AGENT_CONSOLE, encryption: process.env.ENCRYPTION_KEY };
  let runId: string, version: number, taskId: string, jobId: string;
  before(async () => {
    process.env.ENABLE_AGENT_ONBOARDING = "1"; process.env.AGENT_ONBOARDING_WORKSPACE_IDS = workspaceId;
    process.env.ENABLE_AGENT_CONSOLE = "1"; process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
    for (const id of [ownerId, peerId]) await db.user.create({ data: { id, email: `${id}@example.test`, workContext: "Review advertising spend" } });
    await db.workspace.create({ data: { id: workspaceId, ownerId, name: "Synthetic handoff", slug: `handoff-${suffix}` } });
    await db.workspaceMember.createMany({ data: [{ workspaceId, userId: ownerId, role: "owner" }, { workspaceId, userId: peerId, role: "admin" }] });
    await db.connection.create({ data: { id: connectionId, workspaceId, provider: "google_ads", type: "source", name: "Synthetic Google", status: "connected", credentials: encrypt(JSON.stringify({ customerIds: ["101", "202"] })) } });
    const created = await createOrResumeOnboardingRun(ownerId, { workspaceId, kind: "onboarding" }); runId = created.run.id; version = created.run.version;
  });
  after(async () => {
    await db.agentTask.deleteMany({ where: { workspaceId } });
    await db.workspace.deleteMany({ where: { id: workspaceId } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, peerId] } } });
    await db.$disconnect();
    for (const [key, value] of Object.entries({ ENABLE_AGENT_ONBOARDING: previous.onboarding, AGENT_ONBOARDING_WORKSPACE_IDS: previous.cohort, ENABLE_AGENT_CONSOLE: previous.console, ENCRYPTION_KEY: previous.encryption })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  it("run snapshots its goal independently of later profile edits", async () => {
    await db.user.update({ where: { id: ownerId }, data: { workContext: "Prepare client reporting" } });
    assert.equal((await getAgentRun(scope, runId)).run.goal?.id, "spend");
    await saveRunGoal(scope, runId, { expectedVersion: version, goalId: "performance" });
    const reloaded = await getAgentRun(scope, runId); version = reloaded.run.version;
    assert.equal(reloaded.run.goal?.id, "performance");
    await assert.rejects(saveRunGoal(scope, runId, { expectedVersion: version - 1, goalId: "reporting" }), { code: "stale_version" });
  });
  it("unfinished setup offers a blocker and creates no draft", async () => {
    assert.equal((await getOnboardingHandoff(scope, runId)).canPrepareDraft, false);
    await assert.rejects(prepareOnboardingMonitoringDraft(scope, runId, { expectedVersion: version }), { code: "handoff_blocked" });
    assert.equal(await db.agentResponsibility.count({ where: { workspaceId } }), 0);
  });
  it("complete scoped import offers data without blended currency or expanded account scope", async () => {
    const job = await db.warehouseImportJob.create({ data: { workspaceId, userId: ownerId, since: "2026-09-25", until: "2026-10-01", items: [{ connectionId, accountId: "101" }], status: "completed", totalItems: 1, completedItems: 1, approximateRows: 1 } }); jobId = job.id;
    const task = await db.agentTask.create({ data: { workspaceId, runId, taskKey: "connect:google_ads", provider: "google_ads", state: "ready", scopeRevision: 1, importJobId: jobId,
      confirmedScope: { provider: "google_ads", connectionId, selectedAccountIds: ["101"], since: "2026-09-25", until: "2026-10-01" }, result: { verified: true } } }); taskId = task.id;
    await db.campaignMetric.create({ data: { workspaceId, connectionId, platform: "google_ads", accountId: "101", level: "campaign", entityId: `e-${suffix}`, date: new Date("2026-09-30T00:00:00Z"), spend: 25, currency: "USD" } });
    await db.agentRun.update({ where: { id: runId }, data: { status: "completed", reviewedAt: new Date() } });
    const handoff = await getOnboardingHandoff(scope, runId);
    assert.equal(handoff.canPrepareDraft, true); assert.equal(handoff.goal?.id, "performance");
    assert.deepEqual(handoff.scopeItems, [{ connectionId, provider: "google_ads", providerAccountId: "101" }]);
    assert.equal(handoff.sources[0].spend, 25); assert.equal(handoff.sources[0].currency, "USD");
    assert.deepEqual(handoff.sources[0].window, { since: "2026-09-25", until: "2026-10-01" });
  });
  it("explicit duplicate handoffs create one unapproved draft with durable origin", async () => {
    const [a, b] = await Promise.all([prepareOnboardingMonitoringDraft(scope, runId, { expectedVersion: version }), prepareOnboardingMonitoringDraft(scope, runId, { expectedVersion: version })]);
    assert.equal(a.responsibilityId, b.responsibilityId); assert.equal(a.status, "draft");
    assert.equal(await db.agentResponsibility.count({ where: { workspaceId } }), 1);
    assert.equal(await db.agentAuthorization.count({ where: { workspaceId } }), 0);
    const summary = await getAgentConsoleOperationalSummary(workspaceId, ownerId);
    assert.equal(summary.setupDrafts[0].onboardingRunId, runId);
    assert.equal(summary.setupDrafts[0].goalLabel, "Understand campaign performance");
    assert.equal(summary.setupDrafts[0].scopes.length, 1);
  });
  it("peer workspace admins cannot inherit another user's onboarding run", async () => {
    await assert.rejects(getOnboardingHandoff({ userId: peerId, workspaceId }, runId), { code: "run_not_found" });
    await assert.rejects(prepareOnboardingMonitoringDraft(scope, runId, { expectedVersion: version + 1 }), { code: "stale_version" });
  });
  it("unsupported providers and browser-supplied scope cannot widen the handoff", async () => {
    const task = await db.agentTask.create({ data: { workspaceId, runId, taskKey: "connect:shopee", provider: "shopee", state: "ready", scopeRevision: 1,
      confirmedScope: { provider: "shopee", connectionId, selectedAccountIds: ["shop-1"], since: "2026-09-25", until: "2026-10-01" }, result: { verified: true } } });
    assert.equal((await getOnboardingHandoff(scope, runId)).canPrepareDraft, false);
    assert.match((await getOnboardingHandoff(scope, runId)).blockers[0], /not available/);
    await db.agentTask.delete({ where: { id: task.id } });
    await assert.rejects(prepareOnboardingMonitoringDraft(scope, runId, { expectedVersion: version, scopeItems: [{ providerAccountId: "202" }] }));
  });
  it("missing warehouse data and partial job outcome block handoff despite old ready flags", async () => {
    await db.warehouseImportJob.update({ where: { id: jobId }, data: { status: "partial" } });
    assert.match((await getOnboardingHandoff(scope, runId)).blockers[0], /incomplete/);
    await db.warehouseImportJob.update({ where: { id: jobId }, data: { status: "completed" } });
    await db.campaignMetric.deleteMany({ where: { workspaceId } });
    assert.match((await getOnboardingHandoff(scope, runId)).blockers[0], /unavailable/);
    await assert.rejects(prepareOnboardingMonitoringDraft(scope, runId, { expectedVersion: version }), { code: "handoff_blocked" });
    assert.equal(await db.agentResponsibility.count({ where: { workspaceId } }), 1);
  });
  it("loss of membership blocks reading or writing saved handoff", async () => {
    await db.workspaceMember.deleteMany({ where: { workspaceId, userId: ownerId } });
    await assert.rejects(getOnboardingHandoff(scope, runId), { code: "access_denied" });
    await assert.rejects(prepareOnboardingMonitoringDraft(scope, runId, { expectedVersion: version }), { code: "access_denied" });
    assert.equal(await db.agentTask.count({ where: { id: taskId } }), 1);
  });
});
