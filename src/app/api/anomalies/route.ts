import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { detectMarketingAnomalies, type MarketingAnomaly } from "@/lib/marketing-anomalies";
import type { MetricRowExport } from "@/lib/client-export";

/**
 * GET /api/anomalies
 * Detects marketing performance anomalies across campaigns for a workspace.
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

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "viewer" });

    // Fetch connections to map connectionId -> clientId & clientName
    const connections = await prisma.connection.findMany({
      where: { workspaceId },
      select: {
        id: true,
        clientId: true,
        client: { select: { id: true, name: true } },
      },
    });

    const connToClientMap = new Map<string, { clientId?: string; clientName?: string }>();
    const clientConnIds = new Set<string>();

    for (const c of connections) {
      if (c.clientId && c.client) {
        connToClientMap.set(c.id, { clientId: c.clientId, clientName: c.client.name });
        if (clientId && c.clientId === clientId) {
          clientConnIds.add(c.id);
        }
      }
    }

    // Filter by 14 days ago to capture baseline and recent days
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const where: any = {
      workspaceId,
      date: { gte: fourteenDaysAgo },
    };

    if (clientId) {
      if (clientConnIds.size === 0) {
        return NextResponse.json({
          anomalies: [],
          summary: { total: 0, critical: 0, warning: 0 },
          byClient: {},
        });
      }
      where.connectionId = { in: Array.from(clientConnIds) };
    }

    const metrics = await prisma.campaignMetric.findMany({
      where,
      select: {
        connectionId: true,
        platform: true,
        accountId: true,
        accountName: true,
        campaignId: true,
        campaignName: true,
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

    // Convert to MetricRowExport
    const rows: MetricRowExport[] = metrics.map((m) => ({
      platform: m.platform,
      accountId: m.accountId,
      accountName: m.accountName,
      campaignId: m.campaignId,
      campaignName: m.campaignName,
      connectionId: m.connectionId,
      date: m.date.toISOString().split("T")[0],
      spend: Number(m.spend) || 0,
      impressions: Number(m.impressions) || 0,
      clicks: Number(m.clicks) || 0,
      conversions: Number(m.conversions) || 0,
      revenue: Number(m.revenue) || 0,
      currency: m.currency || "USD",
    }));

    // Detect anomalies with freshness verification against today
    const detected = detectMarketingAnomalies(rows, {
      referenceDate: new Date().toISOString().split("T")[0],
      maxStaleDays: 4,
    });

    // Enrich anomalies with client information using connectionId or exact identity
    const enrichedAnomalies: MarketingAnomaly[] = detected.map((a) => {
      // 1. Direct connectionId match (highest accuracy)
      let clientInfo = a.connectionId ? connToClientMap.get(a.connectionId) : undefined;

      // 2. Exact match on platform + account + campaign ID
      if (!clientInfo) {
        const match = metrics.find(
          (m) =>
            m.platform === a.platform &&
            m.accountId === a.accountId &&
            (a.campaignId && m.campaignId ? m.campaignId === a.campaignId : m.campaignName === a.campaignName)
        );
        if (match) {
          clientInfo = connToClientMap.get(match.connectionId);
        }
      }

      return {
        ...a,
        clientId: clientInfo?.clientId,
        clientName: clientInfo?.clientName,
      };
    });

    // Group by Client ID
    const byClient: Record<string, { clientName: string; anomalies: MarketingAnomaly[] }> = {};
    for (const a of enrichedAnomalies) {
      const cId = a.clientId || "unassigned";
      const cName = a.clientName || "Unassigned Brand";
      if (!byClient[cId]) {
        byClient[cId] = { clientName: cName, anomalies: [] };
      }
      byClient[cId].anomalies.push(a);
    }

    const criticalCount = enrichedAnomalies.filter((a) => a.severity === "critical").length;
    const warningCount = enrichedAnomalies.filter((a) => a.severity === "warning").length;

    return NextResponse.json({
      anomalies: enrichedAnomalies,
      summary: {
        total: enrichedAnomalies.length,
        critical: criticalCount,
        warning: warningCount,
      },
      byClient,
    });
  } catch (error: unknown) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to detect anomalies" },
      { status: 500 }
    );
  }
}
