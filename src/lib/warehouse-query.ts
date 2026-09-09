import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

const DEFAULT_LIMIT = 1_000;
const HARD_LIMIT = 100_000;
const STALE_AFTER_MS = 26 * 60 * 60 * 1_000;
export type ScopedTransaction = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export type WarehouseFreshnessStatus = "fresh" | "stale" | "refreshing" | "failed" | "never" | "unavailable";

export interface WarehouseQueryInput {
  workspaceId: string;
  clientId?: string;
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

/**
 * Returns the provider/account tuples that must not appear in the workspace's
 * unassigned view. Explicit assignments own a tuple across every root. Legacy
 * client links keep their metric tuples owned until that client is cut over.
 *
 * This intentionally does not gate rows on Connection.clientId: explicit
 * unassignment retains that legacy pointer, while its removed tuple must become
 * discoverable again. Conversely, an alternate MCC copy of an owned tuple must
 * not appear as a second assignable account.
 */
export async function getUnassignedTupleExclusions(
  workspaceId: string,
  db: ScopedTransaction = prisma,
): Promise<Array<{ platform: string; accountId: string }>> {
  const [assignments, legacyConnections] = await Promise.all([
    db.clientProviderAccountAssignment.findMany({
      where: { workspaceId },
      select: { provider: true, accountId: true },
    }),
    db.connection.findMany({
      where: {
        workspaceId,
        type: "source",
        clientId: { not: null },
        client: { accountAssignmentsConfiguredAt: null },
      },
      select: { id: true },
    }),
  ]);

  const legacyConnectionIds = legacyConnections.map((connection) => connection.id);
  const legacyMetricTuples = legacyConnectionIds.length === 0
    ? []
    : await db.campaignMetric.findMany({
      where: { workspaceId, connectionId: { in: legacyConnectionIds } },
      distinct: ["platform", "accountId"],
      select: { platform: true, accountId: true },
    });

  const uniqueTuples = new Map<string, { platform: string; accountId: string }>();
  for (const assignment of assignments) {
    uniqueTuples.set(`${assignment.provider}:${assignment.accountId}`, {
      platform: assignment.provider,
      accountId: assignment.accountId,
    });
  }
  for (const tuple of legacyMetricTuples) {
    uniqueTuples.set(`${tuple.platform}:${tuple.accountId}`, tuple);
  }
  return [...uniqueTuples.values()];
}

export function unassignedTupleFilter(
  exclusions: Array<{ platform: string; accountId: string }>,
): Pick<Prisma.CampaignMetricWhereInput, "NOT"> {
  return exclusions.length === 0
    ? {}
    : { NOT: exclusions.map((tuple) => ({ platform: tuple.platform, accountId: tuple.accountId })) };
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

async function queryWarehouseInSnapshot(input: WarehouseQueryInput, db: ScopedTransaction) {
  const take = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), HARD_LIMIT);
  const where: Prisma.CampaignMetricWhereInput = { workspaceId: input.workspaceId };
  let clientAuthoritativeConnectionIds: string[] | null = null;
  let ownershipMode: "workspace" | "unassigned" | "legacy" | "explicit" = "workspace";

  if (input.clientId === "unassigned") {
    ownershipMode = "unassigned";
    Object.assign(where, unassignedTupleFilter(
      await getUnassignedTupleExclusions(input.workspaceId, db),
    ));
  } else if (input.clientId) {
    const client = await db.client.findFirst({
      where: { id: input.clientId, workspaceId: input.workspaceId },
      select: { id: true, accountAssignmentsConfiguredAt: true },
    });

    const isExplicit = client?.accountAssignmentsConfiguredAt != null;

    if (isExplicit) {
      ownershipMode = "explicit";
      const assignments = await db.clientProviderAccountAssignment.findMany({
        where: {
          workspaceId: input.workspaceId,
          clientId: input.clientId,
        },
        select: {
          provider: true,
          accountId: true,
          connectionId: true,
        },
      });

      if (assignments.length > 0) {
        clientAuthoritativeConnectionIds = [...new Set(assignments.map((a) => a.connectionId))];
        where.OR = assignments.map((a) => ({
          connectionId: a.connectionId,
          platform: a.provider,
          accountId: a.accountId,
        }));
      } else {
        where.id = { in: [] };
        clientAuthoritativeConnectionIds = [];
      }
    } else {
      ownershipMode = "legacy";
      const legacyConnections = await db.connection.findMany({
        where: { workspaceId: input.workspaceId, clientId: input.clientId, type: "source" },
        select: { id: true },
      });
      clientAuthoritativeConnectionIds = legacyConnections.map((connection) => connection.id);
      where.connectionId = { in: clientAuthoritativeConnectionIds };
    }
  }

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

