import type { AgentTaskState } from "@prisma/client";
import { z } from "zod";
import { AgentError, ProviderSchema, VersionSchema } from "./contracts";
import type { AgentScope } from "./contracts";
import { agentTransaction, appendAgentEvent } from "./events";
import { assertRunWritable, requireAgentRun } from "./scope";

export const TASK_TRANSITIONS: Readonly<Record<AgentTaskState, readonly AgentTaskState[]>> = {
  waiting_authorization: ["discovering_accounts", "needs_attention", "deferred"],
  discovering_accounts: ["waiting_selection", "needs_attention"],
  waiting_selection: ["queued", "needs_attention", "deferred"],
  queued: ["importing", "needs_attention"],
  importing: ["verifying", "needs_attention"],
  verifying: ["ready", "needs_attention"],
  ready: [],
  needs_attention: ["waiting_authorization", "discovering_accounts", "waiting_selection", "queued", "deferred"],
  deferred: ["waiting_authorization"],
};

const PreparationTransitionSchema = z.object({
  expectedVersion: VersionSchema,
  state: z.enum(["waiting_authorization", "discovering_accounts", "waiting_selection", "queued", "importing", "verifying", "ready", "needs_attention", "deferred"]),
  reasonCode: z.enum(["authorization_denied", "authorization_expired", "no_accounts", "reconnect_required", "discovery_failed"]).optional(),
}).strict();

export function assertTaskTransition(from: AgentTaskState, to: AgentTaskState) {
  if (!TASK_TRANSITIONS[from]?.includes(to)) throw new AgentError("invalid_transition", `Cannot move task from ${from} to ${to}`);
}

export async function createProviderTask(scope: AgentScope, runId: string, providerInput: unknown, expectedVersion: number) {
  const provider = ProviderSchema.parse(providerInput);
  VersionSchema.parse(expectedVersion);
  return agentTransaction(async tx => {
    const run = await requireAgentRun(tx, scope, runId, true);
    const taskKey = `connect:${provider}`;
    const existing = await tx.agentTask.findFirst({ where: { workspaceId: scope.workspaceId, runId, taskKey } });
    if (existing) return existing;
    assertRunWritable(run.status);
    if (run.version !== expectedVersion) throw new AgentError("stale_version", "Run changed", 409, run.version);
    if (await tx.agentTask.count({ where: { workspaceId: scope.workspaceId, runId } }) >= 4) throw new AgentError("task_limit", "Choose up to four providers");
    const task = await tx.agentTask.create({ data: { workspaceId: scope.workspaceId, runId, taskKey, provider } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId, taskId: task.id, type: "task_created", payload: { provider } });
    return task;
  });
}

/** Preparation/recovery only: execution evidence is wired in milestone 3. */
export async function transitionAgentTask(scope: AgentScope, taskId: string, input: {
  expectedVersion: number; state: AgentTaskState; reasonCode?: "authorization_denied" | "authorization_expired" | "no_accounts" | "reconnect_required" | "discovery_failed";
}) {
  input = PreparationTransitionSchema.parse(input);
  return agentTransaction(async tx => {
    const task = await tx.agentTask.findFirst({ where: { id: taskId, workspaceId: scope.workspaceId } });
    if (!task) throw new AgentError("task_not_found", "Task not found", 404);
    const run = await requireAgentRun(tx, scope, task.runId, true);
    assertRunWritable(run.status);
    if (task.version !== input.expectedVersion) throw new AgentError("stale_version", "Task changed", 409, task.version);
    assertTaskTransition(task.state, input.state);
    if (["queued", "importing", "verifying", "ready"].includes(input.state)) {
      throw new AgentError("execution_not_available", "Import execution and verification are not wired yet");
    }
    if (input.state === "needs_attention" && !input.reasonCode) throw new AgentError("reason_required", "An attention state requires a reason", 400);
    if (["discovering_accounts", "waiting_selection"].includes(input.state) && !await tx.agentTaskConnection.count({ where: { workspaceId: scope.workspaceId, taskId } })) {
      throw new AgentError("connection_required", "Authorize a connection before discovering accounts");
    }
    const updated = await tx.agentTask.update({
      where: { workspaceId_id: { workspaceId: scope.workspaceId, id: taskId } },
      data: { state: input.state, reasonCode: input.state === "needs_attention" ? input.reasonCode : null, version: { increment: 1 } },
    });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId: task.runId, taskId, type: "task_transitioned", payload: { from: task.state, to: input.state, reasonCode: updated.reasonCode } });
    return updated;
  });
}

/** Used by a future validated callback or explicit existing-connection reuse. */
export async function attachTaskConnections(scope: AgentScope, taskId: string, connectionIds: string[], expectedVersion: number) {
  const ids = z.array(z.string().min(1).max(200)).min(1).max(100).parse(connectionIds);
  VersionSchema.parse(expectedVersion);
  const uniqueIds = [...new Set(ids)].sort();
  return agentTransaction(async tx => {
    const task = await tx.agentTask.findFirst({ where: { id: taskId, workspaceId: scope.workspaceId } });
    if (!task) throw new AgentError("task_not_found", "Task not found", 404);
    const run = await requireAgentRun(tx, scope, task.runId, true);
    const connections = await tx.connection.findMany({
      where: { workspaceId: scope.workspaceId, id: { in: uniqueIds }, provider: task.provider, type: "source", status: "connected" },
      select: { id: true },
    });
    if (connections.length !== uniqueIds.length) throw new AgentError("connection_not_available", "Use authorized source connections for this provider", 404);
    const existing = await tx.agentTaskConnection.findMany({ where: { workspaceId: scope.workspaceId, taskId }, select: { connectionId: true } });
    const sameConnections = existing.length === uniqueIds.length && existing.every(link => uniqueIds.includes(link.connectionId));
    if (sameConnections && task.state !== "waiting_authorization") return task;
    assertRunWritable(run.status);
    if (task.version !== expectedVersion) throw new AgentError("stale_version", "Task changed", 409, task.version);
    if (task.state !== "waiting_authorization") throw new AgentError("invalid_transition", "Connections can only be bound while awaiting authorization");
    if (existing.length && !sameConnections) throw new AgentError("connection_scope_conflict", "Existing task connection scope cannot be replaced implicitly");
    if (!sameConnections) await tx.agentTaskConnection.createMany({ data: uniqueIds.map(connectionId => ({ workspaceId: scope.workspaceId, taskId, connectionId })) });
    const updated = await tx.agentTask.update({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: taskId } }, data: { state: "discovering_accounts", version: { increment: 1 } } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId: run.id, taskId, type: "connections_linked", payload: { connectionIds: uniqueIds, from: task.state, to: updated.state } });
    return updated;
  });
}
