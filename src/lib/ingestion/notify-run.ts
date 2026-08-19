import { sendAgencyAlert } from "@/lib/alerts";
import { classifyIngestionError, describeNextAction, formatLogError } from "./error-taxonomy";
import { shouldNotifyIngestionFailure } from "./alert-policy";
import { upsertOpenTicket } from "@/lib/support-ticket";

export async function notifyWarehouseJobIfNeeded(job: {
  id: string;
  workspaceId: string;
  errorMsg?: string | null;
  retryCount?: number;
  maxRetries?: number;
}): Promise<void> {
  const classified = classifyIngestionError(job.errorMsg || "Import failed");
  const decision = shouldNotifyIngestionFailure({
    classified,
    retryCount: job.retryCount,
    maxRetries: job.maxRetries,
  });
  if (!decision.notify) return;
  await upsertOpenTicket({
    workspaceId: job.workspaceId,
    reason: decision.reason === "auth" ? "auth" : "exhausted_retries",
    title: `Warehouse import ${decision.reason === "auth" ? "auth failure" : "exhausted retries"}`,
    tag: classified.tag,
    errorMsg: classified.message,
    runId: job.id,
  }).catch(() => {});
  await sendAgencyAlert({
    workspaceId: job.workspaceId,
    pipelineName: `Warehouse import ${job.id}`,
    errorMsg: formatLogError(classified),
    actionHint: describeNextAction(decision.action),
  });
}