  const [foundRows, totalCount, asOfAggregate, dateRangeAggregate, platformRows, lastSyncAggregate, latestJob] = await Promise.all([
    db.campaignMetric.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      ...(!decodedCursor && input.offset ? { skip: input.offset } : {}),
      take: take + 1,
    }),
    input.includeTotalCount ? db.campaignMetric.count({ where: countWhere }) : Promise.resolve(undefined),
    db.campaignMetric.aggregate({ where: countWhere, _max: { pulledAt: true } }),
    db.campaignMetric.aggregate({ where: countWhere, _min: { date: true }, _max: { date: true } }),
    db.campaignMetric.findMany({ where: countWhere, distinct: ["platform"], select: { platform: true }, take: 50 }),
    ownershipMode === "explicit" || ownershipMode === "unassigned"
      ? Promise.resolve({ _max: { lastSyncAt: null as Date | null } })
      : db.connection.aggregate({
          where: {
            workspaceId: input.workspaceId,
            ...(ownershipMode === "legacy" ? { clientId: input.clientId, type: "source" } : {}),
          },
          _max: { lastSyncAt: true },
        }),
    ownershipMode === "explicit" || ownershipMode === "unassigned"
      ? Promise.resolve(null)
      : db.syncJob.findFirst({
          where: {
            pipeline: {
              workspaceId: input.workspaceId,
              ...(ownershipMode === "legacy"
                ? {
                    OR: [
                      { clientId: input.clientId },
                      ...(clientAuthoritativeConnectionIds?.length
                        ? [{ sourceConnectionId: { in: clientAuthoritativeConnectionIds } }]
                        : []),
                    ],
                  }
                : {}),
            },
          },
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

  const jobAttribution = ownershipMode === "explicit" || ownershipMode === "unassigned"
    ? "unavailable"
    : "available";
  const freshnessClock = jobAttribution === "available" ? lastSyncAt : asOf;
  let freshnessStatus: WarehouseFreshnessStatus = jobAttribution === "unavailable" && !asOf ? "unavailable" : "never";
  if (latestJob?.status === "running" || latestJob?.status === "queued") freshnessStatus = "refreshing";
  else if (latestJob?.status === "failed") freshnessStatus = "failed";
  else if (freshnessClock) freshnessStatus = Date.now() - freshnessClock.getTime() > STALE_AFTER_MS ? "stale" : "fresh";

  return {
    rows,
    pagination: {
      nextCursor: hasMore && last ? encodeCursor(last) : null,
      hasMore,
      returned: rows.length,
    },
    totalCount,
    asOf,
    dateRange: {
      earliest: dateRangeAggregate._min.date,
      latest: dateRangeAggregate._max.date,
    },
    platforms: platformRows.map((row) => row.platform),
    freshness: {
      status: freshnessStatus,
      lastSyncAt,
      jobAttribution,
      latestJobId: latestJob?.id ?? null,
      latestJobStatus: latestJob?.status ?? null,
      retryable: latestJob?.status === "failed",
    },
  };
}

/**
 * Keep cutover-marker, assignment, rows and metadata reads in one snapshot.
 * Callers already inside a transaction pass it explicitly to avoid nesting.
 */
export async function queryWarehouse(input: WarehouseQueryInput, db?: ScopedTransaction) {
  if (db) return queryWarehouseInSnapshot(input, db);
  return prisma.$transaction(
    (tx) => queryWarehouseInSnapshot(input, tx as ScopedTransaction),
    { isolationLevel: "RepeatableRead" },
  );
}
