import prisma from "@/lib/prisma";
import { AgentError } from "@/lib/agent/contracts";
import { getTaskDataPreview } from "@/lib/agent/execution";
import { ownedRunScope } from "@/lib/agent/route-scope";
import { agentErrorResponse, agentUserId } from "@/lib/agent/http";

export async function GET(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const userId = await agentUserId();
    const { taskId } = await params;
    const task = await prisma.agentTask.findFirst({
      where: { id: taskId, run: { initiatorUserId: userId } },
      select: { runId: true },
    });
    if (!task) throw new AgentError("task_not_found", "Task not found", 404);
    const scope = await ownedRunScope(userId, task.runId);

    const preview = await getTaskDataPreview(scope, taskId);
    return Response.json(preview);
  } catch (error) {
    return agentErrorResponse(error);
  }
}
