import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export const EXECUTABLE_AGENT_JOB_TYPES = ["analyst_turn"] as const;
export type ExecutableAgentJobType = (typeof EXECUTABLE_AGENT_JOB_TYPES)[number];

export type AgentJobType = ExecutableAgentJobType | "anomaly_scan" | "schema_discover" | "exec_brief";

export type ClaimedAgentJob = {
  id: string;
  workspaceId: string;
  userId: string | null;
  type: string;
  payload: Record<string, unknown>;
  retryCount: number;
  maxRetries: number;
};

export async function enqueueAgentJob(opts: {
  workspaceId: string;
  userId?: string;
  type: AgentJobType;
  payload: Record<string, unknown>;
  status?: "queued" | "completed";
  result?: Record<string, unknown>;
  refusalCode?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  provider?: string;
  promptVersion?: string;
}): Promise<{ id: string }> {
  const created = await prisma.agentJob.create({
    data: {
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      type: opts.type,
      status: opts.status ?? "queued",
      payload: opts.payload,
      result: opts.result ?? undefined,
      refusalCode: opts.refusalCode,
      costUsd: opts.costUsd ?? 0,
      inputTokens: opts.inputTokens ?? 0,
      outputTokens: opts.outputTokens ?? 0,
      model: opts.model,
      provider: opts.provider,
      promptVersion: opts.promptVersion,
      finishedAt: opts.status === "completed" ? new Date() : undefined,
    },
  });
  return { id: created.id };
}

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

/**
 * Claim the next due executable AgentJob (analyst_turn only this wave).
 * Nightly cron may claim: it runs typed tools, not an LLM.
 */
export async function claimNextAgentJob(leaseDurationMs = 60000): Promise<{
  claimed: boolean;
  leaseId?: string;
  job?: ClaimedAgentJob;
}> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
  const leaseId = randomUUID();

  const candidate = await prisma.agentJob.findFirst({
    where: {
      type: { in: [...EXECUTABLE_AGENT_JOB_TYPES] },
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

  const payload =
    candidate.payload && typeof candidate.payload === "object" && !Array.isArray(candidate.payload)
      ? (candidate.payload as Record<string, unknown>)
      : {};

  return {
    claimed: true,
    leaseId,
    job: {
      id: candidate.id,
      workspaceId: candidate.workspaceId,
      userId: candidate.userId,
      type: candidate.type,
      payload,
      retryCount: candidate.retryCount,
      maxRetries: candidate.maxRetries,
    },
  };
}

export async function completeAgentJob(opts: {
  jobId: string;
  workspaceId: string;
  leaseId: string;
  result: Record<string, unknown>;
  refusalCode?: string;
  model?: string;
  provider?: string;
  promptVersion?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}): Promise<boolean> {
  const now = new Date();
  const updated = await prisma.agentJob.updateMany({
    where: { id: opts.jobId, workspaceId: opts.workspaceId, leaseId: opts.leaseId, status: "running" },
    data: {
      status: "completed",
      result: opts.result,
      refusalCode: opts.refusalCode,
      errorMsg: null,
      finishedAt: now,
      leaseId: null,
      leaseExpiresAt: null,
      heartbeatAt: now,
      model: opts.model ?? "deterministic",
      provider: opts.provider ?? "deterministic",
      promptVersion: opts.promptVersion ?? "analyst.tools.v1",
      inputTokens: opts.inputTokens ?? 0,
      outputTokens: opts.outputTokens ?? 0,
      costUsd: opts.costUsd ?? 0,
    },
  });
  return updated.count === 1;
}

export async function failOrRequeueAgentJob(opts: {
  job: ClaimedAgentJob;
  leaseId: string;
  error: unknown;
}): Promise<"requeued" | "failed" | "lost"> {
  const message = opts.error instanceof Error ? opts.error.message : String(opts.error);
  const retryCount = opts.job.retryCount + 1;
  const now = new Date();
  const terminal = retryCount >= opts.job.maxRetries;
  const updated = await prisma.agentJob.updateMany({
    where: {
      id: opts.job.id,
      workspaceId: opts.job.workspaceId,
      leaseId: opts.leaseId,
      status: "running",
    },
    data: terminal
      ? {
          status: "failed",
          retryCount,
          errorMsg: message.slice(0, 1000),
          finishedAt: now,
          leaseId: null,
          leaseExpiresAt: null,
          heartbeatAt: now,
        }
      : {
          status: "queued",
          retryCount,
          errorMsg: message.slice(0, 1000),
          startedAt: null,
          leaseId: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
        },
  });
  if (updated.count === 0) return "lost";
  return terminal ? "failed" : "requeued";
}
