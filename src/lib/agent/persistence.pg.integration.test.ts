import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import { assertCiDatabaseReachable, assertCiDatabaseReachableWhenMissing } from "@/lib/pg-test-discipline";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { AgentError } from "./contracts";
import { createOrResumeOnboardingRun, getAgentRun, appendUserMessage, saveWorkProfile, setAgentRunPaused } from "./runs";
import { createProviderTask, transitionAgentTask, attachTaskConnections } from "./tasks";
import { POST as createRunRoute } from "@/app/api/agent/runs/route";
import { GET as getRunRoute } from "@/app/api/agent/runs/[runId]/route";
import { PATCH as profileRoute } from "@/app/api/me/work-profile/route";
import { coordinateMessage } from "./coordinator";
import { selectProviders } from "./tools";
import { POST as providersRoute } from "@/app/api/agent/runs/[runId]/providers/route";
import { POST as messagesRoute } from "@/app/api/agent/runs/[runId]/messages/route";
import { POST as taskActionRoute } from "@/app/api/agent/tasks/[taskId]/actions/route";
import { onboardingEntry } from "./entry";

describe("agent milestone 1: real Postgres persistence", () => {
  const db = new PrismaClient();
  const suffix = randomUUID();
  const userId = `agent-owner-${suffix}`, peerId = `agent-peer-${suffix}`, viewerId = `agent-viewer-${suffix}`;
  const workspaceId = `agent-workspace-${suffix}`, otherWorkspaceId = `agent-other-${suffix}`;
  const clientId = `agent-client-${suffix}`, connectionId = `agent-source-${suffix}`, foreignConnectionId = `agent-foreign-${suffix}`;
  const scope = { userId, workspaceId };
  let available = false;
  const oldFlag = process.env.ENABLE_AGENT_ONBOARDING;
  const domainError = (code: string) => (error: unknown) => error instanceof AgentError && error.code === code;
  const request = (body: unknown) => new Request("http://localhost/api/agent/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const run = () => createOrResumeOnboardingRun(userId, { kind: "onboarding", workspaceId });

  before(async () => {
    assertCiDatabaseReachableWhenMissing();
    if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("mock")) return;
    try { await db.$connect(); await db.$queryRaw`SELECT 1`; available = true; }
    catch { assertCiDatabaseReachable(); return; }
    for (const id of [userId, peerId, viewerId]) await db.user.create({ data: { id, email: `${id}@example.test` } });
    for (const id of [workspaceId, otherWorkspaceId]) {
      await db.workspace.create({ data: { id, ownerId: userId, name: "Agent persistence test", slug: id } });
      await db.workspaceMember.create({ data: { workspaceId: id, userId, role: "owner" } });
    }
    await db.workspaceMember.create({ data: { workspaceId, userId: peerId, role: "member" } });
    await db.workspaceMember.create({ data: { workspaceId, userId: viewerId, role: "member" } });
    await db.client.create({ data: { id: clientId, workspaceId: otherWorkspaceId, name: "Other workspace client" } });
    for (const [id, owner] of [[connectionId, workspaceId], [foreignConnectionId, otherWorkspaceId]]) await db.connection.create({ data: { id, workspaceId: owner, name: "Synthetic source", type: "source", provider: "tiktok_business", credentials: "synthetic-no-live-token" } });
  });
  beforeEach(async () => {
    if (!available) return;
    await db.agentRun.deleteMany({ where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } } });
    await db.workspaceMember.updateMany({ where: { workspaceId, userId: viewerId }, data: { role: "member" } });
    for (const provider of ["tiktok_business", "meta_ads", "google_ads", "shopee"]) await db.workspaceProviderAccess.upsert({ where: { workspaceId_provider: { workspaceId, provider } }, create: { workspaceId, provider, enabled: true }, update: { enabled: true } });
    process.env.ENABLE_AGENT_ONBOARDING = "1";
    setAuthSessionOverride(async () => ({ user: { id: userId }, expires: "2099-01-01T00:00:00.000Z" }));
  });
  after(async () => {
    setAuthSessionOverride(null);
    if (oldFlag === undefined) delete process.env.ENABLE_AGENT_ONBOARDING; else process.env.ENABLE_AGENT_ONBOARDING = oldFlag;
    if (available) {
      await db.agentRun.deleteMany({ where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } } });
      await db.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId] } } });
      await db.user.deleteMany({ where: { id: { in: [userId, peerId, viewerId] } } });
    }
    await db.$disconnect(); await prisma.$disconnect();
  });

  it("preserves the saved onboarding goal when only the role changes", async t => {
    if (!available) return t.skip("Postgres unavailable");
    await saveWorkProfile(userId, { category: "GROWTH_MARKETER", context: "Review advertising spend" });
    await saveWorkProfile(userId, { category: "BUSINESS_OWNER" });
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: userId } })).workContext, "Review advertising spend");
    await saveWorkProfile(userId, { category: "BUSINESS_OWNER", context: "" });
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: userId } })).workContext, null);
  });
  it("creates exactly one run and event under concurrent create/resume requests", async t => {
    if (!available) return t.skip("PostgreSQL required");
    const results = await Promise.all(Array.from({ length: 6 }, run));
    assert.equal(new Set(results.map(r => r.run.id)).size, 1);
    assert.equal(results.filter(r => r.created).length, 1);
    const snapshot = await getAgentRun(scope, results[0].run.id);
    assert.equal(snapshot.run.version, 1);
    assert.deepEqual(snapshot.events.map(e => e.sequence), [1]);
    await db.agentRun.update({ where: { id: snapshot.run.id }, data: { status: "completed", reviewedAt: new Date() } });
    assert.equal((await run()).run.id, snapshot.run.id, "Completion/reload must not restart setup");
  });

  it("denies foreign clients, workspaces, peer access and revoked membership", async t => {
    if (!available) return t.skip("PostgreSQL required");
    await assert.rejects(() => createOrResumeOnboardingRun(userId, { kind: "onboarding", workspaceId, clientId }), domainError("client_not_found"));
    const { run: r } = await run();
    await assert.rejects(() => getAgentRun({ userId, workspaceId: otherWorkspaceId }, r.id), domainError("run_not_found"));
    await assert.rejects(() => getAgentRun({ userId: peerId, workspaceId }, r.id), domainError("run_not_found"));
    await assert.rejects(() => getAgentRun({ userId: "missing-user", workspaceId }, r.id), domainError("access_denied"));
    const { run: viewerRun } = await createOrResumeOnboardingRun(viewerId, { kind: "onboarding", workspaceId });
    await db.workspaceMember.updateMany({ where: { userId: viewerId, workspaceId }, data: { role: "viewer" } });
    assert.equal((await getAgentRun({ userId: viewerId, workspaceId }, viewerRun.id)).run.id, viewerRun.id);
    await assert.rejects(() => createProviderTask({ userId: viewerId, workspaceId }, viewerRun.id, "meta_ads", viewerRun.version), domainError("insufficient_role"));
  });

  it("deduplicates task creation and rejects competing stale run mutations", async t => {
    if (!available) return t.skip("PostgreSQL required");
    const { run: r } = await run();
    const tasks = await Promise.all(Array.from({ length: 4 }, () => createProviderTask(scope, r.id, "tiktok_business", r.version)));
    assert.equal(new Set(tasks.map(task => task.id)).size, 1);
    const s = await getAgentRun(scope, r.id);
    const writes = await Promise.allSettled([createProviderTask(scope, r.id, "meta_ads", s.run.version), createProviderTask(scope, r.id, "google_ads", s.run.version)]);
    assert.equal(writes.filter(w => w.status === "fulfilled").length, 1);
    const failed = writes.find(w => w.status === "rejected");
    assert.ok(failed?.status === "rejected" && domainError("stale_version")(failed.reason));
    const final = await getAgentRun(scope, r.id);
    assert.deepEqual(final.events.map(e => e.sequence), [1, 2, 3]);
    assert.equal(final.tasks.length, 2);
  });

  it("makes message replay idempotent and commits state/events without gaps", async t => {
    if (!available) return t.skip("PostgreSQL required");
    const { run: r } = await run();
    const input = { messageId: "request-1", text: "Connect TikTok", expectedVersion: r.version };
    const messages = await Promise.all(Array.from({ length: 4 }, () => appendUserMessage(scope, r.id, input)));
    assert.equal(new Set(messages.map(m => m.id)).size, 1);
    await assert.rejects(() => appendUserMessage(scope, r.id, { ...input, text: "Different request" }), domainError("idempotency_conflict"));
    await assert.rejects(() => appendUserMessage(scope, r.id, { ...input, messageId: "stale" }), domainError("stale_version"));
    const s = await getAgentRun(scope, r.id);
    assert.equal(s.messages.length, 1); assert.deepEqual(s.events.map(e => e.sequence), [1, 2]);
    assert.equal(s.run.version, 2);
  });

  it("preserves task version and events when validation fails; prevents fake imports", async t => {
    if (!available) return t.skip("PostgreSQL required");
    const { run: r } = await run();
    const task = await createProviderTask(scope, r.id, "tiktok_business", r.version);
    await assert.rejects(() => transitionAgentTask(scope, task.id, { expectedVersion: 0, state: "discovering_accounts" }), domainError("connection_required"));
    await assert.rejects(() => transitionAgentTask(scope, task.id, { expectedVersion: 0, state: "needs_attention" }), domainError("reason_required"));
    let s = await getAgentRun(scope, r.id);
    assert.equal(s.tasks[0].version, 0); assert.equal(s.events.length, 2);
    const linked = await attachTaskConnections(scope, task.id, [connectionId, connectionId], 0);
    assert.equal(linked.state, "discovering_accounts");
    assert.equal((await attachTaskConnections(scope, task.id, [connectionId], 0)).version, linked.version);
    const selected = await transitionAgentTask(scope, task.id, { expectedVersion: linked.version, state: "waiting_selection" });
    await assert.rejects(() => transitionAgentTask(scope, task.id, { expectedVersion: selected.version, state: "queued" }), domainError("execution_not_available"));
    await assert.rejects(() => transitionAgentTask(scope, task.id, { expectedVersion: 0, state: "needs_attention", reasonCode: "discovery_failed" }), domainError("stale_version"));
    s = await getAgentRun(scope, r.id); assert.deepEqual(s.events.map(e => e.sequence), [1, 2, 3, 4]);
    assert.equal(await db.warehouseImportJob.count({ where: { workspaceId } }), 0);
  });

  it("recovers authorization with the same connection without duplicate links", async t => {
    if (!available) return t.skip("PostgreSQL required");
    const { run: r } = await run();
    const task = await createProviderTask(scope, r.id, "tiktok_business", r.version);
    const linked = await attachTaskConnections(scope, task.id, [connectionId], task.version);
    const attention = await transitionAgentTask(scope, task.id, { expectedVersion: linked.version, state: "needs_attention", reasonCode: "reconnect_required" });
    const waiting = await transitionAgentTask(scope, task.id, { expectedVersion: attention.version, state: "waiting_authorization" });
    const recovered = await attachTaskConnections(scope, task.id, [connectionId], waiting.version);
    assert.equal(recovered.state, "discovering_accounts");
    assert.equal(recovered.version, waiting.version + 1);
    assert.equal(await db.agentTaskConnection.count({ where: { workspaceId, taskId: task.id } }), 1);
    assert.equal((await attachTaskConnections(scope, task.id, [connectionId], waiting.version)).version, recovered.version);
    const snapshot = await getAgentRun(scope, r.id);
    assert.deepEqual(snapshot.events.map(e => e.sequence), [1, 2, 3, 4, 5, 6]);
  });

  it("enforces relational tenant boundaries at the database layer", async t => {
    if (!available) return t.skip("PostgreSQL required");
    const { run: r } = await run();
    const task = await createProviderTask(scope, r.id, "tiktok_business", r.version);
    await assert.rejects(() => attachTaskConnections(scope, task.id, [foreignConnectionId], 0), domainError("connection_not_available"));
    await assert.rejects(() => db.agentTaskConnection.create({ data: { workspaceId, taskId: task.id, connectionId: foreignConnectionId } }), (e: unknown) => (e as { code: string }).code === "P2003");
    await assert.rejects(() => db.agentRunMessage.create({ data: { workspaceId: otherWorkspaceId, runId: r.id, messageKey: "foreign", role: "user", content: "No" } }), (e: unknown) => (e as { code: string }).code === "P2003");
    const { run: other } = await createOrResumeOnboardingRun(userId, { kind: "onboarding", workspaceId: otherWorkspaceId });
    await assert.rejects(() => db.agentRunEvent.create({ data: { workspaceId: otherWorkspaceId, runId: other.id, taskId: task.id, sequence: 2, type: "foreign", payload: {} } }), (e: unknown) => (e as { code: string }).code === "P2003");
    await assert.rejects(() => db.agentRun.create({ data: { workspaceId, initiatorUserId: userId, clientId } }), (e: unknown) => (e as { code: string }).code === "P2003");
  });

  it("pauses/resumes with optimistic versions while preserving confirmed history", async t => {
    if (!available) return t.skip("PostgreSQL required");
    const { run: r } = await run();
    const paused = await setAgentRunPaused(scope, r.id, r.version, true);
    await assert.rejects(() => appendUserMessage(scope, r.id, { messageId: "paused", text: "Start", expectedVersion: paused.version }), domainError("run_not_active"));
    const resumed = await setAgentRunPaused(scope, r.id, paused.version, false);
    assert.equal(resumed.status, "in_progress");
    assert.deepEqual((await getAgentRun(scope, r.id)).events.map(e => e.type), ["run_created", "run_paused", "run_resumed"]);
  });

  it("paginates more than 100 events without advancing past undelivered events", async t => {
    if (!available) return t.skip("PostgreSQL required");
    let { run: r } = await run();
    for (let i = 0; i < 104; i++) {
      await appendUserMessage(scope, r.id, { messageId: `page-${i}`, text: `Message ${i}`, expectedVersion: r.version });
      r = (await run()).run;
    }
    const first = await getAgentRun(scope, r.id);
    assert.equal(first.events.length, 100); assert.equal(first.nextSequence, 100); assert.equal(first.lastSequence, 105); assert.equal(first.hasMoreEvents, true);
    const second = await getAgentRun(scope, r.id, first.nextSequence);
    assert.deepEqual(second.events.map(e => e.sequence), [101, 102, 103, 104, 105]); assert.equal(second.hasMoreEvents, false);
    assert.equal(first.messages.length, 50);
  });

  it("exercises real route authentication, validation, snapshots, and own-user profiles", async t => {
    if (!available) return t.skip("PostgreSQL required");
    const created = await createRunRoute(request({ kind: "onboarding", workspaceId }));
    assert.equal(created.status, 201); const body = await created.json();
    assert.equal((await createRunRoute(request({ kind: "onboarding", workspaceId }))).status, 200);
    assert.equal((await createRunRoute(request({ kind: "onboarding", workspaceId, status: "completed" }))).status, 400);
    const params = { params: Promise.resolve({ runId: body.run.id }) };
    assert.equal((await getRunRoute(new Request("http://localhost?afterSequence=0"), params)).status, 200);
    assert.equal((await getRunRoute(new Request("http://localhost?afterSequence=-1"), params)).status, 400);
    const profile = await profileRoute(request({ category: "GROWTH_MARKETER", context: "Reporting" })); assert.equal(profile.status, 200);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: userId } })).workCategory, "GROWTH_MARKETER");
    assert.equal((await profileRoute(request({ category: "OTHER", userId: peerId }))).status, 400);
    await saveWorkProfile(userId, { category: null }); assert.ok((await db.user.findUniqueOrThrow({ where: { id: userId } })).workProfileAnsweredAt);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: peerId } })).workProfileAnsweredAt, null);
    setAuthSessionOverride(async () => ({ user: { id: peerId }, expires: "2099-01-01T00:00:00.000Z" }));
    assert.equal((await getRunRoute(new Request("http://localhost"), params)).status, 404);
    setAuthSessionOverride(async () => null); assert.equal((await createRunRoute(request({ kind: "onboarding", workspaceId }))).status, 401);
    delete process.env.ENABLE_AGENT_ONBOARDING; assert.equal((await createRunRoute(request({ kind: "onboarding", workspaceId }))).status, 404);
  });

  it("M2 commits concurrent message/reply replay once and requires explicit provider confirmation", async t => {
    if (!available) return t.skip("PostgreSQL required");
    const { run: r } = await run();
    const input = { messageId: "coordinator-1", text: "Connect TikTok Ads and Meta Ads", expectedVersion: r.version };
    const replies = await Promise.all(Array.from({ length: 4 }, () => coordinateMessage(scope, r.id, input)));
    assert.equal(new Set(replies.map(result => result.reply?.id)).size, 1);
    let snapshot = await getAgentRun(scope, r.id);
    assert.equal(snapshot.messages.length, 2); assert.equal(snapshot.tasks.length, 0);
    assert.deepEqual(snapshot.events.map(e => e.sequence), [1, 2, 3]);
    const providerIds = ["tiktok_business", "meta_ads"];
    const tasks = await selectProviders(scope, r.id, { providerIds, expectedVersion: snapshot.run.version });
    assert.equal(tasks.length, 2);
    assert.equal((await selectProviders(scope, r.id, { providerIds, expectedVersion: 1 })).length, 2);
    await assert.rejects(() => coordinateMessage(scope, r.id, { ...input, text: "Different request" }), domainError("idempotency_conflict"));
    await assert.rejects(() => selectProviders(scope, r.id, { providerIds: ["shopee"], expectedVersion: 1 }), domainError("stale_version"));
    snapshot = await getAgentRun(scope, r.id);
    assert.deepEqual(snapshot.events.map(e => e.sequence), [1, 2, 3, 4, 5]);
    assert.equal(await db.warehouseImportJob.count({ where: { workspaceId } }), 0);
  });

  it("M2 rejects unavailable selection atomically and rechecks viewer and initiator access", async t => {
    if (!available) return t.skip("PostgreSQL required");
    const { run: r } = await run();
    await db.workspaceProviderAccess.update({ where: { workspaceId_provider: { workspaceId, provider: "shopee" } }, data: { enabled: false } });
    await assert.rejects(() => selectProviders(scope, r.id, { providerIds: ["tiktok_business", "shopee"], expectedVersion: r.version }), domainError("provider_not_enabled"));
    assert.equal((await getAgentRun(scope, r.id)).tasks.length, 0);
    await assert.rejects(() => coordinateMessage({ userId: peerId, workspaceId }, r.id, { messageId: "peer", text: "Meta", expectedVersion: r.version }), domainError("run_not_found"));
    const { run: v } = await createOrResumeOnboardingRun(viewerId, { kind: "onboarding", workspaceId });
    await db.workspaceMember.updateMany({ where: { workspaceId, userId: viewerId }, data: { role: "viewer" } });
    await assert.rejects(() => coordinateMessage({ userId: viewerId, workspaceId }, v.id, { messageId: "viewer", text: "Meta", expectedVersion: v.version }), domainError("insufficient_role"));
    await assert.rejects(() => selectProviders({ userId: viewerId, workspaceId }, v.id, { providerIds: ["meta_ads"], expectedVersion: v.version }), domainError("insufficient_role"));
  });

  it("action routes preserve task history and reject unsupported execution commands", async t => {
    if (!available) return t.skip("PostgreSQL required");
    const { run: r } = await run();
    const params = { params: Promise.resolve({ runId: r.id }) };
    assert.equal((await messagesRoute(request({ messageId: "route-message", text: "TikTok", expectedVersion: r.version }), params)).status, 200);
    const snapshot = await getAgentRun(scope, r.id);
    const response = await providersRoute(request({ providerIds: ["tiktok_business"], expectedVersion: snapshot.run.version }), params);
    assert.equal(response.status, 200);
    const task = (await response.json()).tasks[0];
    const taskParams = { params: Promise.resolve({ taskId: task.id }) };
    const deferred = await taskActionRoute(request({ action: "defer", expectedVersion: task.version }), taskParams);
    assert.equal(deferred.status, 200);
    const deferredTask = await deferred.json(); assert.equal(deferredTask.state, "deferred");
    assert.equal((await taskActionRoute(request({ action: "defer", expectedVersion: task.version }), taskParams)).status, 409);
    const restored = await taskActionRoute(request({ action: "reconnect", expectedVersion: deferredTask.version }), taskParams);
    assert.equal((await restored.json()).state, "waiting_authorization");
    assert.equal((await taskActionRoute(request({ action: "retry", expectedVersion: 2 }), taskParams)).status, 400);
    setAuthSessionOverride(async () => ({ user: { id: peerId }, expires: "2099-01-01T00:00:00.000Z" }));
    assert.equal((await taskActionRoute(request({ action: "defer", expectedVersion: 2 }), taskParams)).status, 404);
    delete process.env.ENABLE_AGENT_ONBOARDING;
    assert.equal((await messagesRoute(request({}), params)).status, 404);
    assert.equal((await providersRoute(request({}), params)).status, 404);
  });

  it("M2 first-time entry excludes answered profiles, existing runs, viewers and foreign workspaces", async t => {
    if (!available) return t.skip("PostgreSQL required");
    await db.user.update({ where: { id: userId }, data: { workProfileAnsweredAt: null } });
    assert.equal((await onboardingEntry(scope)).requiresSetup, true);
    await assert.rejects(() => onboardingEntry({ userId: peerId, workspaceId: otherWorkspaceId }), domainError("access_denied"));
    await db.workspaceMember.updateMany({ where: { workspaceId, userId: viewerId }, data: { role: "viewer" } });
    assert.equal((await onboardingEntry({ userId: viewerId, workspaceId })).requiresSetup, false);
    await saveWorkProfile(userId, { category: null });
    assert.equal((await onboardingEntry(scope)).requiresSetup, false);
    await db.user.update({ where: { id: userId }, data: { workProfileAnsweredAt: null } });
    await run();
    assert.equal((await onboardingEntry(scope)).requiresSetup, false);
  });
});
