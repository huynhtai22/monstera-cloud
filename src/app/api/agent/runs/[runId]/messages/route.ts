import { coordinateMessage } from "@/lib/agent/coordinator";
import { ownedRunScope } from "@/lib/agent/route-scope";
import { agentErrorResponse, agentJson, agentUserId } from "@/lib/agent/http";

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = await agentUserId();
    const { runId } = await params;
    return Response.json(await coordinateMessage(await ownedRunScope(userId, runId), runId, await agentJson(request)));
  } catch (error) { return agentErrorResponse(error); }
}
