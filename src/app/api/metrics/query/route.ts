import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plan-config";
import {
  ADS_DIMENSIONS,
  ADS_METRICS,
  ADS_CALCULATED_METRICS,
  ADS_FIELDS_BY_ID,
} from "@/lib/ads-field-registry";
import { getCachedQuery, setCachedQuery, generateCacheKey } from "@/lib/redis-cache";
import { requireWorkspaceAccess } from "@/lib/rbac";
import { queryWarehouse } from "@/lib/warehouse-query";

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
  const session = await getServerSession(authOptions);
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

  await requireWorkspaceAccess({
    userId: session.user.id,
    workspaceId,
    minimumRole: "viewer",
    operation: "query_metrics",
  });
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
  if (!startDate || !endDate) {
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

    where.date = {
      gte: startDate,
      lte: endDate,
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
      const dimIds =
        dimensionsParam?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
      const metricIds =
        metricsParam?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

      // Enforce stable dimensions: only allow canonical dimensions from registry.
      const allowedDimIds = new Set(ADS_DIMENSIONS.map((d) => d.id));
      const allowedMetricIds = new Set([
        ...ADS_METRICS.map((m) => m.id),
        ...ADS_CALCULATED_METRICS.map((m) => m.id),
      ]);

      const dimensions = (dimIds.length ? dimIds : ["date", "platform"]).filter((id) =>
        allowedDimIds.has(id),
      );
      const metrics = (metricIds.length ? metricIds : ["spend", "impressions"]).filter((id) =>
        allowedMetricIds.has(id),
      );

      if (dimensions.length === 0) {
        return NextResponse.json(
          { error: "At least one stable dimension is required." },
          { status: 400 },
        );
      }
      if (metrics.length === 0) {
        return NextResponse.json(
          { error: "At least one metric is required." },
          { status: 400 },
        );
      }

      // Dimensions map directly to DB fields; ignore any that lack backing storage.
      const by = dimensions
        .map((id) => ADS_FIELDS_BY_ID[id]?.prismaField)
        .filter(Boolean) as string[];

      if (by.length === 0) {
        return NextResponse.json(
          { error: "No supported dimensions for aggregation." },
          { status: 400 },
        );
      }

      const sumFields: Record<string, boolean> = {};
      const wantsCalculated = new Set<string>();

      // Always aggregate raw measurable components via SUM.
      // Calculated metrics are computed from the SUMs (never averaged directly).
      for (const id of metrics) {
        const f = ADS_FIELDS_BY_ID[id] as any;
        if (!f || f.kind !== "metric") continue;

        if (f.isCalculatedMetric) {
          wantsCalculated.add(id);
          // ensure required raw components are included in SUM
          for (const dep of (f.requires as string[] | undefined) ?? []) {
            const depField = ADS_FIELDS_BY_ID[dep] as any;
            if (depField?.prismaField) sumFields[depField.prismaField] = true;
          }
          continue;
        }

        if (f.prismaField) sumFields[f.prismaField] = true;
      }

      // Safety: if user only asked calculated metrics, still need sums.
      if (Object.keys(sumFields).length === 0) {
        sumFields.spend = true;
        sumFields.impressions = true;
      }

      // Grouped result set (no cursor pagination yet; keep bounded by plan limit).
      const rows = await prisma.campaignMetric.groupBy({
        where,
        by: by as any,
        ...(Object.keys(sumFields).length ? { _sum: sumFields as any } : {}),
        take: limits.explorerMaxRowsPerQuery,
        orderBy: [{ date: "desc" }] as any,
      });

      const columns = [
        ...dimensions,
        ...metrics.map((m) => `metric:${m}`),
      ];

      const safeDiv = (num: number, den: number) => (den === 0 ? 0 : num / den);

      const outRows = rows.map((r: any) => {
        const obj: Record<string, unknown> = {};
        for (const dimId of dimensions) {
          const prismaField = ADS_FIELDS_BY_ID[dimId]?.prismaField;
          if (!prismaField) {
            obj[dimId] = "";
            continue;
          }
          const val = r[prismaField];
          obj[dimId] =
            prismaField === "date" && val instanceof Date ? val.toISOString().slice(0, 10) : val ?? "";
        }
        for (const metricId of metrics) {
          const field = ADS_FIELDS_BY_ID[metricId] as any;
          if (!field || field.kind !== "metric") {
            obj[`metric:${metricId}`] = 0;
            continue;
          }

          if (field.isCalculatedMetric) {
            const sum = (name: string) => Number(r._sum?.[name] ?? 0);
            // Calculated metrics (computed from SUMs; never average averages).
            switch (metricId) {
              case "ctr": {
                obj[`metric:${metricId}`] = safeDiv(sum("clicks"), sum("impressions"));
                break;
              }
              case "cpc": {
                obj[`metric:${metricId}`] = safeDiv(sum("spend"), sum("clicks"));
                break;
              }
              case "cpm": {
                obj[`metric:${metricId}`] = safeDiv(sum("spend"), sum("impressions")) * 1000;
                break;
              }
              case "cvr": {
                obj[`metric:${metricId}`] = safeDiv(sum("conversions"), sum("clicks"));
                break;
              }
              case "cpa": {
                obj[`metric:${metricId}`] = safeDiv(sum("spend"), sum("conversions"));
                break;
              }
              case "roas": {
                // conversion_value is stored as `revenue` in DB
                obj[`metric:${metricId}`] = safeDiv(sum("revenue"), sum("spend"));
                break;
              }
              case "frequency": {
                obj[`metric:${metricId}`] = safeDiv(sum("impressions"), sum("reach"));
                break;
              }
              default: {
                obj[`metric:${metricId}`] = 0;
              }
            }
            continue;
          }

          const prismaField = field.prismaField as string | undefined;
          if (!prismaField) {
            obj[`metric:${metricId}`] = 0;
            continue;
          }

          obj[`metric:${metricId}`] = Number(r._sum?.[prismaField] ?? 0);
        }
        return obj;
      });

      const responseData = {
        mode: "aggregate",
        columns,
        rows: outRows,
        limits: {
          plan,
          maxDateRangeDays: limits.explorerMaxDateRangeDays,
          maxRowsPerQuery: limits.explorerMaxRowsPerQuery,
        },
        selection: { dimensions, metrics },
      };
      
      if (canCache) {
        await setCachedQuery(cacheKey, responseData, 300); // 5 min TTL
      }
      return NextResponse.json(responseData);
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
