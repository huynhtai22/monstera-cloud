import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { AgentError } from "./contracts";
import type { AgentTransaction } from "./scope";

/** Retry serializable conflicts/unique races only; a domain conflict is final. */
export async function agentTransaction<T>(fn: (tx: AgentTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(tx => fn(tx), {
        isolationLevel: "Serializable",
        maxWait: 10000,
        timeout: 15000,
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "P2034" || code === "P2002" || code === "P2028") {
        if (attempt === 3) throw new AgentError("transaction_conflict", "Setup is busy; refresh and retry this action");
        // Stagger competing transactions instead of immediately colliding again.
        await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt + Math.floor(Math.random() * 20)));
        continue;
      }
      throw error;
    }
  }
  throw new AgentError("transaction_conflict", "Please retry the action");
}

/** Internal primitive: called only after authorization in the same transaction. */
export async function appendAgentEvent(tx: AgentTransaction, input: {
  workspaceId: string; runId: string; taskId?: string;
  type: string; payload: Prisma.InputJsonObject;
}) {
  const run = await tx.agentRun.update({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.runId } },
    data: { lastEventSequence: { increment: 1 }, version: { increment: 1 } },
  });
  return tx.agentRunEvent.create({
    data: { ...input, sequence: run.lastEventSequence },
  });
}
