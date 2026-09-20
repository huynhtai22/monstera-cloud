import { logger } from "@/lib/logger";
import { claimNextImportJob } from "@/lib/warehouse-import-job";
import { runDurableImportWorker } from "@/lib/warehouse-import-worker";
import { withSystemScope } from "@/lib/tenant-guard";
import { pathToFileURL } from "node:url";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processNextJob(): Promise<boolean> {
  const claim = await withSystemScope(() => claimNextImportJob(60000, { excludePilotJobs: true }));
  if (!claim.claimed || !claim.job || !claim.leaseId) {
    return false;
  }

  logger.info(`[Import Worker] Claimed job ${claim.job.id}, processing...`);
  await runDurableImportWorker(claim.job.id, claim.leaseId);
  return true;
}

async function main() {
  let stopping = false;
  // Finish the current lease-fenced job before exiting; a forced kill remains
  // recoverable through the existing expired-lease claim path.
  const stop = () => { stopping = true; };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  logger.info("[Import Worker] Starting background warehouse import worker loop...");
  while (!stopping) {
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    logger.error("[Import Worker] Fatal worker error:", err);
    process.exit(1);
  });
}
