import { consoleUserId, consoleErrorResponse } from "@/lib/agent-console/http";
import { getCaseDetail } from "@/lib/agent-console/cases";

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params;
    const userId = await consoleUserId();
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") ?? "";

    const result = await getCaseDetail(userId, workspaceId, params.id);
    return Response.json(result, { status: 200 });
  } catch (error) {
    return consoleErrorResponse(error);
  }
}
