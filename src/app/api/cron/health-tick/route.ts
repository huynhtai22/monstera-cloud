import { NextResponse } from "next/server";
import { evaluateStaleHealth } from "@/lib/ingestion/stale-health";
import { emitHealthMonitorsAndStaleAlerts } from "@/lib/ingestion/health-monitors";
import { requireCronSecret } from "@/lib/request-auth";
import { monitorReportFreshness } from "@/lib/ingestion/report-freshness-monitor";
import { deliverPendingAgencyAlerts } from "@/lib/alerts";

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
  const monitors = await emitHealthMonitorsAndStaleAlerts();
  const reportFreshness = await monitorReportFreshness();
  const alertDelivery = await deliverPendingAgencyAlerts();
  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    ...report,
    monitors,
    reportFreshness,
    alertDelivery,
  }, { status: alertDelivery.pending > 0 || alertDelivery.dead > 0 ? 500 : 200 });
}

export async function GET(request: Request) {
  const denied = requireCronSecret(request, "health_tick");
  if (denied) return denied;
  return runHealthTick();
}

export async function POST(request: Request) {
  const denied = requireCronSecret(request, "health_tick");
  if (denied) return denied;
  return runHealthTick();
}
