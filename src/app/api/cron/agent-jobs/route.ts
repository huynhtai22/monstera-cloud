import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/request-auth";
import { withSystemScope } from "@/lib/tenant-guard";
import { emitMonitor } from "@/lib/observability/monitors";
import { processAgentJobQueue } from "@/lib/ai/worker";
import { logger } from "@/lib/logger";

/**
 * GET/POST /api/cron/agent-jobs
 *
 * Nightly via /api/cron/master. Do not add this path to pilot-cron.yml.
 * Recovers expired leases, then claims up to 3 due analyst_turn jobs and runs
 * typed warehouse tools (no LLM). Queue age expected ≈ 24h on Hobby.
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
    const summary = await processAgentJobQueue({ now });
    return NextResponse.json({
      recovered: summary.recovered,
      queued: summary.queued,
      executed: summary.executed,
      failed: summary.failed,
      jobs: summary.jobIds,
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
