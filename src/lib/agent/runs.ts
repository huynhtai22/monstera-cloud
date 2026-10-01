import prisma from "@/lib/prisma";
import { AgentError, CreateRunSchema, MessageSchema, VersionSchema, WorkProfileSchema } from "./contracts";
import type { AgentScope } from "./contracts";
import { agentTransaction, appendAgentEvent } from "./events";
import { assertRunWritable, authorizeAgentScope, requireAgentRun } from "./scope";

export async function saveWorkProfile(userId: string, input: unknown) {
  const profile = WorkProfileSchema.parse(input);
  return prisma.user.update({
    where: { id: userId },
    data: { workCategory: profile.category, ...(profile.context !== undefined ? { workContext: profile.context || null } : {}), workProfileAnsweredAt: new Date() },
    select: { workCategory: true, workContext: true, workProfileAnsweredAt: true },
  });
}

export async function createOrResumeOnboardingRun(userId: string, input: unknown) {
  const parsed = CreateRunSchema.parse(input);
  const scope = { userId, workspaceId: parsed.workspaceId };
  return agentTransaction(async tx => {
    await authorizeAgentScope(tx, scope, true);
    if (parsed.clientId && !await tx.client.findFirst({ where: { id: parsed.clientId, workspaceId: scope.workspaceId } })) {
      throw new AgentError("client_not_found", "Client not found", 404);
    }
    const resumeKey = `onboarding:${userId}`;
    const existing = await tx.agentRun.findFirst({ where: { workspaceId: scope.workspaceId, initiatorUserId: userId, kind: "onboarding" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    if (existing) {
      if (existing.clientId !== (parsed.clientId ?? null)) {
        throw new AgentError("scope_conflict", "Resume setup with its original client scope", 409, existing.version);
      }
      return { run: existing, created: false };
    }
    const run = await tx.agentRun.create({
      data: { workspaceId: scope.workspaceId, initiatorUserId: userId, clientId: parsed.clientId, kind: "onboarding", resumeKey },
    });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId: run.id, type: "run_created", payload: { kind: "onboarding" } });
    return { run: await tx.agentRun.findUniqueOrThrow({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: run.id } } }), created: true };
  });
}

/** Explicit continuation creates fresh tasks; prior consent and import approval never carry over. */
export async function continueDeferredOnboarding(scope: AgentScope, completedRunId: string, expectedVersion: number) {
  return continueCompletedOnboarding(scope, completedRunId, expectedVersion, true);
}

/** An empty follow-up lets the user choose a source without copying earlier approvals. */
export async function addAnotherOnboardingSource(scope: AgentScope, completedRunId: string, expectedVersion: number) {
  return continueCompletedOnboarding(scope, completedRunId, expectedVersion, false);
}

async function continueCompletedOnboarding(scope: AgentScope, completedRunId: string, expectedVersion: number, copyDeferred: boolean) {
  VersionSchema.parse(expectedVersion);
  return agentTransaction(async tx => {
    const source = await requireAgentRun(tx, scope, completedRunId, true);
    if (source.status !== "completed" || source.kind !== "onboarding") throw new AgentError("run_not_completed", "Finish and review this setup before continuing saved sources");
    const resumeKey = `onboarding:${scope.userId}:after:${source.id}`;
    const existing = await tx.agentRun.findFirst({ where: { workspaceId: scope.workspaceId, resumeKey, initiatorUserId: scope.userId } });
    if (existing) return existing;
    if (source.version !== expectedVersion) throw new AgentError("stale_version", "Setup changed; refresh before continuing", 409, source.version);
    const latest = await tx.agentRun.findFirst({ where: { workspaceId: scope.workspaceId, initiatorUserId: scope.userId, kind: "onboarding" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    if (latest?.id !== source.id) throw new AgentError("continuation_exists", "A newer setup exists. Refresh to continue it.");
    if (source.clientId && !await tx.client.findFirst({ where: { id: source.clientId, workspaceId: scope.workspaceId } })) throw new AgentError("client_not_found", "The original reporting client is unavailable", 404);
    const deferred = copyDeferred ? await tx.agentTask.findMany({ where: { workspaceId: scope.workspaceId, runId: source.id, state: "deferred" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, provider: true } }) : [];
    if (copyDeferred && !deferred.length) throw new AgentError("no_deferred_sources", "There are no saved sources to continue");
    const run = await tx.agentRun.create({ data: { workspaceId: scope.workspaceId, initiatorUserId: scope.userId, kind: "onboarding", clientId: source.clientId, resumeKey, createdAt: new Date(Math.max(Date.now(), source.createdAt.getTime() + 1)) } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId: run.id, type: "run_created", payload: { kind: "onboarding", previousRunId: source.id } });
    for (const task of deferred) {
      const next = await tx.agentTask.create({ data: { workspaceId: scope.workspaceId, runId: run.id, taskKey: `connect:${task.provider}`, provider: task.provider } });
      await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId: run.id, taskId: next.id, type: "task_created", payload: { provider: task.provider, previousTaskId: task.id } });
    }
    return tx.agentRun.findUniqueOrThrow({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: run.id } } });
  });
}

