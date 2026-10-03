import { z } from "zod";
import {
  agentConsoleTransaction,
  requireWorkspaceRole,
  consumeApproval,
  appendConsoleEvent,
  AgentConsoleError,
} from "./persistence";

export const ApproveOperationSchema = z.object({
  workspaceId: z.string().min(1),
  approvalId: z.string().min(1),
  proposalHash: z.string().min(1),
  evidenceFingerprint: z.string().min(1),
  evidenceRevision: z.number().int().min(1).optional(),
  policyRevision: z.number().int().min(1),
  scopeRevision: z.number().int().min(1),
  expectedVersion: z.number().int().min(0).optional(),
});

export async function approveOperationAction(
  userId: string,
  operationId: string,
  rawInput: unknown
) {
  const input = ApproveOperationSchema.parse(rawInput);

  return agentConsoleTransaction(async (tx) => {
    await requireWorkspaceRole(tx, input.workspaceId, userId, ["owner", "admin", "member"]);

    const operation = await tx.agentOperation.findFirst({
      where: { id: operationId, workspaceId: input.workspaceId },
    });
    if (!operation) {
      throw new AgentConsoleError("operation_not_found", "Operation not found in workspace", 404);
    }

    if (operation.state !== "queued") {
      throw new AgentConsoleError("invalid_operation_state", `Operation state must be 'queued' to approve, got '${operation.state}'`, 400);
    }

    if (input.expectedVersion !== undefined && operation.version !== input.expectedVersion) {
      throw new AgentConsoleError("stale_version", "Operation changed; refresh before approving", 409);
    }

    // Atomically consume approval (validates expiration, single-use, binding hashes, scope & policy revisions)
    const consumedApproval = await consumeApproval(tx, {
      workspaceId: input.workspaceId,
      approvalId: input.approvalId,
      operationId,
      proposalHash: input.proposalHash,
      evidenceFingerprint: input.evidenceFingerprint,
      evidenceRevision: input.evidenceRevision,
      policyRevision: input.policyRevision,
      scopeRevision: input.scopeRevision,
      actorUserId: userId,
    });

    // Advance operation to queued
    const updatedOperation = await tx.agentOperation.update({
      where: { workspaceId_id: { workspaceId: input.workspaceId, id: operationId } },
      data: {
        state: "queued",
        version: { increment: 1 },
      },
    });

    await appendConsoleEvent(tx, {
      workspaceId: input.workspaceId,
      operationId,
      actorType: "user",
      actorUserId: userId,
      type: "operation_approved",
      payload: { approvalId: input.approvalId, proposalHash: input.proposalHash },
    });

    return {
      operation: updatedOperation,
      approval: consumedApproval,
    };
  });
}
