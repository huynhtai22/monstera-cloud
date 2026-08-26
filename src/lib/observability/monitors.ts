import { logger } from "@/lib/logger";

/** Production-visible operational events. Always warn/error — info is stripped in prod. */
export function emitMonitor(
  event:
    | "oauth_failure"
    | "time_to_first_row"
    | "queued_job_age"
    | "warehouse_freshness"
    | "tenant_authz_denied"
    | "ai_worker_failed"
    | "ai_budget_warning",
  fields: Record<string, unknown>,
): void {
  logger.warn(`[MONITOR] ${event}`, fields);
}
