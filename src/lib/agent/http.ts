import { ZodError } from "zod";
import { getAuthSession } from "@/lib/auth-session";
import { AgentError } from "./contracts";
import prisma from "@/lib/prisma";
import { isAgentWorkspaceEnabled } from "./rollout";

export async function agentUserId(): Promise<string> {
  if (process.env.ENABLE_AGENT_ONBOARDING !== "1") throw new AgentError("not_found", "Not found", 404);
  const session = await getAuthSession();
  if (!session?.user?.id) throw new AgentError("unauthorized", "Sign in to continue", 401);
  if (process.env.NODE_ENV === "production" || process.env.AGENT_ONBOARDING_WORKSPACE_IDS?.trim()) {
    const memberships = await prisma.workspaceMember.findMany({ where: { userId: session.user.id }, select: { workspaceId: true } });
    if (!memberships.some(({ workspaceId }) => isAgentWorkspaceEnabled(workspaceId))) throw new AgentError("not_found", "Not found", 404);
  }
  return session.user.id;
}

export async function agentJson(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new AgentError("invalid_json", "Invalid JSON body", 400); }
}

export function agentErrorResponse(error: unknown): Response {
  if (error instanceof AgentError) {
    return Response.json({ code: error.code, message: error.message, retryable: error.code === "stale_version", currentVersion: error.currentVersion }, { status: error.status });
  }
  if (error instanceof ZodError) return Response.json({ code: "invalid_input", message: "Invalid request input", retryable: false }, { status: 400 });
  // Never send Prisma/provider details or request content to the caller.
  return Response.json({ code: "internal_error", message: "Unable to complete this action", retryable: true }, { status: 500 });
}
