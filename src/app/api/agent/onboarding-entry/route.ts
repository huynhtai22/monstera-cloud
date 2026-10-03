import { onboardingEntry } from "@/lib/agent/entry";
import { agentErrorResponse, agentUserId } from "@/lib/agent/http";

export async function GET(request: Request) {
  try {
    const userId = await agentUserId();
    return Response.json(await onboardingEntry({ userId, workspaceId: new URL(request.url).searchParams.get("workspaceId") ?? "" }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return agentErrorResponse(error); }
}
