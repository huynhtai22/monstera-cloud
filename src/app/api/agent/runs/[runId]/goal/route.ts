import { agentUserId, agentJson, agentErrorResponse } from "@/lib/agent/http";
import { ownedRunScope } from "@/lib/agent/route-scope";
import { saveRunGoal } from "@/lib/agent/saved-goal";
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = await agentUserId();
    const { runId } = await params;
    return Response.json(await saveRunGoal(await ownedRunScope(userId, runId), runId, await agentJson(request)));
  } catch (error) { return agentErrorResponse(error); }
}
