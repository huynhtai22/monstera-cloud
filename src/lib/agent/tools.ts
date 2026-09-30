import { z } from "zod";
import { isConnectEnabled } from "@/lib/integration-flags";
import { AgentError, ProviderSchema, VersionSchema } from "./contracts";
import type { AgentScope } from "./contracts";
import { agentTransaction, appendAgentEvent } from "./events";
import { assertRunWritable, requireAgentRun } from "./scope";
import type { AgentTransaction } from "./scope";

// Only these tools may be proposed by the coordinator. No authorization,
// credentials, imports or arbitrary URLs are exposed to interpretation.
export const ProposalSchema = z.object({ tool: z.literal("select_providers"), providerIds: z.array(ProviderSchema).min(1).max(4) }).strict();
export const SelectProvidersSchema = z.object({ providerIds: z.array(ProviderSchema).min(1).max(4), expectedVersion: VersionSchema }).strict();

export async function eligibleProviders(tx: AgentTransaction, workspaceId: string) {
  const access = await tx.workspaceProviderAccess.findMany({ where: { workspaceId, enabled: true }, select: { provider: true } });
  return access.map(row => row.provider).filter(id => ProviderSchema.safeParse(id).success && isConnectEnabled(id));
}

export async function selectProviders(scope: AgentScope, runId: string, input: unknown) {
  const parsed = SelectProvidersSchema.parse(input);
  return agentTransaction(async tx => {
    const run = await requireAgentRun(tx, scope, runId, true);
    const ids = [...new Set(parsed.providerIds)];
    const allowed = await eligibleProviders(tx, scope.workspaceId);
    if (ids.some(id => !allowed.includes(id))) throw new AgentError("provider_not_enabled", "A selected source is not available for this workspace", 403);
    const existing = await tx.agentTask.findMany({ where: { workspaceId: scope.workspaceId, runId } });
    const missing = ids.filter(id => !existing.some(task => task.provider === id));
    if (!missing.length) return existing.filter(task => ids.includes(task.provider as typeof ids[number]));
    assertRunWritable(run.status);
    if (run.version !== parsed.expectedVersion) throw new AgentError("stale_version", "Setup changed; refresh before retrying", 409, run.version);
    if (existing.length + missing.length > 4) throw new AgentError("task_limit", "Choose up to four sources");
    const created = [];
    for (const provider of missing) {
      const task = await tx.agentTask.create({ data: { workspaceId: scope.workspaceId, runId, taskKey: `connect:${provider}`, provider } });
      await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId, taskId: task.id, type: "task_created", payload: { provider } });
      created.push(task);
    }
    return [...existing, ...created].filter(task => ids.includes(task.provider as typeof ids[number]));
  });
}
