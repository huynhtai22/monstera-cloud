import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * GET /api/metrics/query?workspaceId=...&startDate=...&endDate=...&platform=...
 * 
 * Query stored CampaignMetric data from the database.
 * Used by the Synced Data Explorer to show historical synced data.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const startDate = searchParams.get("startDate"); // YYYY-MM-DD
  const endDate = searchParams.get("endDate"); // YYYY-MM-DD
  const platform = searchParams.get("platform"); // meta_ads | tiktok_ads | etc
  const accountId = searchParams.get("accountId");
  const campaignId = searchParams.get("campaignId");
  const limit = parseInt(searchParams.get("limit") || "1000", 10);

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  // Verify user has access to workspace
  const membership = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId: session.user.id,
    },
  });

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const where: any = { workspaceId };

    // Date range filter
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    // Platform filter
    if (platform) {
      where.platform = platform;
    }

    // Account filter
    if (accountId) {
      where.accountId = accountId;
    }

    // Campaign filter
    if (campaignId) {
      where.campaignId = campaignId;
    }

    const metrics = await prisma.campaignMetric.findMany({
      where,
      orderBy: [{ date: "desc" }, { pulledAt: "desc" }],
      take: Math.min(limit, 5000),
      select: {
        id: true,
        platform: true,
        accountId: true,
        accountName: true,
        campaignId: true,
        campaignName: true,
        adsetId: true,
        adsetName: true,
        date: true,
        impressions: true,
        clicks: true,
        spend: true,
        reach: true,
        cpc: true,
        ctr: true,
        conversions: true,
        revenue: true,
        roas: true,
        currency: true,
        pulledAt: true,
      },
    });

    // Get date range summary for UI
    const dateRange = await prisma.campaignMetric.aggregate({
      where: { workspaceId },
      _min: { date: true },
      _max: { date: true },
    });

    // Get available platforms
    const platforms = await prisma.campaignMetric.findMany({
      where: { workspaceId },
      distinct: ["platform"],
      select: { platform: true },
    });

    return NextResponse.json({
      metrics,
      summary: {
        count: metrics.length,
        dateRange: {
          earliest: dateRange._min.date,
          latest: dateRange._max.date,
        },
        platforms: platforms.map((p) => p.platform),
      },
    });
  } catch (error) {
    console.error("[metrics/query] Error:", error);
    return NextResponse.json(
      { error: "Failed to query metrics" },
      { status: 500 }
    );
  }
}
