import { z } from "zod";
import { AgentError } from "./contracts";
import { agentTransaction, appendAgentEvent } from "./events";
import { authorizeAgentScope } from "./scope";

const WorkspaceSchema = z.string().trim().min(1).max(200);
export const DelegationSchema = z
  .object({
    workspaceId: WorkspaceSchema,
    clientId: WorkspaceSchema.optional(),
    goalId: z.enum(["performance", "reporting", "spend"]),
    context: z.string().trim().max(500).default(""),
    requestId: z.uuid(),
  })
  .strict();

/** Dashboard and onboarding share one durable run; reads never create work. */
export async function delegationEntry(userId: string, rawWorkspaceId: unknown) {
  const workspaceId = WorkspaceSchema.parse(rawWorkspaceId);
  return agentTransaction(async (tx) => {
    await authorizeAgentScope(tx, { userId, workspaceId });
    const membership = await tx.workspaceMember.findFirstOrThrow({
      where: { userId, workspaceId },
      select: { role: true },
    });
    const run = await tx.agentRun.findFirst({
      where: { workspaceId, initiatorUserId: userId, kind: "onboarding" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true, clientId: true },
    });
    const clients = await tx.client.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 500,
    });
    return {
      workspaceId,
      canDelegate: membership.role !== "viewer",
      runId: run?.id ?? null,
      clients,
    };
  });
}

/** Records intent only. OAuth, exact account/date approval and import remain in the existing flow. */
export async function delegateReportingTask(userId: string, raw: unknown) {
  const input = DelegationSchema.parse(raw);
  const { workspaceId } = input;
  const resumeKey = `delegation:${userId}:${input.requestId}`;
  const intent = {
    goalId: input.goalId,
    clientId: input.clientId ?? null,
    context: input.context,
  };
  return agentTransaction(async (tx) => {
    await authorizeAgentScope(tx, { userId, workspaceId }, true);
    if (
      input.clientId &&
      !(await tx.client.findFirst({
        where: { workspaceId, id: input.clientId },
        select: { id: true },
      }))
    ) {
      throw new AgentError("client_not_found", "Client not found", 404);
    }
    const existing = await tx.agentRun.findFirst({
      where: { workspaceId, initiatorUserId: userId, resumeKey },
    });
    if (existing) {
      const event = await tx.agentRunEvent.findFirst({
        where: {
          workspaceId,
          runId: existing.id,
          type: "delegation_requested",
        },
      });
      const prior = event?.payload as Partial<typeof intent> | undefined;
      if (
        prior?.goalId !== intent.goalId ||
        prior?.clientId !== intent.clientId ||
        prior?.context !== intent.context
      ) {
        throw new AgentError(
          "idempotency_conflict",
          "This request was already used for a different task",
        );
      }
      return { runId: existing.id, created: false };
    }
    const latest = await tx.agentRun.findFirst({
      where: { workspaceId, initiatorUserId: userId, kind: "onboarding" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (latest && latest.status !== "completed")
      throw new AgentError(
        "active_run_exists",
        "Resume your saved task before starting another",
      );
    const run = await tx.agentRun.create({
      data: {
        workspaceId,
        initiatorUserId: userId,
        clientId: input.clientId,
        kind: "onboarding",
        resumeKey,
        createdAt: new Date(
          Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1),
        ),
      },
    });
    await appendAgentEvent(tx, {
      workspaceId,
      runId: run.id,
      type: "run_created",
      payload: {
        kind: "onboarding",
        goalId: input.goalId,
        entryPoint: "dashboard",
      },
    });
    await appendAgentEvent(tx, {
      workspaceId,
      runId: run.id,
      type: "delegation_requested",
      payload: intent,
    });
    if (input.context)
      await tx.agentRunMessage.create({
        data: {
          workspaceId,
          runId: run.id,
          messageKey: input.requestId,
          role: "user",
          content: input.context,
        },
      });
    return { runId: run.id, created: true };
  });
}
