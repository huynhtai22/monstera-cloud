import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/request-auth";
import { withSystemScope } from "@/lib/tenant-guard";
import { emitMonitor } from "@/lib/observability/monitors";
import { countQueuedAgentJobs, recoverExpiredAgentJobs } from "@/lib/ai/jobs";
import { logger } from "@/lib/logger";

/**
 * GET/POST /api/cron/agent-jobs
 *
 * Nightly via /api/cron/master. Do not add this path to pilot-cron.yml.
 * Wave 0 only recovers expired leases and reports queue depth; it does not
 * run LLM work (queue age expected ≈ 24h).
 */
export async function GET(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  return processAgentQueue();
}

export async function POST(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  return processAgentQueue();
}

async function processAgentQueue() {
  return withSystemScope(() => processAgentQueueUnsafe());
}

async function processAgentQueueUnsafe() {
  const now = new Date();
  try {
    const recovered = await recoverExpiredAgentJobs(now);
    const queued = await countQueuedAgentJobs(now);
    return NextResponse.json({
      recovered,
      queued,
      executed: 0,
      timestamp: now.toISOString(),
    });
  } catch (err) {
    logger.error("[AGENT_JOBS_CRON] Failed:", err);
    emitMonitor("ai_worker_failed", {
      path: "/api/cron/agent-jobs",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "agent job worker failed" }, { status: 500 });
  }
}
