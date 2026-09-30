import type prisma from "@/lib/prisma";
import type { AgentScope } from "./contracts";
import { AgentError } from "./contracts";
import { assertAgentWorkspaceEnabled } from "./rollout";

export type AgentTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Always recheck membership inside the transaction executing the action. */
export async function authorizeAgentScope(tx: AgentTransaction, scope: AgentScope, write = false) {
  assertAgentWorkspaceEnabled(scope.workspaceId);
  const membership = await tx.workspaceMember.findFirst({
    where: { userId: scope.userId, workspaceId: scope.workspaceId },
    select: { role: true },
  });
  if (!membership) throw new AgentError("access_denied", "Workspace access required", 403);
  if (write && membership.role === "viewer") {
    throw new AgentError("insufficient_role", "A workspace member must perform this action", 403);
  }
}

export async function requireAgentRun(tx: AgentTransaction, scope: AgentScope, runId: string, write = false) {
  await authorizeAgentScope(tx, scope, write);
  const run = await tx.agentRun.findFirst({
    where: { id: runId, workspaceId: scope.workspaceId, initiatorUserId: scope.userId },
  });
  if (!run) throw new AgentError("run_not_found", "Run not found", 404);
  return run;
}

export function assertRunWritable(status: string) {
  if (status === "completed" || status === "paused") {
    throw new AgentError("run_not_active", "Resume an active run before changing its tasks");
  }
}
