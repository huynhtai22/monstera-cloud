import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plan-config";
import { getCachedQuery, setCachedQuery, generateCacheKey } from "@/lib/redis-cache";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { queryWarehouse } from "@/lib/warehouse-query";
import { aggregateCurrencySafe } from "@/lib/currency-safe-aggregation";
import { queryMetricsAggregate } from "@/lib/warehouse-aggregate";

/**
 * GET /api/metrics/query?workspaceId=...&startDate=...&endDate=...&platform=...&cursor=...
 * 
 * Query stored CampaignMetric data with plan-based pagination safeguards.
 * 
 * TIERED LIMITS (per query):
 * - Rows per query is plan-based to protect DB performance.
 *
 * Date ranges are intentionally not clamped (\"free rewind\") — large ranges may be slower and
 * require pagination, but are supported.
 */

interface MetricWhereClause {
  workspaceId: string;
  date?: { gte?: Date; lte?: Date };
  platform?: string | { in: string[] };
  accountId?: string | { in: string[] };
  campaignId?: string;
  id?: { lt?: string }; // For cursor pagination
}

export async function GET(req: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const startDateStr = searchParams.get("startDate"); // YYYY-MM-DD
  const endDateStr = searchParams.get("endDate"); // YYYY-MM-DD
  const platform = searchParams.get("platform");
  const platformsParam = searchParams.get("platforms"); // comma-separated
  const accountId = searchParams.get("accountId");
  const accountIdsParam = searchParams.get("accountIds"); // comma-separated
  const campaignId = searchParams.get("campaignId");
  const cursor = searchParams.get("cursor"); // Pagination cursor (last row ID)
  const dimensionsParam = searchParams.get("dimensions");
  const metricsParam = searchParams.get("metrics");
  const mode = searchParams.get("mode"); // "raw" | "aggregate"

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "viewer",
      operation: "query_metrics",
    });
  } catch (err) {
    const rbac = toRbacResponse(err);
    if (rbac) return rbac;
    throw err;
  }
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  const plan = workspace?.plan ?? 'free';
  const limits = getPlanLimits(plan);

  // Validate and parse dates
  const startDate = startDateStr ? new Date(startDateStr) : null;
  const endDate = endDateStr ? new Date(endDateStr) : null;

  // Validate date range inputs
  if (!startDate || !endDate || !startDateStr || !endDateStr) {
    return NextResponse.json(
      { error: "startDate and endDate are required" },
      { status: 400 }
    );
  }

  const dateRangeMs = endDate.getTime() - startDate.getTime();
  const dateRangeDays = dateRangeMs / (1000 * 60 * 60 * 24);

  if (dateRangeDays < 0) {
    return NextResponse.json(
      { error: "startDate must be before endDate" },
      { status: 400 }
    );
  }

  // Generate deterministic cache key
  const cacheKey = generateCacheKey("metrics:query", {
    workspaceId,
    startDateStr,
    endDateStr,
    platform,
    platformsParam,
    accountId,
    accountIdsParam,
    campaignId,
    cursor,
    dimensionsParam,
    metricsParam,
    mode,
  });

  try {
    // Check cache (only for aggregate queries without a cursor, as cursors mean pagination)
    const wantsAggregate = mode === "aggregate" || Boolean(dimensionsParam) || Boolean(metricsParam);
    const canCache = wantsAggregate && !cursor;
    if (canCache) {
      const cached = await getCachedQuery(cacheKey);
      if (cached) {
        return NextResponse.json(cached);
      }
    }
    // Build where clause with proper typing
    const where: MetricWhereClause = { workspaceId };

    const startOfRange = new Date(startDateStr);
    if (!startDateStr.includes("T")) {
      startOfRange.setUTCHours(0, 0, 0, 0);
    }
    const endOfRange = new Date(endDateStr);
    if (!endDateStr.includes("T")) {
      endOfRange.setUTCHours(23, 59, 59, 999);
    }

    where.date = {
      gte: startOfRange,
      lte: endOfRange,
    };

    if (platformsParam) {
      const list = platformsParam.split(",").map((s) => s.trim()).filter(Boolean);
      if (list.length === 1) where.platform = list[0];
      else if (list.length > 1) where.platform = { in: list };
    } else if (platform) {
      where.platform = platform;
    }

    if (accountIdsParam) {
      const list = accountIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
      if (list.length === 1) where.accountId = list[0];
      else if (list.length > 1) where.accountId = { in: list };
    } else if (accountId) {
      where.accountId = accountId;
    }

    if (campaignId) where.campaignId = campaignId;
    
    // Cursor pagination: only fetch rows with ID < cursor (descending order)
    if (cursor) {
      where.id = { lt: cursor };
    }

    if (wantsAggregate) {
      try {
        const responseData = await queryMetricsAggregate({
          workspaceId,
          startDateStr,
          endDateStr,
          platform,
          platforms: platformsParam ? platformsParam.split(",").map((s) => s.trim()).filter(Boolean) : null,
          accountId,
          accountIds: accountIdsParam ? accountIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : null,
          campaignId,
          dimensions: dimensionsParam?.split(",").map((s) => s.trim()).filter(Boolean),
          metrics: metricsParam?.split(",").map((s) => s.trim()).filter(Boolean),
          plan,
        });
        if (canCache) {
          await setCachedQuery(cacheKey, responseData, 300);
        }
        return NextResponse.json(responseData);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Aggregation failed";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    const platformList = typeof where.platform === "string" ? [where.platform] : where.platform?.in;
    const accountList = typeof where.accountId === "string" ? [where.accountId] : where.accountId?.in;
    const [warehouseResult, dateRangeAgg, platforms] = await Promise.all([
      queryWarehouse({
        workspaceId,
        startDate: startDate ?? undefined,
        endDate: endDate ?? undefined,
        platforms: platformList,
        accountIds: accountList,
        campaignId: where.campaignId,
        cursor,
        limit: limits.explorerMaxRowsPerQuery,
        includeTotalCount: true,
      }),
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

    const metrics = warehouseResult.rows;
    const hasMore = warehouseResult.pagination.hasMore;
    const nextCursor = warehouseResult.pagination.nextCursor;

    // Aggregation for the current page only (fast)
    const pageTotals = aggregateCurrencySafe(metrics);

    const responseData = {
      metrics,
      pagination: {
        hasMore,
        nextCursor,
        returned: metrics.length,
        totalApprox: warehouseResult.totalCount,
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
      asOf: warehouseResult.asOf,
      freshness: warehouseResult.freshness,
    };
    
    if (canCache) {
      await setCachedQuery(cacheKey, responseData, 300); // 5 min TTL
    }
    
    return NextResponse.json(responseData);
  } catch (error) {
    console.error("[metrics/query] Error:", error);
    return NextResponse.json(
      { error: "Failed to query metrics. Try again or narrow filters." },
      { status: 500 }
    );
  }
}
