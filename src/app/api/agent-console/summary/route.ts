import { consoleUserId, consoleErrorResponse } from "@/lib/agent-console/http";
import { getAgentConsoleOperationalSummary } from "@/lib/agent-console/console-summary";

export async function GET(request: Request) {
  try {
    const userId = await consoleUserId();
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    if (!workspaceId) {
      return Response.json({ error: "workspaceId is required" }, { status: 400 });
    }
    const summary = await getAgentConsoleOperationalSummary(workspaceId, userId);
    return Response.json(summary, { status: 200 });
  } catch (error) {
    return consoleErrorResponse(error);
  }
}
