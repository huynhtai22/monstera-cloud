import { consoleUserId, consoleJson, consoleErrorResponse } from "@/lib/agent-console/http";
import { updateDataHealthDraft } from "@/lib/agent-console/responsibilities";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await consoleUserId();
    const { id } = await params;
    return Response.json(await updateDataHealthDraft(userId, id, await consoleJson(request)));
  } catch (error) {
    return consoleErrorResponse(error);
  }
}
