import { selectProviders } from "@/lib/agent/tools";
import { getAgentRun } from "@/lib/agent/runs";
import { ownedRunScope } from "@/lib/agent/route-scope";
import { agentErrorResponse, agentJson, agentUserId } from "@/lib/agent/http";

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = await agentUserId();
    const { runId } = await params;
    const scope = await ownedRunScope(userId, runId);
    await selectProviders(scope, runId, await agentJson(request));
    return Response.json(await getAgentRun(scope, runId));
  } catch (error) { return agentErrorResponse(error); }
}
