import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { withDatabaseTenantContext } from "./database-tenant-context";
import { normalizeMetaAdName } from "@/lib/meta-sync-lock";
import { getCanonicalDateRange } from "@/lib/warehouse-date-range";
import { buildAccountFilterPredicate, appendWherePredicate } from "@/lib/warehouse-account-filter";

const DEFAULT_LIMIT = 1_000;
export const HARD_LIMIT = 100_000;
const STALE_AFTER_MS = 26 * 60 * 60 * 1_000;
export const SUPPORTED_REPORT_LEVELS = ["ad", "adset", "campaign", "account"] as const;
export type WarehouseReportLevel = (typeof SUPPORTED_REPORT_LEVELS)[number];

export function isSupportedReportLevel(value: string): value is WarehouseReportLevel {
  return (SUPPORTED_REPORT_LEVELS as readonly string[]).includes(value);
}
/**
 * Interactive-transaction budget for one consistent warehouse snapshot read.
 * Prisma defaults interactive transactions to five seconds, which a large
 * export (up to HARD_LIMIT rows plus the count, aggregate and metadata reads
 * sharing the same deadline) can exceed under load — failing the whole read
 * closed. Mirrors the established heavier-transaction budget used elsewhere
 * in the repo. Callers that already hold a transaction pass it explicitly and
 * bypass this wrapper entirely.
 */
export const WAREHOUSE_SNAPSHOT_TIMEOUT_MS = 20_000;
export const WAREHOUSE_SNAPSHOT_MAX_WAIT_MS = 10_000;
export type ScopedTransaction = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export type WarehouseFreshnessStatus = "fresh" | "stale" | "refreshing" | "failed" | "never" | "unavailable";

export interface WarehouseQueryInput {
  workspaceId: string;
  clientId?: string;
  startDate?: Date;
  endDate?: Date;
  platforms?: string[];
  /** `ad` filters stored rows; higher levels are grouped from the same filtered tenant scope. */
  level?: WarehouseReportLevel;
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
    return normalizeMetaAdName((parsed as Record<string, unknown>).ad_name);
  } catch {
    return null;
  }
}

/**
 * Promoted-first ad name resolution. The writer normalizes empty values to
 * NULL, so an empty-string promoted value also falls back (it can never be a
 * valid legacy output). Explicit nullish checks — never truthiness.
 */
export function resolveWarehouseAdName(
  promotedAdName: string | null | undefined,
  rawData: string | null | undefined,
): string | null {
  if (promotedAdName != null && promotedAdName !== "") return promotedAdName;
  return adNameFromRawData(rawData ?? null);
}

/**
 * Intersect a caller-supplied connection filter with an authoritative client
 * scope. The scope is built first and independently; this combiner never
 * broadens it. In particular a legacy scope of `in: []` (legacy-empty) stays
 * empty no matter which concrete connection the caller supplies.
 */
