import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

const DEFAULT_LIMIT = 1_000;
const HARD_LIMIT = 100_000;
const STALE_AFTER_MS = 26 * 60 * 60 * 1_000;

export type WarehouseFreshnessStatus = "fresh" | "stale" | "refreshing" | "failed" | "never";

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
    return visibleRow;
  });
  const last = rows.at(-1);
  const lastSyncAt = lastSyncAggregate._max.lastSyncAt;
  const asOf = asOfAggregate._max.pulledAt;

  let freshnessStatus: WarehouseFreshnessStatus = "never";
  if (latestJob?.status === "running" || latestJob?.status === "queued") freshnessStatus = "refreshing";
  else if (latestJob?.status === "failed") freshnessStatus = "failed";
  else if (lastSyncAt) freshnessStatus = Date.now() - lastSyncAt.getTime() > STALE_AFTER_MS ? "stale" : "fresh";

  return {
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
