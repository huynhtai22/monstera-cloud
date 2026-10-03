import { dispatchAgentImport } from "@/lib/agent/dispatch";
import prisma from "@/lib/prisma";
import { AgentError } from "@/lib/agent/contracts";
import { confirmTaskScopeAndEnqueueImport } from "@/lib/agent/execution";
import { ownedRunScope } from "@/lib/agent/route-scope";
import { agentErrorResponse, agentJson, agentUserId } from "@/lib/agent/http";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const userId = await agentUserId();
    const { taskId } = await params;
    const task = await prisma.agentTask.findFirst({
      where: { id: taskId, run: { initiatorUserId: userId } },
      select: { runId: true },
    });
    if (!task) throw new AgentError("task_not_found", "Task not found", 404);
    const scope = await ownedRunScope(userId, task.runId);
    const body = await agentJson(request);

    const updatedTask = await confirmTaskScopeAndEnqueueImport(scope, taskId, body);
    dispatchAgentImport(updatedTask.importJobId);
    return Response.json(updatedTask);
  } catch (error) {
    return agentErrorResponse(error);
  }
}
