import { logger } from "@/lib/logger";
import { runAnalystTurn, type AnalystTurnResult } from "@/lib/ai/analyst";
import {
  claimNextAgentJob,
  completeAgentJob,
  countQueuedAgentJobs,
  failOrRequeueAgentJob,
  recoverExpiredAgentJobs,
  type ClaimedAgentJob,
} from "@/lib/ai/jobs";

/** Hobby serverless budget: leave ~2s for recover + JSON. Nightly only. */
export const AGENT_JOB_BATCH_SIZE = 3;
export const AGENT_JOB_DEADLINE_MS = 8000;

export type AgentQueueSummary = {
  recovered: number;
  executed: number;
  failed: number;
  queued: number;
  jobIds: string[];
};

function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Run one claimed analyst_turn. Workspace always comes from the job row.
 * A payload workspaceId that disagrees is a tenant refusal, not a retryable error.
 */
export async function executeClaimedAgentJob(
  job: ClaimedAgentJob,
  leaseId: string,
  runTurn: typeof runAnalystTurn = runAnalystTurn,
): Promise<"completed" | "lost"> {
  const payloadWorkspace = payloadString(job.payload, "workspaceId");
  if (payloadWorkspace && payloadWorkspace !== job.workspaceId) {
    const written = await completeAgentJob({
      jobId: job.id,
      workspaceId: job.workspaceId,
      leaseId,
      refusalCode: "tenant_mismatch",
      result: {
        status: "refused",
        refusalCode: "tenant_mismatch",
        answer: "Tenant mismatch. Tools only run in the signed-in workspace.",
        blockers: ["tenant_mismatch"],
      },
    });
    return written ? "completed" : "lost";
  }

  const question = payloadString(job.payload, "question") ?? "";
  const turn: AnalystTurnResult = await runTurn({
    workspaceId: job.workspaceId,
    actorUserId: job.userId ?? undefined,
    question,
    clientId: payloadString(job.payload, "clientId"),
    acknowledgeBestEffort: job.payload.acknowledgeBestEffort === true,
    jobId: job.id,
    role: "cron",
  });

  const written = await completeAgentJob({
    jobId: job.id,
    workspaceId: job.workspaceId,
    leaseId,
    refusalCode: turn.refusalCode,
    result: {
      status: turn.status,
      answer: turn.answer,
      blockers: turn.blockers,
      evidence: turn.evidence,
      queuedCopy: turn.queuedCopy,
    },
    model: turn.usage?.model,
    provider: turn.usage?.provider,
    promptVersion: turn.usage?.promptVersion,
    inputTokens: turn.usage?.inputTokens,
    outputTokens: turn.usage?.outputTokens,
    costUsd: turn.usage?.costUsd,
  });
  return written ? "completed" : "lost";
}

export async function processAgentJobQueue(opts?: {
  now?: Date;
  batchSize?: number;
  deadlineMs?: number;
  execute?: typeof executeClaimedAgentJob;
}): Promise<AgentQueueSummary> {
  const now = opts?.now ?? new Date();
  const recovered = await recoverExpiredAgentJobs(now);
  const execute = opts?.execute ?? executeClaimedAgentJob;
  const jobIds: string[] = [];
  let failed = 0;
  const deadline = Date.now() + (opts?.deadlineMs ?? AGENT_JOB_DEADLINE_MS);
  const batchSize = opts?.batchSize ?? AGENT_JOB_BATCH_SIZE;

  for (let i = 0; i < batchSize; i++) {
    if (Date.now() >= deadline) break;
    const claim = await claimNextAgentJob();
    if (!claim.claimed || !claim.job || !claim.leaseId) break;
    try {
      await execute(claim.job, claim.leaseId);
      jobIds.push(claim.job.id);
    } catch (error) {
      const outcome = await failOrRequeueAgentJob({ job: claim.job, leaseId: claim.leaseId, error });
      logger.error(`[AGENT_JOBS] ${claim.job.id} ${outcome}:`, error);
      failed += 1;
    }
  }

  const queued = await countQueuedAgentJobs(now);
  return { recovered, executed: jobIds.length, failed, queued, jobIds };
}
