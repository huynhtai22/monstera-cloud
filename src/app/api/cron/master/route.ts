import { NextResponse } from "next/server";
import { requireCronSecret, resolveCronSecret, type CronScope } from "@/lib/request-auth";
import { recordSecurityControlEvent } from "@/lib/security-control-events";

/** Nightly pilot orchestrator. Scheduled destination pushes are intentionally deferred. */
export async function GET(request: Request) {
  const denied = requireCronSecret(request, "master");
  if (denied) return denied;

  const baseUrl = (process.env.NEXTAUTH_URL?.replace(/\/$/, "") || new URL(request.url).origin).replace(/\/$/, "");
  const executeTask = async (name: string, path: string, scope: CronScope) => {
    try {
      const secret = resolveCronSecret(scope);
      if (!secret || secret.length < 32) return [name, "not_configured"] as const;
      const authorization = `Bearer ${secret}`;
      const response = await fetch(`${baseUrl}${path}`, { headers: { authorization }, cache: "no-store" });
      await recordSecurityControlEvent({
        eventType: "cron_execution",
        outcome: response.ok ? "success" : "failure",
        scope,
        metadata: { status: response.status },
      });
      return [name, response.status] as const;
    } catch {
      await recordSecurityControlEvent({
        eventType: "cron_execution",
        outcome: "failure",
        scope,
        metadata: { status: "network_error" },
      });
      return [name, "failed"] as const;
    }
  };

  // Phase 1: Token prefetch & proactive refresh (ensures fresh access tokens)
  const p1 = await Promise.all([executeTask("tokenPrefetch", "/api/cron/connections/token-prefetch", "token_prefetch")]);

  // Phase 2: Warehouse metric refreshes
  const p2 = await Promise.all([
    executeTask("warehouseRefresh", "/api/cron/warehouse-refresh", "warehouse_refresh"),
    executeTask("shopeeRefresh", "/api/cron/shopee/refresh", "shopee_refresh"),
  ]);

  // Phase 3: Worker drain, health ticks, alerting, reporting, and billing expiry
  const p3 = await Promise.all([
    executeTask("warehouseJobs", "/api/cron/warehouse-jobs", "warehouse_jobs"),
    executeTask("healthTick", "/api/cron/health-tick", "health_tick"),
    executeTask("alerts", "/api/cron/performance-alerts", "performance_alerts"),
    executeTask("reportSchedules", "/api/cron/report-schedules", "report_schedules"),
    executeTask("billingExpiry", "/api/cron/billing-expiry", "billing_expiry"),
    executeTask("seatSharingRetention", "/api/cron/seat-sharing-retention", "seat_sharing_retention"),
  ]);

  // Evaluate control-plane SLOs only after retention has had a chance to
  // publish its current evidence in phase 3.
  const p4 = await Promise.all([
    executeTask("securityPosture", "/api/cron/security-posture", "security_posture"),
  ]);

  const settled = [...p1, ...p2, ...p3, ...p4];

  // Every scheduled task is required: the orchestrator must not report
  // success while any child task returned a non-2xx status or threw. The
  // executed map intentionally carries status codes only — child response
  // bodies, error details, and secrets are never surfaced here.
  const allSucceeded = settled.every(
    ([, status]) => typeof status === "number" && status >= 200 && status < 300,
  );

  return NextResponse.json(
    { timestamp: new Date().toISOString(), executed: Object.fromEntries(settled) },
    { status: allSucceeded ? 200 : 500 },
  );
}
