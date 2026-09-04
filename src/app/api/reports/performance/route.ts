import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { buildPerformanceReport } from "@/lib/performance-reports";
import { detectMarketingAnomalies } from "@/lib/marketing-anomalies";
import type { MetricRowExport } from "@/lib/client-export";

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

    // Validate date bounds (default to last 7 days)
    const now = new Date();
    const end = endDateParam ? new Date(endDateParam) : now;
    if (!endDateParam || !endDateParam.includes("T")) {
      end.setUTCHours(23, 59, 59, 999);
    }

    const start = startDateParam
      ? new Date(startDateParam)
      : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (!startDateParam || !startDateParam.includes("T")) {
      start.setUTCHours(0, 0, 0, 0);
    }

    let clientInfo: { id: string; name: string } | null = null;
    let connectionIds: string[] | undefined;

    if (clientId) {
      const client = await prisma.client.findFirst({
        where: { id: clientId, workspaceId },
        select: { id: true, name: true },
      });
      if (client) {
        clientInfo = client;
        const conns = await prisma.connection.findMany({
          where: { workspaceId, clientId },
          select: { id: true },
        });
        connectionIds = conns.map((c) => c.id);

        if (connectionIds.length === 0) {
          return NextResponse.json({
            report: buildPerformanceReport([]),
            client: clientInfo,
            anomalies: [],
            dateRange: {
              startDate: start.toISOString().split("T")[0],
              endDate: end.toISOString().split("T")[0],
            },
            latestDataDate: null,
          });
        }
      }
    }

    const whereClause: any = {
      workspaceId,
      date: {
        gte: start,
        lte: end,
      },
    };

    if (connectionIds) {
      whereClause.connectionId = { in: connectionIds };
    }

    const dbRows = await prisma.campaignMetric.findMany({
      where: whereClause,
      select: {
        platform: true,
        accountId: true,
        accountName: true,
        campaignId: true,
        campaignName: true,
        connectionId: true,
        date: true,
        spend: true,
        impressions: true,
        clicks: true,
        conversions: true,
        revenue: true,
        currency: true,
      },
      orderBy: { date: "asc" },
    });

    const rows: MetricRowExport[] = dbRows.map((r) => ({
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
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load performance report" },
      { status: 500 }
    );
  }
}
