import { z } from "zod";
import prisma from "@/lib/prisma";
import { AgentError, VersionSchema } from "@/lib/agent/contracts";
import { transitionAgentTask } from "@/lib/agent/tasks";
import { discoverTaskAccounts, reuseTaskConnection, reopenTaskImportChoice, restoreDeferredImport, retryFailedTaskAccounts } from "@/lib/agent/execution";
import { dispatchAgentImport } from "@/lib/agent/dispatch";
import { ownedRunScope } from "@/lib/agent/route-scope";
import { agentErrorResponse, agentJson, agentUserId } from "@/lib/agent/http";

const Schema = z.object({ expectedVersion: VersionSchema, action: z.enum(["defer", "reconnect", "discover", "reuse", "change_scope", "retry_failed"]), connectionId: z.string().min(1).max(200).optional(), connectionIds: z.array(z.string().min(1).max(200)).min(1).max(100).optional() }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const userId = await agentUserId();
    const { taskId } = await params;
    const task = await prisma.agentTask.findFirst({ where: { id: taskId, run: { initiatorUserId: userId } }, select: { runId: true, confirmedScope: true } });
    if (!task) throw new AgentError("task_not_found", "Task not found", 404);
    const scope = await ownedRunScope(userId, task.runId);
    const input = Schema.parse(await agentJson(request));
    if (input.action === "retry_failed") {
      const next = await retryFailedTaskAccounts(scope, taskId, input.expectedVersion);
      dispatchAgentImport(next.importJobId);
      return Response.json(next);
    }
    if (input.action === "change_scope") return Response.json(await reopenTaskImportChoice(scope, taskId, input.expectedVersion));
    if (input.action === "reconnect" && task.confirmedScope) return Response.json(await restoreDeferredImport(scope, taskId, input.expectedVersion));
    if (input.action === "discover") return Response.json(await discoverTaskAccounts(scope, taskId, input.expectedVersion));
    if (input.action === "reuse") {
      if (!input.connectionId && !input.connectionIds) throw new AgentError("invalid_input", "Choose a connected source", 400);
      return Response.json(await reuseTaskConnection(scope, taskId, input.connectionIds ?? input.connectionId!, input.expectedVersion));
    }
    return Response.json(await transitionAgentTask(scope, taskId, { expectedVersion: input.expectedVersion, state: input.action === "defer" ? "deferred" : "waiting_authorization" }));
  } catch (error) { return agentErrorResponse(error); }
}