export function intersectConnectionScope(
  scopeConnectionIds: readonly string[] | null,
  requestedConnectionId: string | undefined,
): { in: string[] } | string | undefined {
  if (requestedConnectionId === undefined) {
    return scopeConnectionIds === null ? undefined : { in: [...scopeConnectionIds] };
  }
  if (scopeConnectionIds === null) return requestedConnectionId;
  return scopeConnectionIds.includes(requestedConnectionId) ? requestedConnectionId : { in: [] };
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
    }
  }

  // Authoritative scope and optional caller filters are built independently
  // and combined by intersection below. A caller filter may only narrow the
  // scope: it can never replace `in: []` (legacy-empty) or widen the legacy
  // connection set. Explicit scope is tuple-based (`OR`), so an additional
  // connection predicate only narrows it.
  if (ownershipMode === "legacy") {
    const narrowed = intersectConnectionScope(clientAuthoritativeConnectionIds, input.connectionId);
    if (narrowed !== undefined) where.connectionId = narrowed;
  } else if (input.connectionId) {
    where.connectionId = input.connectionId;
  }

  if (input.startDate && input.endDate) {
    const canonical = getCanonicalDateRange(input.startDate, input.endDate);
    where.date = canonical.dbWhereDate;
  } else if (input.startDate) {
    where.date = { gte: input.startDate };
  } else if (input.endDate) {
    where.date = { lte: input.endDate };
  }

  if (input.platforms?.length) where.platform = { in: input.platforms };
  if (input.level === "ad") where.level = "ad";

  if (input.accountIds?.length) {
    const accountPredicate = buildAccountFilterPredicate({
      accountIds: input.accountIds,
      platforms: input.platforms,
    });
    appendWherePredicate(where, accountPredicate);
  }
  if (input.campaignId) where.campaignId = input.campaignId;

  const countWhere = { ...where };
  if (Array.isArray(where.AND)) {
    countWhere.AND = [...where.AND];
  }

  if (input.level && input.level !== "ad") {
    const dimensionFields: Prisma.CampaignMetricScalarFieldEnum[] = input.level === "account"
      ? []
      : input.level === "campaign"
        ? ["campaignId"]
        : ["campaignId", "adsetId"];
    const aggregateWhere: Prisma.CampaignMetricWhereInput = { ...countWhere };
    const aggregateConditions = Array.isArray(aggregateWhere.AND)
      ? aggregateWhere.AND
      : aggregateWhere.AND ? [aggregateWhere.AND] : [];
    if (input.level === "campaign") {
      aggregateWhere.AND = [...aggregateConditions, { campaignId: { not: "" } }];
    } else if (input.level === "adset") {
      aggregateWhere.AND = [...aggregateConditions, { adsetId: { not: null } }, { NOT: { adsetId: "" } }];
    }
    const by: Prisma.CampaignMetricScalarFieldEnum[] = [
      "connectionId", "platform", "accountId", "date", "currency", ...dimensionFields,
    ];
    const [groups, asOfAggregate, dateRangeAggregate, platformRows, lastSyncAggregate, latestJob] = await Promise.all([
      db.campaignMetric.groupBy({
        by,
        where: aggregateWhere,
        _sum: { impressions: true, clicks: true, spend: true, conversions: true, revenue: true },
        _max: { accountName: true, campaignName: true, adsetName: true, pulledAt: true },
        orderBy: [{ date: "desc" }, { accountId: "asc" }, { platform: "asc" }, { currency: "asc" }],
        take: take + 1,
      }),
      db.campaignMetric.aggregate({ where: aggregateWhere, _max: { pulledAt: true } }),
      db.campaignMetric.aggregate({ where: aggregateWhere, _min: { date: true }, _max: { date: true } }),
      db.campaignMetric.findMany({ where: aggregateWhere, distinct: ["platform"], select: { platform: true }, take: 50 }),
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

    const hasMore = groups.length > take;
    const rows = groups.slice(0, take).map((group) => {
      const impressions = group._sum.impressions ?? 0;
      const clicks = group._sum.clicks ?? 0;
      const spend = group._sum.spend ?? 0;
      const revenue = group._sum.revenue ?? 0;
      const dimensionId = input.level === "account" ? group.accountId
        : input.level === "campaign" ? group.campaignId
          : group.adsetId ?? "";
      return {
        id: `aggregate:${input.level}:${group.connectionId}:${group.accountId}:${group.date.toISOString()}:${dimensionId}:${group.currency ?? "unknown"}`,
        workspaceId: input.workspaceId,
        connectionId: group.connectionId,
        platform: group.platform,
        accountId: group.accountId,
        accountName: group._max.accountName,
        level: input.level,
        entityId: dimensionId,
        campaignId: input.level === "campaign" || input.level === "adset" ? group.campaignId : "",
        campaignName: input.level === "campaign" || input.level === "adset" ? group._max.campaignName ?? "" : "",
        adsetId: input.level === "adset" ? group.adsetId : null,
        adsetName: input.level === "adset" ? group._max.adsetName : null,
        adId: null,
        adName: null,
        date: group.date,
        breakdownHash: "none",
        impressions,
        clicks,
        // Reach is not additive across ads or ad sets. It is omitted at
        // synthesized grains so the API cannot present a false unique reach.
        reach: null,
        spend,
        cpc: clicks > 0 ? spend / clicks : 0,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        conversions: group._sum.conversions ?? 0,
        revenue,
        roas: spend > 0 ? revenue / spend : 0,
        currency: group.currency,
        rawData: null,
        syncJobId: null,
        lockScope: null,
        pulledAt: group._max.pulledAt ?? group.date,
        createdAt: group.date,
        updatedAt: group.date,
      };
    });

    const lastSyncAt = lastSyncAggregate._max.lastSyncAt;
    const asOf = asOfAggregate._max.pulledAt;
    const jobAttribution = ownershipMode === "explicit" || ownershipMode === "unassigned" ? "unavailable" : "available";
    const freshnessClock = jobAttribution === "available" ? lastSyncAt : asOf;
    let freshnessStatus: WarehouseFreshnessStatus = jobAttribution === "unavailable" && !asOf ? "unavailable" : "never";
    if (latestJob?.status === "running" || latestJob?.status === "queued") freshnessStatus = "refreshing";
    else if (latestJob?.status === "failed") freshnessStatus = "failed";
    else if (freshnessClock) freshnessStatus = Date.now() - freshnessClock.getTime() > STALE_AFTER_MS ? "stale" : "fresh";

    return {
      rows,
      pagination: { nextCursor: null, hasMore, returned: rows.length },
      totalCount: undefined,
      asOf,
      dateRange: { earliest: dateRangeAggregate._min.date, latest: dateRangeAggregate._max.date },
      platforms: platformRows.map((row) => row.platform),
      freshness: {
        status: freshnessStatus,
        lastSyncAt,
        jobAttribution,
        latestJobId: latestJob?.id ?? null,
        latestJobStatus: latestJob?.status ?? null,
        retryable: latestJob?.status === "failed",
      },
      aggregatedLevel: input.level,
    };
  }

  const decodedCursor = input.cursor ? decodeCursor(input.cursor) : null;
  if (decodedCursor) {
    const cursorPredicate = {
      OR: [
        { date: { lt: decodedCursor.date } },
        { date: decodedCursor.date, id: { lt: decodedCursor.id } },
      ],
    };
    if (Array.isArray(where.AND)) {
      where.AND = [...where.AND, cursorPredicate];
    } else if (where.AND) {
      where.AND = [where.AND, cursorPredicate];
    } else {
      where.AND = [cursorPredicate];
    }
  }


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
    // `ad_name` is a Meta source field promoted to the `adName` column by new
    // ingestion. Prefer it; legacy rows (adName NULL) still derive it from
    // rawData, and rows with neither render null.
    return { ...visibleRow, adName: resolveWarehouseAdName(visibleRow.adName, visibleRow.rawData) };
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
  return withDatabaseTenantContext(prisma, input.workspaceId,
    (tx) => queryWarehouseInSnapshot(input, tx as ScopedTransaction),
    {
      isolationLevel: "RepeatableRead",
      timeout: WAREHOUSE_SNAPSHOT_TIMEOUT_MS,
      maxWait: WAREHOUSE_SNAPSHOT_MAX_WAIT_MS,
    },
  );
}
