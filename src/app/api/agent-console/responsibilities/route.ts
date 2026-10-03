import { consoleUserId, consoleJson, consoleErrorResponse } from "@/lib/agent-console/http";
import {
  createResponsibilityDraft,
  listResponsibilities,
} from "@/lib/agent-console/responsibilities";

export async function POST(request: Request) {
  try {
    const userId = await consoleUserId();
    const body = await consoleJson(request);
    const result = await createResponsibilityDraft(userId, body);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return consoleErrorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const userId = await consoleUserId();
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") ?? "";
    const clientId = url.searchParams.get("clientId") || null;
    const result = await listResponsibilities(userId, { workspaceId, clientId });
    return Response.json(result, { status: 200 });
  } catch (error) {
    return consoleErrorResponse(error);
  }
}
