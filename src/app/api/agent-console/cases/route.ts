import { consoleUserId, consoleErrorResponse } from "@/lib/agent-console/http";
import { listCases } from "@/lib/agent-console/cases";

export async function GET(request: Request) {
  try {
    const userId = await consoleUserId();
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") ?? "";
    const clientId = url.searchParams.get("clientId") || null;
    const state = url.searchParams.get("state") || undefined;
    const cursor = url.searchParams.get("cursor") || undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 20;

    const result = await listCases(userId, {
      workspaceId,
      clientId,
      state,
      cursor,
      limit,
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    return consoleErrorResponse(error);
  }
}
