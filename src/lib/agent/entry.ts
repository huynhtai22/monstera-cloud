import { AgentError } from "./contracts";
import type { AgentScope } from "./contracts";
import { agentTransaction } from "./events";
import { authorizeAgentScope } from "./scope";

export async function onboardingEntry(scope: AgentScope) {
  if (!scope.workspaceId || scope.workspaceId.length > 200) throw new AgentError("invalid_input", "Select a workspace", 400);
  return agentTransaction(async tx => {
    await authorizeAgentScope(tx, scope);
    const [membership, profile, run, rows] = await Promise.all([
      tx.workspaceMember.findFirst({ where: scope, select: { role: true } }),
      tx.user.findUniqueOrThrow({ where: { id: scope.userId }, select: { workProfileAnsweredAt: true } }),
      tx.agentRun.findFirst({ where: { workspaceId: scope.workspaceId, initiatorUserId: scope.userId, resumeKey: `onboarding:${scope.userId}` }, select: { id: true } }),
      tx.campaignMetric.findFirst({ where: { workspaceId: scope.workspaceId }, select: { id: true } }),
    ]);
    // Answering/skipping the work profile is an explicit entry decision.
    // Never pull an activated workspace or an operator's paused run into setup.
    return { requiresSetup: membership?.role !== "viewer" && !profile.workProfileAnsweredAt && !run && !rows };
  });
}
