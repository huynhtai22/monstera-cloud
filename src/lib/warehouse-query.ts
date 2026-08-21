import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

const DEFAULT_LIMIT = 1_000;
const HARD_LIMIT = 100_000;
const STALE_AFTER_MS = 26 * 60 * 60 * 1_000;

export type WarehouseFreshnessStatus = "fresh" | "stale" | "refreshing" | "failed" | "never";

/**
 * Report levels the delivery APIs understand. `ad` returns raw stored rows;
 * `adset`/`campaign`/`account` are true SQL group-by aggregations over the same
 * filtered scope (currency is part of the group key — no cross-currency
 * blending). Unknown levels must be rejected, never silently ignored.
 */
export const SUPPORTED_REPORT_LEVELS = ["ad", "adset", "campaign", "account"] as const;
export type WarehouseReportLevel = (typeof SUPPORTED_REPORT_LEVELS)[number];

export function isSupportedReportLevel(value: string): value is WarehouseReportLevel {
  return (SUPPORTED_REPORT_LEVELS as readonly string[]).includes(value);
}

export interface WarehouseQueryInput {
  workspaceId: string;
  startDate?: Date;
  endDate?: Date;
  platforms?: string[];
  accountIds?: string[];
  campaignId?: string;
  connectionId?: string;
  cursor?: string | null;
  offset?: number;
  limit?: number;
  includeTotalCount?: boolean;
  /** When set: "ad" filters raw ad rows; other levels aggregate. Omit = all rows (legacy). */
  level?: WarehouseReportLevel;
}

