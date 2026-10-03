import { agentUserId, agentJson, agentErrorResponse } from "@/lib/agent/http";
import { ownedRunScope } from "@/lib/agent/route-scope";
import { getOnboardingHandoff, prepareOnboardingMonitoringDraft } from "@/lib/agent/onboarding-handoff";
import { AgentConsoleError } from "@/lib/agent-console/persistence";
import { consoleErrorResponse } from "@/lib/agent-console/http";
async function context(params: Promise<{ runId: string }>) {
  const userId = await agentUserId();
  const { runId } = await params;
  return { runId, scope: await ownedRunScope(userId, runId) };
}
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId, scope } = await context(params);
    return Response.json(await getOnboardingHandoff(scope, runId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return error instanceof AgentConsoleError ? consoleErrorResponse(error) : agentErrorResponse(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId, scope } = await context(params);
    return Response.json(await prepareOnboardingMonitoringDraft(scope, runId, await agentJson(request)));
  } catch (error) { return error instanceof AgentConsoleError ? consoleErrorResponse(error) : agentErrorResponse(error); }
}
