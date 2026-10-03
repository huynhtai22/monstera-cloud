import { after } from "next/server";
import { warehouseUsesDedicatedWorker } from "@/lib/warehouse-dispatch";
import { claimImportJob } from "@/lib/warehouse-import-job";
import { runDurableImportWorker } from "@/lib/warehouse-import-worker";
import { logger } from "@/lib/logger";

/** Runs only after scope/job transaction commits. Durable cron/worker owns
 * retry/backoff and recovers a queued job if the request process exits. */
export function dispatchAgentImport(jobId: string | null) {
  if (!jobId || warehouseUsesDedicatedWorker()) return;
  after(async () => {
    try {
      const claim = await claimImportJob(jobId);
      if (claim.claimed && claim.leaseId) await runDurableImportWorker(jobId, claim.leaseId);
    } catch { logger.warn("[Agent onboarding] Import remains recoverable by worker", { jobId }); }
  });
}
