import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { buildPerformanceReport } from "@/lib/performance-reports";
import { detectMarketingAnomalies } from "@/lib/marketing-anomalies";
import type { MetricRowExport } from "@/lib/client-export";
import { queryWarehouse } from "@/lib/warehouse-query";
import {
  assertQueryableClientContext,
  resolveClientContext,
  resolvedClientPayload,
  toClientContextResponse,
  warehouseClientId,
} from "@/lib/client-context-server";

/**
 * GET /api/reports/performance
 * Returns high-level performance metrics, daily trends, channel distributions,
 * and top campaigns for executive reporting.
 */
export async function GET(req: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");
    const clientId = searchParams.get("clientId");
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "viewer" });

    // Validate date bounds (default to last 7 days, max range 90 days)
    const now = new Date();
    const end = endDateParam ? new Date(endDateParam) : now;
    if (!endDateParam || !endDateParam.includes("T")) {
      end.setUTCHours(23, 59, 59, 999);
    }

    let start = startDateParam
      ? new Date(startDateParam)
      : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (!startDateParam || !startDateParam.includes("T")) {
      start.setUTCHours(0, 0, 0, 0);
    }

    // Safety: bound maximum date range to 90 days
    const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
    if (end.getTime() - start.getTime() > MAX_RANGE_MS) {
      start = new Date(end.getTime() - MAX_RANGE_MS);
    }

    const resolution = await resolveClientContext({
      workspaceId,
      requestedClientId: clientId,
      surface: "reports",
    });
    assertQueryableClientContext(resolution);
    const clientInfo = resolvedClientPayload(resolution);

    const warehouseResult = await queryWarehouse({
      workspaceId,
      clientId: warehouseClientId(resolution),
      startDate: start,
      endDate: end,
      limit: 10_000,
    });

    const rows: MetricRowExport[] = warehouseResult.rows.map((r) => ({
      platform: r.platform,
      accountId: r.accountId,
      accountName: r.accountName,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      connectionId: r.connectionId,
      date: r.date.toISOString().split("T")[0],
      spend: Number(r.spend) || 0,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      conversions: Number(r.conversions) || 0,
      revenue: Number(r.revenue) || 0,
      roas: r.spend > 0 ? (Number(r.revenue) || 0) / Number(r.spend) : 0,
      currency: r.currency || "USD",
    }));

    let latestDataDate: string | null = null;
    if (rows.length > 0) {
      latestDataDate = rows[rows.length - 1].date;
    }

    const report = buildPerformanceReport(rows);
    const anomalies = detectMarketingAnomalies(rows, {
      referenceDate: new Date().toISOString().split("T")[0],
      maxStaleDays: 4,
    });

    return NextResponse.json({
      report,
      client: clientInfo,
      anomalies,
      dateRange: {
        startDate: start.toISOString().split("T")[0],
        endDate: end.toISOString().split("T")[0],
      },
      latestDataDate,
    });
  } catch (error: unknown) {
    const clientCtx = toClientContextResponse(error);
    if (clientCtx) return clientCtx;
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load performance report" },
      { status: 500 }
    );
  }
}