export async function getAgentRun(scope: AgentScope, runId: string, afterSequence = 0) {
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new AgentError("invalid_cursor", "Invalid event cursor", 400);
  return agentTransaction(async tx => {
    const run = await requireAgentRun(tx, scope, runId);
    const tasks = await tx.agentTask.findMany({ where: { workspaceId: scope.workspaceId, runId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { connections: true } });
    const messages = await tx.agentRunMessage.findMany({ where: { workspaceId: scope.workspaceId, runId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 });
    const events = await tx.agentRunEvent.findMany({ where: { workspaceId: scope.workspaceId, runId, sequence: { gt: afterSequence } }, orderBy: { sequence: "asc" }, take: 100 });
    return { run, tasks, messages: messages.reverse(), events,
      lastSequence: run.lastEventSequence,
      nextSequence: events.at(-1)?.sequence ?? afterSequence,
      hasMoreEvents: (events.at(-1)?.sequence ?? afterSequence) < run.lastEventSequence,
    };
  });
}

/** Durable user message only. Interpretation/execution belongs to milestone 2. */
export async function appendUserMessage(scope: AgentScope, runId: string, input: unknown) {
  const parsed = MessageSchema.parse(input);
  return agentTransaction(async tx => {
    const run = await requireAgentRun(tx, scope, runId, true);
    const existing = await tx.agentRunMessage.findFirst({ where: { workspaceId: scope.workspaceId, runId, messageKey: parsed.messageId } });
    if (existing) {
      if (existing.content !== parsed.text || existing.role !== "user") throw new AgentError("idempotency_conflict", "Message identifier was already used for different content");
      return existing;
    }
    assertRunWritable(run.status);
    if (run.version !== parsed.expectedVersion) throw new AgentError("stale_version", "Run changed; refresh before retrying", 409, run.version);
    const message = await tx.agentRunMessage.create({ data: { workspaceId: scope.workspaceId, runId, messageKey: parsed.messageId, role: "user", content: parsed.text } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId, type: "message_added", payload: { messageId: message.id } });
    return message;
  });
}

export async function setAgentRunPaused(scope: AgentScope, runId: string, expectedVersion: number, paused: boolean) {
  VersionSchema.parse(expectedVersion);
  return agentTransaction(async tx => {
    const run = await requireAgentRun(tx, scope, runId, true);
    if (run.version !== expectedVersion) throw new AgentError("stale_version", "Run changed", 409, run.version);
    if (run.status === "completed") throw new AgentError("run_completed", "Completed setup cannot be paused or resumed");
    if ((run.status === "paused") === paused) return run;
    await tx.agentRun.update({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: runId } }, data: { status: paused ? "paused" : "in_progress" } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId, type: paused ? "run_paused" : "run_resumed", payload: {} });
    return tx.agentRun.findUniqueOrThrow({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: runId } } });
  });
}
