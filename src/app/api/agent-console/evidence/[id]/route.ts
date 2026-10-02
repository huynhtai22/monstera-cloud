import { consoleUserId, consoleErrorResponse } from "@/lib/agent-console/http";
import { getEvidenceDetail } from "@/lib/agent-console/evidence";

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params;
    const userId = await consoleUserId();
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") ?? "";

    const result = await getEvidenceDetail(userId, workspaceId, params.id);
    return Response.json(result, { status: 200 });
  } catch (error) {
    return consoleErrorResponse(error);
  }
}
