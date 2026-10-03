import { createHash } from "node:crypto";
import { z } from "zod";
import { AgentError, VersionSchema, type AgentScope } from "./contracts";
import { agentTransaction } from "./events";
import { requireAgentRun, type AgentTransaction } from "./scope";
import { ConfirmedScopeSchema, scopeTargets } from "./execution-contracts";
import { getTaskDataPreviewInTransaction } from "./execution";
import { savedRunGoal } from "./saved-goal";
import { createResponsibilityDraftInTransaction } from "@/lib/agent-console/responsibilities";

export async function readOnboardingHandoff(tx: AgentTransaction, scope: AgentScope, runId: string) {
  const run = await requireAgentRun(tx, scope, runId);
  if (run.kind !== "onboarding") throw new AgentError("run_not_found", "Onboarding setup not found", 404);
  const goal = await savedRunGoal(tx, scope.workspaceId, runId);
  const tasks = await tx.agentTask.findMany({ where: { workspaceId: scope.workspaceId, runId }, orderBy: { id: "asc" } });
  const blockers: string[] = [];
  if (run.status !== "completed") blockers.push("Review and finish your setup before preparing ongoing checks.");
  const sources = [];
  const scopeItems: Array<{ connectionId: string; provider: string; providerAccountId: string }> = [];
  for (const task of tasks.filter(item => item.state !== "deferred")) {
    const parsed = ConfirmedScopeSchema.safeParse(task.confirmedScope);
    if (task.state !== "ready" || !parsed.success || task.provider !== parsed.data.provider || !(task.result as { verified?: boolean } | null)?.verified) {
      blockers.push(`${task.provider}: the approved import still needs verification.`);
      continue;
    }
    if (!["meta_ads", "google_ads", "tiktok_business"].includes(task.provider)) {
      blockers.push(`${task.provider}: ongoing account checks are not available yet.`);
      continue;
    }
    const job = task.importJobId ? await tx.warehouseImportJob.findFirst({ where: { id: task.importJobId, workspaceId: scope.workspaceId } }) : null;
    if (!job || job.status !== "completed") {
      blockers.push(`${task.provider}: the recorded import is incomplete. Review its outcome before preparing checks.`);
      continue;
    }
    const data = await getTaskDataPreviewInTransaction(tx, scope, task.id);
    if (!data.verified || data.rowsCount === 0 || data.accounts.some(account => account.totalRows === 0)) {
      blockers.push(`${task.provider}: data is unavailable for one or more confirmed accounts. Review the warehouse first.`);
      continue;
    }
    const confirmed = parsed.data;
    sources.push({ provider: task.provider, taskId: task.id, scopeRevision: task.scopeRevision, window: data.window,
      accounts: data.accounts.length, rows: data.rowsCount, spend: data.aggregates.totalSpend, currency: data.aggregates.currency, limitations: data.coverage.limitations });
    for (const target of scopeTargets(confirmed)) scopeItems.push({ provider: task.provider, connectionId: target.connectionId, providerAccountId: target.accountId });
  }
  if (!sources.length && !blockers.length) blockers.push("No reviewed source data is available for this setup.");
  const uniqueScope = [...new Map(scopeItems.map(item => [JSON.stringify(item), item])).values()];
  return { runId, workspaceId: run.workspaceId, clientId: run.clientId, version: run.version, goal, sources,
    scopeItems: uniqueScope, blockers, canPrepareDraft: process.env.ENABLE_AGENT_CONSOLE === "1" && blockers.length === 0 && uniqueScope.length > 0 };
}

export async function getOnboardingHandoff(scope: AgentScope, runId: string) {
  return agentTransaction(tx => readOnboardingHandoff(tx, scope, runId));
}

const Schema = z.object({ expectedVersion: VersionSchema }).strict();
export async function prepareOnboardingMonitoringDraft(scope: AgentScope, runId: string, raw: unknown) {
  const input = Schema.parse(raw);
  return agentTransaction(async tx => {
    await requireAgentRun(tx, scope, runId, true);
    const handoff = await readOnboardingHandoff(tx, scope, runId);
    if (handoff.version !== input.expectedVersion) throw new AgentError("stale_version", "Setup changed. Refresh before preparing checks.", 409, handoff.version);
    if (!handoff.canPrepareDraft) throw new AgentError("handoff_blocked", handoff.blockers[0] ?? "Ongoing setup is unavailable in this workspace.", 409);
    // A stable identity makes duplicate clicks/reloads reuse one draft; no authorization is created.
    const hash = createHash("sha256").update(JSON.stringify({ runId, goal: handoff.goal, sources: handoff.sources.map(s => ({ taskId: s.taskId, scopeRevision: s.scopeRevision })) })).digest("hex");
    const draftRequestId = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
    const result = await createResponsibilityDraftInTransaction(tx, scope.userId, {
      workspaceId: scope.workspaceId, clientId: handoff.clientId, kind: "data_health", draftRequestId, cadence: "daily", timezone: "UTC",
      configuration: { recoveryPolicy: "retry_failed_window", permittedRecoveryModes: ["retry_failed_window"],
        onboardingRunId: runId, onboardingGoal: handoff.goal, onboardingSources: handoff.sources.map(s => ({ taskId: s.taskId, scopeRevision: s.scopeRevision, window: s.window })) },
      scopeItems: handoff.scopeItems,
    });
    return { responsibilityId: result.responsibility.id, workspaceId: scope.workspaceId, status: result.responsibility.status };
  });
}
