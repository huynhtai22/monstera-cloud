import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireCronSecret } from "@/lib/request-auth";
import { withSystemScope } from "@/lib/tenant-guard";
import { claimNextImportJob } from "@/lib/warehouse-import-job";
import { runDurableImportWorker } from "@/lib/warehouse-import-worker";
import { warehouseUsesDedicatedWorker } from "@/lib/warehouse-dispatch";

const BATCH_SIZE = 5;

/**
 * GET/POST /api/cron/warehouse-jobs
 *
 * Invoked about every 15 minutes by .github/workflows/pilot-cron.yml
 * (Hobby has no minute-level Vercel cron) and nightly via /api/cron/master.
 *
 * 1. Reclaims orphaned running jobs whose lease expired.
 * 2. Claims due queued jobs up to BATCH_SIZE (by priority DESC, scheduledAt ASC).
 * 3. Executes each job with durable progress tracking, heartbeats, and retry management.
 */
export async function GET(req: Request) {
  const denied = requireCronSecret(req, "warehouse_jobs");
  if (denied) return denied;

  return await processWarehouseQueue();
}

export async function POST(req: Request) {
  const denied = requireCronSecret(req, "warehouse_jobs");
  if (denied) return denied;

  return await processWarehouseQueue();
}

async function processWarehouseQueue() {
  return withSystemScope(() => processWarehouseQueueUnsafe());
}

async function processWarehouseQueueUnsafe() {
  if (warehouseUsesDedicatedWorker()) {
    return NextResponse.json({ executionMode: "worker", executedJobs: [], processed: 0, failed: 0 });
  }
  const now = new Date();
  const failures: Array<{ jobId?: string; stage: string }> = [];
  const retryingJobs: string[] = [];
  const terminalFailedJobs: string[] = [];

  // 1. Recover jobs whose worker lease expired (worker crashed/aborted).
  try {
    const recovered = await prisma.warehouseImportJob.updateMany({
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
      logger.warn(`[WAREHOUSE_JOBS_CRON] Recovered ${recovered.count} expired lease import jobs`);
    }
  } catch (err) {
    logger.error("[WAREHOUSE_JOBS_CRON] Failed to recover expired lease jobs:", err);
    failures.push({ stage: "lease_recovery" });
  }

  // 2. Claim and execute up to BATCH_SIZE jobs. Extended-pilot jobs are
  // operator-driven only and never claimed by the generic scheduler.
  const executedJobs: string[] = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    try {
      const claim = await claimNextImportJob(60000, { excludePilotJobs: true });
      if (!claim.claimed || !claim.job || !claim.leaseId) {
        break;
      }

      executedJobs.push(claim.job.id);
      logger.info(`[WAREHOUSE_JOBS_CRON] Executing claimed job ${claim.job.id} (lease ${claim.leaseId})`);
      await runDurableImportWorker(claim.job.id, claim.leaseId);
      const outcome = await prisma.warehouseImportJob.findUnique({
        where: { id: claim.job.id },
        select: { status: true },
      });
      if (!outcome || outcome.status === "running") {
        failures.push({ jobId: claim.job.id, stage: "outcome_persistence" });
      }
      if (outcome?.status === "queued") retryingJobs.push(claim.job.id);
      if (outcome?.status === "failed" || outcome?.status === "partial") terminalFailedJobs.push(claim.job.id);
    } catch (jobErr) {
      logger.error("[WAREHOUSE_JOBS_CRON] Error claiming or running job in queue loop:", jobErr);
      failures.push({ jobId: executedJobs.at(-1), stage: "job_execution" });
      break;
    }
  }

  logger.info(`[WAREHOUSE_JOBS_CRON] Processed ${executedJobs.length} warehouse import jobs`);
  return NextResponse.json({
    processed: executedJobs.length,
    jobs: executedJobs,
    retryingJobs,
    failedJobs: terminalFailedJobs,
    failures,
    failed: failures.length + terminalFailedJobs.length,
    timestamp: now.toISOString(),
  }, { status: failures.length + terminalFailedJobs.length > 0 ? 500 : 200 });
}
