import prisma from "@/lib/prisma";
import { AgentError } from "./contracts";

export async function ownedRunScope(userId: string, runId: string) {
  const run = await prisma.agentRun.findFirst({ where: { id: runId, initiatorUserId: userId }, select: { workspaceId: true } });
  if (!run) throw new AgentError("run_not_found", "Run not found", 404);
  return { userId, workspaceId: run.workspaceId };
}
