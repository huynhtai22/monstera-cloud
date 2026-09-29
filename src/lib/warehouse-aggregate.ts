import prisma from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plan-config";
import {
  ADS_DIMENSIONS,
  ADS_METRICS,
  ADS_CALCULATED_METRICS,
  ADS_FIELDS_BY_ID,
} from "@/lib/ads-field-registry";
import { aggregationNeedsCurrencyDimension } from "@/lib/currency-safe-aggregation";
import { getUnassignedTupleExclusions, unassignedTupleFilter } from "@/lib/warehouse-query";
import { getCanonicalDateRange } from "@/lib/warehouse-date-range";
import { buildAccountFilterPredicate, appendWherePredicate } from "@/lib/warehouse-account-filter";

export type WarehouseAggregateSpec = {
  workspaceId: string;
  clientId?: string;
  startDateStr: string;
  endDateStr: string;
  platform?: string | null;
  platforms?: string[] | null;
  accountId?: string | null;
  accountIds?: string[] | null;
  campaignId?: string | null;
  dimensions?: string[];
  metrics?: string[];
  plan?: string;
  strictReporting?: boolean;
};

export type WarehouseAggregateResult = {
  mode: "aggregate";
  columns: string[];
  rows: Record<string, unknown>[];
  truncated?: boolean;
  fullTotals?: Record<string, number | null>;
  limits: {
    plan: string;
    maxDateRangeDays: number;
    maxRowsPerQuery: number;
    truncated?: boolean;
  };
  selection: { dimensions: string[]; metrics: string[] };
};

type MetricWhereClause = {
  workspaceId: string;
  id?: { in: string[] };
  connection?: { workspaceId: string; clientId?: string | null };
  OR?: Array<{ connectionId: string; platform: string; accountId: string }>;
  NOT?: Array<{ platform: string; accountId: string }>;
  date?: { gte?: Date; lte?: Date };
  platform?: string | { in: string[] };
  accountId?: string | { in: string[] };
  campaignId?: string;
};

const allowedDimIds = new Set(ADS_DIMENSIONS.map((d) => d.id));
const allowedMetricIds = new Set([
  ...ADS_METRICS.map((m) => m.id),
  ...ADS_CALCULATED_METRICS.map((m) => m.id),
]);

/**
 * Canonical aggregate path used by GET /api/metrics/query and AI query_metrics.
 * Allowlisted ADS_FIELDS_BY_ID only. Does not return rawData.
 */
