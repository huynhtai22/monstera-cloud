import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  assertCiDatabaseReachable,
  assertCiDatabaseReachableWhenMissing,
} from "@/lib/pg-test-discipline";
import { delegateReportingTask, delegationEntry } from "./delegation";
import { AgentError } from "./contracts";
import { createOrResumeOnboardingRun, getAgentRun } from "./runs";

describe("dashboard delegation: durable intent and tenant boundaries", () => {
  const db = new PrismaClient();
  const suffix = randomUUID();
  const owner = `delegate-owner-${suffix}`,
    viewer = `delegate-viewer-${suffix}`,
    peer = `delegate-peer-${suffix}`;
  const workspaceId = `delegate-workspace-${suffix}`,
    other = `delegate-other-${suffix}`,
    clientId = `delegate-client-${suffix}`;
  const oldFlag = process.env.ENABLE_AGENT_ONBOARDING,
    oldCohort = process.env.AGENT_ONBOARDING_WORKSPACE_IDS;
  let available = false;
  const intent = (extras = {}) => ({
    workspaceId,
    goalId: "reporting",
    context: "Review the selected reporting window",
    requestId: randomUUID(),
    ...extras,
  });
  const domain = (code: string) => (error: unknown) =>
    error instanceof AgentError && error.code === code;
  before(async () => {
    assertCiDatabaseReachableWhenMissing();
    if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("mock"))
      return;
    try {
      await db.$queryRaw`SELECT 1`;
      available = true;
    } catch {
      assertCiDatabaseReachable();
      return;
    }
    process.env.ENABLE_AGENT_ONBOARDING = "1";
    process.env.AGENT_ONBOARDING_WORKSPACE_IDS = `${workspaceId},${other}`;
    for (const id of [owner, viewer, peer])
      await db.user.create({ data: { id, email: `${id}@example.test` } });
    for (const id of [workspaceId, other]) {
      await db.workspace.create({
        data: { id, name: "Delegation fixture", slug: id, ownerId: owner },
      });
      await db.workspaceMember.create({
        data: { workspaceId: id, userId: owner, role: "owner" },
      });
    }
    await db.workspaceMember.createMany({
      data: [
        { workspaceId, userId: viewer, role: "viewer" },
        { workspaceId, userId: peer, role: "member" },
      ],
    });
    await db.client.create({
      data: { id: clientId, workspaceId: other, name: "Foreign client" },
    });
  });
  beforeEach(async () => {
    if (available)
      await db.agentRun.deleteMany({
        where: { workspaceId: { in: [workspaceId, other] } },
      });
  });
  after(async () => {
    if (oldFlag === undefined) delete process.env.ENABLE_AGENT_ONBOARDING;
    else process.env.ENABLE_AGENT_ONBOARDING = oldFlag;
    if (oldCohort === undefined)
      delete process.env.AGENT_ONBOARDING_WORKSPACE_IDS;
    else process.env.AGENT_ONBOARDING_WORKSPACE_IDS = oldCohort;
    if (available) {
      await db.agentRun.deleteMany({
        where: { workspaceId: { in: [workspaceId, other] } },
      });
      await db.workspace.deleteMany({
        where: { id: { in: [workspaceId, other] } },
      });
      await db.user.deleteMany({
        where: { id: { in: [owner, viewer, peer] } },
      });
    }
    await db.$disconnect();
    await prisma.$disconnect();
  });
  it("deduplicates concurrent requests and resumes the same saved goal in onboarding", async (t) => {
    if (!available) return t.skip("PostgreSQL required");
    const input = intent();
    const responses = await Promise.all(
      [1, 2, 3].map(() => delegateReportingTask(owner, input)),
    );
    assert.equal(new Set(responses.map((result) => result.runId)).size, 1);
    assert.equal(responses.filter((result) => result.created).length, 1);
    const entry = await delegationEntry(owner, workspaceId);
    assert.equal(entry.runId, responses[0].runId);
    const resumed = await createOrResumeOnboardingRun(owner, {
      kind: "onboarding",
      workspaceId,
    });
    assert.equal(resumed.run.id, entry.runId);
    const snapshot = await getAgentRun(
      { userId: owner, workspaceId },
      resumed.run.id,
    );
    assert.equal(snapshot.run.goal?.id, "reporting");
    assert.equal(snapshot.messages[0].content, input.context);
    assert.equal(
      snapshot.tasks.length,
      0,
      "Recording intent must not start imports or authorize accounts",
    );
    assert.deepEqual(
      snapshot.events.map((event) => event.type),
      ["run_created", "delegation_requested"],
    );
  });
  it("rejects changed replay content and preserves an active or paused run", async (t) => {
    if (!available) return t.skip("PostgreSQL required");
    const input = intent();
    const run = await delegateReportingTask(owner, input);
    await assert.rejects(
      () => delegateReportingTask(owner, { ...input, goalId: "spend" }),
      domain("idempotency_conflict"),
    );
    await assert.rejects(
      () => delegateReportingTask(owner, intent()),
      domain("active_run_exists"),
    );
    await db.agentRun.update({
      where: { id: run.runId },
      data: { status: "paused" },
    });
    await assert.rejects(
      () => delegateReportingTask(owner, intent()),
      domain("active_run_exists"),
    );
    assert.equal((await delegateReportingTask(owner, input)).runId, run.runId);
  });
  it("allows only one active run when distinct requests race", async (t) => {
    if (!available) return t.skip("PostgreSQL required");
    const results = await Promise.allSettled([
      delegateReportingTask(owner, intent()),
      delegateReportingTask(owner, intent({ goalId: "spend" })),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejection = results.find((result) => result.status === "rejected");
    assert.ok(
      rejection?.status === "rejected" &&
        domain("active_run_exists")(rejection.reason),
    );
    assert.equal(await db.agentRun.count({ where: { workspaceId } }), 1);
  });
  it("creates a fresh task after completion without carrying approvals", async (t) => {
    if (!available) return t.skip("PostgreSQL required");
    const first = await delegateReportingTask(owner, intent());
    await db.agentRun.update({
      where: { id: first.runId },
      data: { status: "completed", reviewedAt: new Date() },
    });
    const next = await delegateReportingTask(
      owner,
      intent({ goalId: "spend" }),
    );
    assert.notEqual(next.runId, first.runId);
    assert.equal((await delegationEntry(owner, workspaceId)).runId, next.runId);
    const snapshot = await getAgentRun(
      { userId: owner, workspaceId },
      next.runId,
    );
    assert.equal(snapshot.run.goal?.id, "spend");
    assert.equal(snapshot.tasks.length, 0);
  });
  it("denies foreign scope, viewer writes and peer run disclosure", async (t) => {
    if (!available) return t.skip("PostgreSQL required");
    await assert.rejects(
      () => delegateReportingTask(owner, intent({ clientId })),
      domain("client_not_found"),
    );
    await assert.rejects(
      () => delegateReportingTask(viewer, intent()),
      domain("insufficient_role"),
    );
    await assert.rejects(
      () => delegationEntry(viewer, other),
      domain("access_denied"),
    );
    const run = await delegateReportingTask(owner, intent());
    assert.equal((await delegationEntry(peer, workspaceId)).runId, null);
    assert.equal((await delegationEntry(owner, other)).runId, null);
    await assert.rejects(
      () => getAgentRun({ userId: peer, workspaceId }, run.runId),
      domain("run_not_found"),
    );
  });
  it("keeps rollout fail-closed", async (t) => {
    if (!available) return t.skip("PostgreSQL required");
    process.env.AGENT_ONBOARDING_WORKSPACE_IDS = other;
    try {
      await assert.rejects(
        () => delegateReportingTask(owner, intent()),
        domain("not_found"),
      );
    } finally {
      process.env.AGENT_ONBOARDING_WORKSPACE_IDS = `${workspaceId},${other}`;
    }
  });
});
