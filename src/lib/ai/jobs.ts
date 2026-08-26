import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function recoverExpiredAgentJobs(now = new Date()): Promise<number> {
  const recovered = await prisma.agentJob.updateMany({
    where: {
      status: "running",
      leaseExpiresAt: { lt: now },
    },
    data: {
      status: "queued",
      startedAt: null,
      leaseId: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      errorMsg: "Worker lease expired; requeued for execution",
    },
  });
  if (recovered.count > 0) {
    logger.warn(`[AGENT_JOBS] Recovered ${recovered.count} expired leases`);
  }
  return recovered.count;
}

export async function countQueuedAgentJobs(now = new Date()): Promise<number> {
  return prisma.agentJob.count({
    where: { status: "queued", scheduledAt: { lte: now } },
  });
}

/** Claim the next due AgentJob. Callers that cannot run LLM work must not claim. */
export async function claimNextAgentJob(leaseDurationMs = 60000): Promise<{
  claimed: boolean;
  leaseId?: string;
  jobId?: string;
}> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
  const leaseId = randomUUID();

  const candidate = await prisma.agentJob.findFirst({
    where: {
      OR: [
        { status: "queued", scheduledAt: { lte: now } },
        { status: "running", leaseExpiresAt: { lt: now } },
      ],
    },
    orderBy: [{ priority: "desc" }, { scheduledAt: "asc" }],
  });
  if (!candidate) return { claimed: false };

  const updated = await prisma.agentJob.updateMany({
    where: {
      id: candidate.id,
      workspaceId: candidate.workspaceId,
      OR: [
        { status: "queued", scheduledAt: { lte: now } },
        { status: "running", leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      status: "running",
      leaseId,
      leaseExpiresAt,
      heartbeatAt: now,
      startedAt: candidate.startedAt ?? now,
    },
  });
  if (updated.count === 0) return { claimed: false };
  return { claimed: true, leaseId, jobId: candidate.id };
}
