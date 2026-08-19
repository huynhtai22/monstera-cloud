import { NextResponse } from "next/server";
import { evaluateStaleHealth } from "@/lib/ingestion/stale-health";
import { requireCronSecret } from "@/lib/request-auth";

/**
 * GET/POST /api/cron/health-tick
 *
 * Cheap freshness evaluator. Called from the 15-minute GitHub Actions worker
 * and the nightly master cron. Destination pipeline scheduling stays disabled
 * in pilot; this route is the stale-health path that used to live only on
 * /api/cron/sync-jobs (410 in pilot).
 */
async function runHealthTick() {
  const report = await evaluateStaleHealth();
  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    ...report,
  });
}

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  return runHealthTick();
}

export async function POST(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  return runHealthTick();
}
