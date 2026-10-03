import { consoleUserId, consoleJson, consoleErrorResponse } from "@/lib/agent-console/http";
import { handleCaseAction } from "@/lib/agent-console/cases";

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params;
    const userId = await consoleUserId();
    const body = await consoleJson(request);
    const result = await handleCaseAction(userId, params.id, body);
    return Response.json(result, { status: 200 });
  } catch (error) {
    console.error("[cases/actions] Failed to execute case action:", error);
    return consoleErrorResponse(error);
  }
}
