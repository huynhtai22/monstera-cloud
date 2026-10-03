import { z } from "zod";
import { ONBOARDING_GOALS } from "./onboarding-goals";
import { AgentError, VersionSchema } from "./contracts";
import type { AgentScope } from "./contracts";
import { agentTransaction, appendAgentEvent } from "./events";
import { requireAgentRun, assertRunWritable, type AgentTransaction } from "./scope";

export async function savedRunGoal(tx: AgentTransaction, workspaceId: string, runId: string) {
  const event = await tx.agentRunEvent.findFirst({ where: { workspaceId, runId, type: { in: ["run_created", "onboarding_goal_selected"] } }, orderBy: { sequence: "desc" } });
  const id = (event?.payload as { goalId?: unknown } | undefined)?.goalId;
  const goal = ONBOARDING_GOALS.find(item => item.id === id);
  return goal ? { id: goal.id, context: goal.context } : null;
}

const Schema = z.object({ expectedVersion: VersionSchema, goalId: z.enum(["performance", "reporting", "spend"]).nullable() }).strict();
export async function saveRunGoal(scope: AgentScope, runId: string, raw: unknown) {
  const input = Schema.parse(raw);
  return agentTransaction(async tx => {
    const run = await requireAgentRun(tx, scope, runId, true);
    assertRunWritable(run.status);
    if (run.version !== input.expectedVersion) throw new AgentError("stale_version", "Setup changed. Refresh before choosing a goal.", 409, run.version);
    const goal = ONBOARDING_GOALS.find(item => item.id === input.goalId);
    await tx.user.update({ where: { id: scope.userId }, data: { workContext: goal?.context ?? null } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId, type: "onboarding_goal_selected", payload: { goalId: goal?.id ?? null } });
    return { goal: goal ? { id: goal.id, context: goal.context } : null };
  });
}
