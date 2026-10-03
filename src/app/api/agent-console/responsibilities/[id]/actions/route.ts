import { consoleUserId, consoleJson, consoleErrorResponse } from "@/lib/agent-console/http";
import { handleResponsibilityAction } from "@/lib/agent-console/responsibilities";

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params;
    const userId = await consoleUserId();
    const body = await consoleJson(request);
    const result = await handleResponsibilityAction(userId, params.id, body);
    return Response.json(result, { status: 200 });
  } catch (error) {
    return consoleErrorResponse(error);
  }
}
