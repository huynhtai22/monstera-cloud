import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plan-config";
import {
  getCachedQuery,
  setCachedQuery,
  generateMetricsQueryCacheKey,
  getWorkspaceMetricsGeneration,
} from "@/lib/redis-cache";
import { getCanonicalDateRange, type CanonicalDateRange } from "@/lib/warehouse-date-range";
import { buildAccountFilterPredicate, appendWherePredicate } from "@/lib/warehouse-account-filter";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { queryWarehouse } from "@/lib/warehouse-query";
import { aggregateCurrencySafe } from "@/lib/currency-safe-aggregation";
import { queryMetricsAggregate } from "@/lib/warehouse-aggregate";
import { clientContextCacheParams } from "@/lib/client-context";

import {
  assertQueryableClientContext,
  resolveClientContext,
  toClientContextResponse,
  warehouseClientId,
} from "@/lib/client-context-server";

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
  date?: { gte?: Date; lt?: Date; lte?: Date };
  platform?: string | { in: string[] };
  accountId?: string | { in: string[] };
  campaignId?: string;
  id?: { lt?: string }; // For cursor pagination
  AND?: any[];
  OR?: any[];
}


export async function GET(req: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const clientId = searchParams.get("clientId");
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

  let scopedClientId: string | undefined;
  try {
    const resolution = await resolveClientContext({
      workspaceId,
      requestedClientId: clientId,
      surface: "warehouse",
    });
    assertQueryableClientContext(resolution);
    scopedClientId = warehouseClientId(resolution);
  } catch (err) {
    const clientCtx = toClientContextResponse(err);
    if (clientCtx) return clientCtx;
    throw err;
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  const plan = workspace?.plan ?? 'free';
  const limits = getPlanLimits(plan);

  // Validate and parse dates using single canonical date helper
  if (!startDateStr || !endDateStr) {
    return NextResponse.json(
      { error: "startDate and endDate are required" },
      { status: 400 }
    );
  }

  let canonicalRange: CanonicalDateRange;
  try {
    canonicalRange = getCanonicalDateRange(startDateStr, endDateStr);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Invalid date range" },
      { status: 400 }
    );
  }

  const dateRangeDays =
    (canonicalRange.endUtc.getTime() - canonicalRange.startUtc.getTime()) / (1000 * 60 * 60 * 24) + 1;

  // Check cache (only for aggregate queries without a cursor, as cursors mean pagination)
  const wantsAggregate = mode === "aggregate" || Boolean(dimensionsParam) || Boolean(metricsParam);
  const canCache = wantsAggregate && !cursor;
  let cacheKey: string | null = null;
  if (canCache) {
    const generation = await getWorkspaceMetricsGeneration(workspaceId);
    cacheKey = generateMetricsQueryCacheKey(workspaceId, generation, {
      workspaceId,
      clientId,
      ...clientContextCacheParams(clientId),
      startDateStr: canonicalRange.since,
      endDateStr: canonicalRange.until,
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
    const cached = await getCachedQuery(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }
  }

  try {
    // Build where clause with proper typing
    const where: MetricWhereClause = { workspaceId };
    where.date = canonicalRange.dbWhereDate;

    const platforms = platformsParam
      ? platformsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : platform
        ? [platform]
        : null;
    if (platforms?.length) {
      where.platform = platforms.length === 1 ? platforms[0] : { in: platforms };
    }

    const accountIds = accountIdsParam
      ? accountIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : accountId
        ? [accountId]
        : null;
    if (accountIds?.length) {
      const accountPredicate = buildAccountFilterPredicate({
        accountIds,
        platforms,
      });
      appendWherePredicate(where, accountPredicate);
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
          clientId: scopedClientId,
          startDateStr: canonicalRange.since,
          endDateStr: canonicalRange.until,
          platform,
          platforms: platforms ?? null,
          accountId,
          accountIds: accountIds ?? null,
          campaignId,
          dimensions: dimensionsParam?.split(",").map((s) => s.trim()).filter(Boolean),
          metrics: metricsParam?.split(",").map((s) => s.trim()).filter(Boolean),
          plan,
        });
        if (canCache && cacheKey) {
          await setCachedQuery(cacheKey, responseData, 300);
        }
        return NextResponse.json(responseData);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Aggregation failed";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    const platformList = platforms ?? undefined;
    const accountList = accountIds ?? undefined;
    const warehouseResult = await queryWarehouse({
      workspaceId,
      clientId: scopedClientId,
      startDate: canonicalRange.startUtc,
      endDate: canonicalRange.endUtc,
      platforms: platformList,
      accountIds: accountList,
      campaignId: where.campaignId,
      cursor,
      limit: limits.explorerMaxRowsPerQuery,
      includeTotalCount: true,
    });


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
        dateRange: warehouseResult.dateRange,
        platforms: warehouseResult.platforms,
        queryRangeDays: Math.ceil(dateRangeDays),
      },
      asOf: warehouseResult.asOf,
      freshness: warehouseResult.freshness,
    };
    
    if (canCache && cacheKey) {
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
