import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireCronSecret } from "@/lib/request-auth";
import { claimNextImportJob } from "@/lib/warehouse-import-job";
import { runDurableImportWorker } from "@/app/api/data-explorer/warehouse/import-batch/route";

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
  const denied = requireCronSecret(req);
  if (denied) return denied;

  return await processWarehouseQueue();
}

export async function POST(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  return await processWarehouseQueue();
}

async function processWarehouseQueue() {
  const now = new Date();

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
  }

  // 2. Claim and execute up to BATCH_SIZE jobs
  const executedJobs: string[] = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    try {
      const claim = await claimNextImportJob();
      if (!claim.claimed || !claim.job || !claim.leaseId) {
        break;
      }

      executedJobs.push(claim.job.id);
      logger.info(`[WAREHOUSE_JOBS_CRON] Executing claimed job ${claim.job.id} (lease ${claim.leaseId})`);
      await runDurableImportWorker(claim.job.id, claim.leaseId);
    } catch (jobErr) {
      logger.error("[WAREHOUSE_JOBS_CRON] Error claiming or running job in queue loop:", jobErr);
      break;
    }
  }

  logger.info(`[WAREHOUSE_JOBS_CRON] Processed ${executedJobs.length} warehouse import jobs`);
  return NextResponse.json({
    processed: executedJobs.length,
    jobs: executedJobs,
    timestamp: now.toISOString(),
  });
}
