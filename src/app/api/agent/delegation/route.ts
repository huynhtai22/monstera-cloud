import { delegationEntry, delegateReportingTask } from "@/lib/agent/delegation";
import { agentErrorResponse, agentJson, agentUserId } from "@/lib/agent/http";

export async function GET(request: Request) {
  try {
    const result = await delegationEntry(
      await agentUserId(),
      new URL(request.url).searchParams.get("workspaceId"),
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const result = await delegateReportingTask(
      await agentUserId(),
      await agentJson(request),
    );
    return Response.json(result, {
      status: result.created ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
