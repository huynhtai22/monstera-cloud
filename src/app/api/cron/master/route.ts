import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/request-auth";

/** Nightly pilot orchestrator. Scheduled destination pushes are intentionally deferred. */
export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const baseUrl = (process.env.NEXTAUTH_URL?.replace(/\/$/, "") || new URL(request.url).origin).replace(/\/$/, "");
  const authorization = `Bearer ${process.env.CRON_SECRET}`;
  const tasks = [
    ["warehouseRefresh", "/api/cron/warehouse-refresh"],
    ["shopeeRefresh", "/api/cron/shopee/refresh"],
    ["alerts", "/api/cron/performance-alerts"],
  ] as const;

  const settled = await Promise.all(tasks.map(async ([name, path]) => {
    try {
      const response = await fetch(`${baseUrl}${path}`, { headers: { authorization }, cache: "no-store" });
      return [name, response.status] as const;
    } catch {
      return [name, "failed"] as const;
    }
  }));

  return NextResponse.json({ timestamp: new Date().toISOString(), executed: Object.fromEntries(settled) });
}
