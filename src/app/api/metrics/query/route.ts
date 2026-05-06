import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plan-config";

/**
 * GET /api/metrics/query?workspaceId=...&startDate=...&endDate=...&platform=...&cursor=...
 * 
 * Query stored CampaignMetric data with plan-based pagination safeguards.
 * 
 * TIERED LIMITS (per query):
 * - Free: 30 days, 500 rows
 * - Starter: 90 days, 1,000 rows  
 * - Pro: 365 days, 5,000 rows
 * - Enterprise: 730 days, 10,000 rows
 * 
 * This prevents OOM errors and query timeouts when tables have millions of rows.
 */

interface MetricWhereClause {
  workspaceId: string;
  date?: { gte?: Date; lte?: Date };
  platform?: string;
  accountId?: string;
  campaignId?: string;
  id?: { lt?: string }; // For cursor pagination
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const startDateStr = searchParams.get("startDate"); // YYYY-MM-DD
  const endDateStr = searchParams.get("endDate"); // YYYY-MM-DD
  const platform = searchParams.get("platform");
  const accountId = searchParams.get("accountId");
  const campaignId = searchParams.get("campaignId");
  const cursor = searchParams.get("cursor"); // Pagination cursor (last row ID)

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  // Fetch user plan and get tiered limits
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true },
  });
  const plan = user?.plan ?? 'free';
  const limits = getPlanLimits(plan);

  // Validate and parse dates
  const startDate = startDateStr ? new Date(startDateStr) : null;
  const endDate = endDateStr ? new Date(endDateStr) : null;

  // Enforce date range constraints to prevent unbounded queries
  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate are required (max 90 days range)" },
      { status: 400 }
    );
  }

  const dateRangeMs = endDate.getTime() - startDate.getTime();
  const dateRangeDays = dateRangeMs / (1000 * 60 * 60 * 24);

  if (dateRangeDays > limits.explorerMaxDateRangeDays) {
    return NextResponse.json(
      { 
        error: `Date range too large. Your ${plan} plan allows maximum ${limits.explorerMaxDateRangeDays} days. Upgrade for more.`,
        plan,
        limits: {
          maxDateRangeDays: limits.explorerMaxDateRangeDays,
          maxRowsPerQuery: limits.explorerMaxRowsPerQuery,
        }
      },
      { status: 400 }
    );
  }

  if (dateRangeDays < 0) {
    return NextResponse.json(
      { error: "startDate must be before endDate" },
      { status: 400 }
    );
  }

  // Verify user has access to workspace
  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: session.user.id },
  });

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Build where clause with proper typing
    const where: MetricWhereClause = { workspaceId };

    where.date = {
      gte: startDate,
      lte: endDate,
    };

    if (platform) where.platform = platform;
    if (accountId) where.accountId = accountId;
    if (campaignId) where.campaignId = campaignId;
    
    // Cursor pagination: only fetch rows with ID < cursor (descending order)
    if (cursor) {
      where.id = { lt: cursor };
    }

    // Parallel queries for efficiency
    const [metrics, countResult, dateRangeAgg, platforms] = await Promise.all([
      // Main data query with plan-based limit
      prisma.campaignMetric.findMany({
        where,
        orderBy: [{ date: "desc" }, { id: "desc" }], // Stable ordering for pagination
        take: limits.explorerMaxRowsPerQuery,
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
      }),

      // Total count for this filter (approximate, capped)
      prisma.campaignMetric.count({
        where,
        take: 100000, // Cap count query to prevent timeouts
      }).catch(() => -1), // Graceful fallback if count times out

      // Date range bounds for the workspace
      prisma.campaignMetric.aggregate({
        where: { workspaceId },
        _min: { date: true },
        _max: { date: true },
      }),

      // Available platforms (cached, low cost)
      prisma.campaignMetric.findMany({
        where: { workspaceId },
        distinct: ["platform"],
        select: { platform: true },
        take: 50,
      }),
    ]);

    // Determine if there are more pages
    const hasMore = metrics.length === limits.explorerMaxRowsPerQuery;
    const nextCursor = hasMore ? metrics[metrics.length - 1]?.id : null;

    // Aggregation for the current page only (fast)
    const pageTotals = metrics.reduce(
      (acc, m) => ({
        impressions: acc.impressions + (m.impressions || 0),
        clicks: acc.clicks + (m.clicks || 0),
        spend: acc.spend + (m.spend || 0),
        conversions: acc.conversions + (m.conversions || 0),
        revenue: acc.revenue + (m.revenue || 0),
      }),
      { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0 }
    );

    return NextResponse.json({
      metrics,
      pagination: {
        hasMore,
        nextCursor,
        returned: metrics.length,
        totalApprox: countResult >= 0 ? countResult : undefined,
        maxPerPage: limits.explorerMaxRowsPerQuery,
      },
      limits: {
        plan,
        maxDateRangeDays: limits.explorerMaxDateRangeDays,
        maxRowsPerQuery: limits.explorerMaxRowsPerQuery,
      },
      summary: {
        pageTotals,
        dateRange: {
          earliest: dateRangeAgg._min.date,
          latest: dateRangeAgg._max.date,
        },
        platforms: platforms.map((p) => p.platform),
        queryRangeDays: Math.ceil(dateRangeDays),
      },
    });
  } catch (error) {
    console.error("[metrics/query] Error:", error);
    return NextResponse.json(
      { error: "Failed to query metrics. Try a smaller date range." },
      { status: 500 }
    );
  }
}
