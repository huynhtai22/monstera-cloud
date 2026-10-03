import prisma from "@/lib/prisma";
import { AgentError } from "@/lib/agent/contracts";
import { getAgentRun } from "@/lib/agent/runs";
import { agentErrorResponse, agentUserId } from "@/lib/agent/http";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const userId = await agentUserId();
    const { runId } = await params;
    // Resolve only an owned run's workspace before scoped service authorization.
    const run = await prisma.agentRun.findFirst({ where: { id: runId, initiatorUserId: userId }, select: { workspaceId: true } });
    if (!run) throw new AgentError("run_not_found", "Run not found", 404);
    const rawCursor = new URL(request.url).searchParams.get("afterSequence");
    if (rawCursor !== null && !/^\d+$/.test(rawCursor)) throw new AgentError("invalid_cursor", "Invalid event cursor", 400);
    const { reconcileRunImports } = await import("@/lib/agent/execution");
    await reconcileRunImports({ userId, workspaceId: run.workspaceId }, runId);
    const snapshot = await getAgentRun({ userId, workspaceId: run.workspaceId }, runId, rawCursor === null ? 0 : Number(rawCursor));
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return agentErrorResponse(error); }
}
