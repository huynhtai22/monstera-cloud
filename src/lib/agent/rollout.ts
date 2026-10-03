import { AgentError } from "./contracts";

/** Production pilot access is explicit; an empty cohort never enables every tenant. */
export function isAgentWorkspaceEnabled(workspaceId: string): boolean {
  if (process.env.ENABLE_AGENT_ONBOARDING !== "1") return false;
  const cohort = (process.env.AGENT_ONBOARDING_WORKSPACE_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);
  if (cohort.length) return cohort.includes(workspaceId);
  return process.env.NODE_ENV !== "production";
}

export function assertAgentWorkspaceEnabled(workspaceId: string) {
  if (!isAgentWorkspaceEnabled(workspaceId)) throw new AgentError("not_found", "Not found", 404);
}
