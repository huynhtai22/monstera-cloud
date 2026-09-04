import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/request-auth";

/** Nightly pilot orchestrator. Scheduled destination pushes are intentionally deferred. */
export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const baseUrl = (process.env.NEXTAUTH_URL?.replace(/\/$/, "") || new URL(request.url).origin).replace(/\/$/, "");
  const authorization = `Bearer ${process.env.CRON_SECRET}`;

  const executeTask = async (name: string, path: string) => {
    try {
      const response = await fetch(`${baseUrl}${path}`, { headers: { authorization }, cache: "no-store" });
      return [name, response.status] as const;
    } catch {
      return [name, "failed"] as const;
    }
  };

  // Phase 1: Token prefetch & proactive refresh (ensures fresh access tokens)
  const p1 = await Promise.all([executeTask("tokenPrefetch", "/api/cron/connections/token-prefetch")]);

  // Phase 2: Warehouse metric refreshes
  const p2 = await Promise.all([
    executeTask("warehouseRefresh", "/api/cron/warehouse-refresh"),
    executeTask("shopeeRefresh", "/api/cron/shopee/refresh"),
  ]);

  // Phase 3: Worker drain, health ticks, alerting, reporting, and billing expiry
  const p3 = await Promise.all([
    executeTask("warehouseJobs", "/api/cron/warehouse-jobs"),
    executeTask("healthTick", "/api/cron/health-tick"),
    executeTask("alerts", "/api/cron/performance-alerts"),
    executeTask("reportSchedules", "/api/cron/report-schedules"),
    executeTask("billingExpiry", "/api/cron/billing-expiry"),
  ]);

  const settled = [...p1, ...p2, ...p3];

  return NextResponse.json({ timestamp: new Date().toISOString(), executed: Object.fromEntries(settled) });
}