function decodeCursor(cursor: string): { date: Date; id: string } | null {
  try {
    const decoded = decodeURIComponent(cursor);
    const separator = decoded.lastIndexOf("|");
    if (separator < 1) return null;
    const date = new Date(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (!id || Number.isNaN(date.getTime())) return null;
    return { date, id };
  } catch {
    return null;
  }
}

function encodeCursor(row: { date: Date; id: string }): string {
  return encodeURIComponent(`${row.date.toISOString()}|${row.id}`);
}

function adNameFromRawData(rawData: string | null): string | null {
  if (!rawData) return null;
  try {
    const parsed: unknown = JSON.parse(rawData);
    if (!parsed || typeof parsed !== "object") return null;
    const adName = (parsed as Record<string, unknown>).ad_name;
    return typeof adName === "string" && adName.trim() ? adName : null;
  } catch {
    return null;
  }
}

export async function queryWarehouse(input: WarehouseQueryInput) {
  const take = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), HARD_LIMIT);
  const where: Prisma.CampaignMetricWhereInput = { workspaceId: input.workspaceId };

  if (input.startDate || input.endDate) {
    where.date = {
      ...(input.startDate ? { gte: input.startDate } : {}),
      ...(input.endDate ? { lte: input.endDate } : {}),
    };
  }
  if (input.platforms?.length) where.platform = { in: input.platforms };
  if (input.accountIds?.length) where.accountId = { in: input.accountIds };
  if (input.campaignId) where.campaignId = input.campaignId;
  if (input.connectionId) where.connectionId = input.connectionId;
  if (input.level === "ad") where.level = "ad";

  const decodedCursor = input.cursor ? decodeCursor(input.cursor) : null;
  if (decodedCursor) {
    where.AND = [
      {
        OR: [
          { date: { lt: decodedCursor.date } },
          { date: decodedCursor.date, id: { lt: decodedCursor.id } },
        ],
      },
    ];
  }

  const countWhere = { ...where };
  delete countWhere.AND;

  // Aggregated report levels: one row per (platform, account, date, currency,
  // dimension) with summed additive metrics and ratio metrics recomputed from
  // the sums. No cursor pagination at aggregated levels (bounded by `take`).
  if (input.level && input.level !== "ad") {
    const dimensionField =
      input.level === "adset" ? "adsetId" :
      input.level === "campaign" ? "campaignId" : "accountId";
    const aggWhere: Prisma.CampaignMetricWhereInput = { ...countWhere };
    if (input.level === "adset") {
      aggWhere.AND = [
        { adsetId: { not: null } },
        { adsetId: { not: "" } },
      ];
    }
    if (input.level === "campaign") {
      aggWhere.AND = [
        ...(aggWhere.AND as Prisma.CampaignMetricWhereInput[] ?? []),
        { campaignId: { not: "" } },
      ];
    }

    const [groups, asOfAgg, lastSyncAgg, latestJobAgg] = await Promise.all([
      prisma.campaignMetric.groupBy({
        by: ["platform", "accountId", "date", "currency", dimensionField as "campaignId"],
        where: aggWhere,
        _sum: {
          impressions: true, clicks: true, spend: true, reach: true,
          conversions: true, revenue: true,
        },
        _max: { accountName: true, campaignName: true, adsetName: true, pulledAt: true },
        orderBy: { date: "desc" },
        take,
      }),
      prisma.campaignMetric.aggregate({ where: countWhere, _max: { pulledAt: true } }),
      prisma.connection.aggregate({ where: { workspaceId: input.workspaceId }, _max: { lastSyncAt: true } }),
      prisma.syncJob.findFirst({
        where: { pipeline: { workspaceId: input.workspaceId } },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, finishedAt: true, errorMsg: true },
      }),
    ]);

    const aggRows = groups.map((g) => {
      const impressions = g._sum.impressions ?? 0;
      const clicks = g._sum.clicks ?? 0;
      const spend = g._sum.spend ?? 0;
      const revenue = g._sum.revenue ?? 0;
      const dimensionValue = (g as Record<string, unknown>)[dimensionField] as string;
      return {
        id: "",
        workspaceId: input.workspaceId,
        connectionId: "",
        platform: g.platform,
        accountId: g.accountId,
        accountName: g._max.accountName,
        level: input.level,
        entityId: dimensionValue,
        campaignId: input.level === "campaign" ? dimensionValue : input.level === "account" ? "" : "",
        campaignName: input.level === "campaign" ? g._max.campaignName ?? "" : "",
        adsetId: input.level === "adset" ? dimensionValue : null,
        adsetName: input.level === "adset" ? g._max.adsetName : null,
        adId: null,
        date: g.date,
        breakdownHash: "none",
        impressions,
        clicks,
        spend,
        reach: g._sum.reach ?? 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        conversions: g._sum.conversions ?? 0,
        revenue,
        roas: spend > 0 ? revenue / spend : 0,
        currency: g.currency,
        rawData: null,
        syncJobId: null,
        lockScope: null,
        pulledAt: g._max.pulledAt ?? g.date,
        createdAt: g.date,
        updatedAt: g.date,
        adName: null,
      };
    });

    const lastSyncAtAgg = lastSyncAgg._max.lastSyncAt;
    let aggFreshness: WarehouseFreshnessStatus = "never";
    if (latestJobAgg?.status === "running" || latestJobAgg?.status === "queued") aggFreshness = "refreshing";
    else if (latestJobAgg?.status === "failed") aggFreshness = "failed";
    else if (lastSyncAtAgg) aggFreshness = Date.now() - lastSyncAtAgg.getTime() > STALE_AFTER_MS ? "stale" : "fresh";

    return {
      rows: aggRows,
      pagination: { nextCursor: null, hasMore: false, returned: aggRows.length },
      totalCount: undefined,
      asOf: asOfAgg._max.pulledAt,
      freshness: {
        status: aggFreshness,
        lastSyncAt: lastSyncAtAgg,
        latestJobId: latestJobAgg?.id ?? null,
        latestJobStatus: latestJobAgg?.status ?? null,
        retryable: latestJobAgg?.status === "failed",
      },
      aggregatedLevel: input.level,
    };
  }

  const [foundRows, totalCount, asOfAggregate, lastSyncAggregate, latestJob] = await Promise.all([
    prisma.campaignMetric.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      ...(!decodedCursor && input.offset ? { skip: input.offset } : {}),
      take: take + 1,
    }),
    input.includeTotalCount ? prisma.campaignMetric.count({ where: countWhere }) : Promise.resolve(undefined),
    prisma.campaignMetric.aggregate({ where: countWhere, _max: { pulledAt: true } }),
    prisma.connection.aggregate({ where: { workspaceId: input.workspaceId }, _max: { lastSyncAt: true } }),
    prisma.syncJob.findFirst({
      where: { pipeline: { workspaceId: input.workspaceId } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, finishedAt: true, errorMsg: true },
    }),
  ]);

  const hasMore = foundRows.length > take;
  // `fencingToken` is an internal BigInt used only to protect writes from stale
  // workers. It is not a warehouse dimension or metric, and BigInt cannot be
  // serialized in a JSON response. Omit it at the query boundary so one Meta
  // import cannot make the entire warehouse read API return 500.
  const visibleRows = hasMore ? foundRows.slice(0, take) : foundRows;
  const rows = visibleRows.map((row) => {
    const { fencingToken, ...visibleRow } = row;
    void fencingToken;
    // `ad_name` is a Meta source field retained in rawData. Deriving it here
    // keeps existing production schema compatible while exposing the ad
    // dimension alongside the normalized ad set fields.
    return { ...visibleRow, adName: adNameFromRawData(visibleRow.rawData) };
  });
  const last = rows.at(-1);
  const lastSyncAt = lastSyncAggregate._max.lastSyncAt;
  const asOf = asOfAggregate._max.pulledAt;

  let freshnessStatus: WarehouseFreshnessStatus = "never";
  if (latestJob?.status === "running" || latestJob?.status === "queued") freshnessStatus = "refreshing";
  else if (latestJob?.status === "failed") freshnessStatus = "failed";
  else if (lastSyncAt) freshnessStatus = Date.now() - lastSyncAt.getTime() > STALE_AFTER_MS ? "stale" : "fresh";

  return {
    aggregatedLevel: undefined,
    rows,
    pagination: {
      nextCursor: hasMore && last ? encodeCursor(last) : null,
      hasMore,
      returned: rows.length,
    },
    totalCount,
    asOf,
    freshness: {
      status: freshnessStatus,
      lastSyncAt,
      latestJobId: latestJob?.id ?? null,
      latestJobStatus: latestJob?.status ?? null,
      retryable: latestJob?.status === "failed",
    },
  };
}
