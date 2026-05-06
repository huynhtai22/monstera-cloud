import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * GET /api/debug/campaign-metrics?workspaceId=...
 * 
 * Debug endpoint to inspect what's in the CampaignMetric table
 * Returns raw counts and sample rows
 */

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  // Verify access
  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: session.user.id },
  });

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Get total count
    const totalCount = await prisma.campaignMetric.count({
      where: { workspaceId },
    });

    // Get count by platform
    const platformCounts = await prisma.$queryRaw`
      SELECT platform, COUNT(*) as count
      FROM "CampaignMetric"
      WHERE "workspaceId" = ${workspaceId}
      GROUP BY platform
    `;

    // Get sample rows
    const sampleRows = await prisma.campaignMetric.findMany({
      where: { workspaceId },
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        platform: true,
        accountId: true,
        accountName: true,
        date: true,
        campaignName: true,
        spend: true,
        createdAt: true,
      },
    });

    // Get distinct accountIds
    const accounts = await prisma.$queryRaw`
      SELECT DISTINCT "accountId", "accountName", platform
      FROM "CampaignMetric"
      WHERE "workspaceId" = ${workspaceId}
      LIMIT 10
    `;

    // Check date range of data
    const dateRangeRaw = await prisma.$queryRaw`
      SELECT 
        MIN(date) as earliest,
        MAX(date) as latest,
        COUNT(*) as total
      FROM "CampaignMetric"
      WHERE "workspaceId" = ${workspaceId}
    `;
    const dateRange = (dateRangeRaw as any[])[0] || null;

    return NextResponse.json({
      workspaceId,
      totalCount,
      platformCounts,
      sampleRows,
      accounts,
      dateRange,
      debug: {
        queryTime: new Date().toISOString(),
        userId: session.user.id,
      },
    });
  } catch (error: any) {
    console.error("[Debug CampaignMetrics] Error:", error);
    return NextResponse.json(
      { error: "Database query failed", details: error.message },
      { status: 500 }
    );
  }
}
