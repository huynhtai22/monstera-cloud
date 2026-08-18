import { logger } from "@/lib/logger";
import { claimNextImportJob } from "@/lib/warehouse-import-job";
import { runDurableImportWorker } from "@/app/api/data-explorer/warehouse/import-batch/route";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processNextJob(): Promise<boolean> {
  const claim = await claimNextImportJob();
  if (!claim.claimed || !claim.job || !claim.leaseId) {
    return false;
  }

  logger.info(`[Import Worker] Claimed job ${claim.job.id}, processing...`);
  await runDurableImportWorker(claim.job.id, claim.leaseId);
  return true;
}

async function main() {
  logger.info("[Import Worker] Starting background warehouse import worker loop...");
  while (true) {
    try {
      const processed = await processNextJob();
      if (!processed) {
        await sleep(3000);
      }
    } catch (err) {
      logger.error("[Import Worker] Error in worker loop:", err);
      await sleep(5000);
    }
  }
}

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  main().catch((err) => {
    logger.error("[Import Worker] Fatal worker error:", err);
    process.exit(1);
  });
}