export async function queryMetricsAggregate(spec: WarehouseAggregateSpec): Promise<WarehouseAggregateResult> {
  const plan = spec.plan ?? "free";
  const limits = getPlanLimits(plan);
  const where: MetricWhereClause = { workspaceId: spec.workspaceId };
  if (spec.clientId === "unassigned") {
    Object.assign(where, unassignedTupleFilter(
      await getUnassignedTupleExclusions(spec.workspaceId),
    ));
  } else if (spec.clientId) {
    const client = await prisma.client.findFirst({
      where: { id: spec.clientId, workspaceId: spec.workspaceId },
      select: { id: true, accountAssignmentsConfiguredAt: true },
    });
    const isExplicit = client?.accountAssignmentsConfiguredAt != null;
    if (isExplicit) {
      const assignments = await prisma.clientProviderAccountAssignment.findMany({
        where: { workspaceId: spec.workspaceId, clientId: spec.clientId },
        select: { provider: true, accountId: true, connectionId: true },
      });
      if (assignments.length > 0) {
        where.OR = assignments.map((a) => ({
          connectionId: a.connectionId,
          platform: a.provider,
          accountId: a.accountId,
        }));
      } else {
        where.id = { in: [] };
      }
    } else {
      where.connection = { workspaceId: spec.workspaceId, clientId: spec.clientId };
    }
  }

  const canonical = getCanonicalDateRange(spec.startDateStr, spec.endDateStr);
  where.date = canonical.dbWhereDate;

  if (spec.platforms?.length) {
    where.platform = spec.platforms.length === 1 ? spec.platforms[0] : { in: spec.platforms };
  } else if (spec.platform) {
    where.platform = spec.platform;
  }

  const accountPredicate = buildAccountFilterPredicate({
    accountIds: spec.accountIds,
    accountId: spec.accountId,
    platforms: spec.platforms,
    platform: spec.platform,
  });
  appendWherePredicate(where, accountPredicate);

  if (spec.campaignId) where.campaignId = spec.campaignId;


  let dimensions = (spec.dimensions?.length ? spec.dimensions : ["date", "platform"]).filter((id) =>
    allowedDimIds.has(id),
  );
  const metrics = (spec.metrics?.length ? spec.metrics : ["spend", "impressions"]).filter((id) =>
    allowedMetricIds.has(id),
  );

  if (aggregationNeedsCurrencyDimension(dimensions, metrics) && allowedDimIds.has("currency")) {
    dimensions = [...dimensions, "currency"];
  }
  if (dimensions.length === 0) {
    throw new Error("At least one stable dimension is required.");
  }
  if (metrics.length === 0) {
    throw new Error("At least one metric is required.");
  }

  const by = dimensions
    .map((id) => ADS_FIELDS_BY_ID[id]?.prismaField)
    .filter(Boolean) as string[];
  if (by.length === 0) {
    throw new Error("No supported dimensions for aggregation.");
  }

  const sumFields: Record<string, boolean> = {};
  for (const id of metrics) {
    const f = ADS_FIELDS_BY_ID[id] as { kind?: string; isCalculatedMetric?: boolean; requires?: string[]; prismaField?: string } | undefined;
    if (!f || f.kind !== "metric") continue;
    if (f.isCalculatedMetric) {
      for (const dep of f.requires ?? []) {
        const depField = ADS_FIELDS_BY_ID[dep] as { prismaField?: string } | undefined;
        if (depField?.prismaField) sumFields[depField.prismaField] = true;
      }
      continue;
    }
    if (f.prismaField) sumFields[f.prismaField] = true;
  }
  if (Object.keys(sumFields).length === 0) {
    sumFields.spend = true;
    sumFields.impressions = true;
  }

  const orderBy = by.includes("date")
    ? [
        { date: "desc" as const },
        ...by.filter((f) => f !== "date").map((f) => ({ [f]: "asc" as const })),
      ]
    : by.map((f) => ({ [f]: "asc" as const }));

  const rows = await prisma.campaignMetric.groupBy({
    where,
    by: by as ["date"],
    ...(Object.keys(sumFields).length ? { _sum: sumFields } : {}),
    take: limits.explorerMaxRowsPerQuery,
    orderBy: orderBy as unknown as { date?: "asc" | "desc" }[],
  });

  const truncated = rows.length >= limits.explorerMaxRowsPerQuery;

  let fullTotals: Record<string, number | null> | undefined;
  if (spec.strictReporting) {
    const agg = await prisma.campaignMetric.aggregate({
      where,
      _sum: sumFields,
    });
    fullTotals = {};
    for (const [k, v] of Object.entries(agg._sum ?? {})) {
      fullTotals[k] = v != null ? Number(v) : null;
    }
  }

  const safeDiv = (num: number, den: number): number | null => {
    if (den === 0) return spec.strictReporting ? null : 0;
    return num / den;
  };
  const outRows = rows.map((r) => {
    const obj: Record<string, unknown> = {};
    const rec = r as Record<string, unknown> & { _sum?: Record<string, number | null> };
    for (const dimId of dimensions) {
      const prismaField = ADS_FIELDS_BY_ID[dimId]?.prismaField;
      if (!prismaField) {
        obj[dimId] = "";
        continue;
      }
      const val = rec[prismaField];
      obj[dimId] =
        prismaField === "date" && val instanceof Date ? val.toISOString().slice(0, 10) : val ?? "";
    }
    for (const metricId of metrics) {
      const field = ADS_FIELDS_BY_ID[metricId] as { kind?: string; isCalculatedMetric?: boolean; prismaField?: string } | undefined;
      if (!field || field.kind !== "metric") {
        obj[`metric:${metricId}`] = spec.strictReporting ? null : 0;
        continue;
      }
      if (field.isCalculatedMetric) {
        const sum = (name: string) => Number(rec._sum?.[name] ?? 0);
        switch (metricId) {
          case "ctr":
            obj[`metric:${metricId}`] = safeDiv(sum("clicks"), sum("impressions"));
            break;
          case "cpc":
            obj[`metric:${metricId}`] = safeDiv(sum("spend"), sum("clicks"));
            break;
          case "cpm": {
            const ratio = safeDiv(sum("spend"), sum("impressions"));
            obj[`metric:${metricId}`] = ratio != null ? ratio * 1000 : null;
            break;
          }
          case "cvr":
            obj[`metric:${metricId}`] = safeDiv(sum("conversions"), sum("clicks"));
            break;
          case "cpa":
            obj[`metric:${metricId}`] = safeDiv(sum("spend"), sum("conversions"));
            break;
          case "roas":
            obj[`metric:${metricId}`] = safeDiv(sum("revenue"), sum("spend"));
            break;
          case "frequency":
            obj[`metric:${metricId}`] = safeDiv(sum("impressions"), sum("reach"));
            break;
          default:
            obj[`metric:${metricId}`] = spec.strictReporting ? null : 0;
        }
        continue;
      }
      const prismaField = field.prismaField;
      const rawSum = rec._sum?.[prismaField ?? ""];
      obj[`metric:${metricId}`] = rawSum != null ? Number(rawSum) : (spec.strictReporting ? null : 0);
    }
    return obj;
  });

  return {
    mode: "aggregate",
    columns: [...dimensions, ...metrics.map((m) => `metric:${m}`)],
    rows: outRows,
    truncated,
    fullTotals,
    limits: {
      plan,
      maxDateRangeDays: limits.explorerMaxDateRangeDays,
      maxRowsPerQuery: limits.explorerMaxRowsPerQuery,
      truncated,
    },
    selection: { dimensions, metrics },
  };
}
