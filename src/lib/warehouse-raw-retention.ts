import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { scopeCampaignMetricWhere } from "@/lib/workspace-scope";

export const RAW_RETENTION_POLICIES = [14, 30, 90] as const;
export type RawRetentionDays = (typeof RAW_RETENTION_POLICIES)[number];
export const RAW_RETENTION_STATEMENT_TIMEOUT_MS = 1_500;
export const DEFAULT_RAW_RETENTION_SAMPLE_SIZE = 200;
export const MAX_RAW_RETENTION_SAMPLE_SIZE = 1_000;
/** Maximum timed measurement statements per invocation: summary, per-platform, sample. */
export const RAW_RETENTION_MAX_TIMED_STATEMENTS = 3;
/** Orchestration buffer covering the instant set_config roundtrip and commit. */
export const RAW_RETENTION_TRANSACTION_BUFFER_MS = 1_000;
/**
 * Transaction budget derived from the statement budget so the interactive
 * transaction can never self-expire before PostgreSQL statement timeouts fire:
 * timeout >= maxTimedStatements * statementTimeout + buffer.
 */
export const RAW_RETENTION_TRANSACTION_TIMEOUT_MS =
  RAW_RETENTION_MAX_TIMED_STATEMENTS * RAW_RETENTION_STATEMENT_TIMEOUT_MS + RAW_RETENTION_TRANSACTION_BUFFER_MS;
export const RAW_RETENTION_TRANSACTION_MAX_WAIT_MS = 500;
/**
 * Fixed physical page-sample percentage. Deliberately not caller-controlled:
 * callers may only narrow the row cap (`sampleSize`). Small eligible sets are
 * measured with a bounded unsorted scan instead (see below).
 */
export const RAW_RETENTION_TABLESAMPLE_PERCENT = 10;

type ReadDb = Pick<typeof prisma, "$transaction">;
type ReadTx = { $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> };

export class RawRetentionInputError extends Error {}
export class RawRetentionTimeoutError extends Error {}

/**
 * Internal test-coordination seam only. The route never populates it and no
 * request input can activate it: the route forwards exactly the four validated
 * fields and the Zod schema is strict.
 */
export type RawRetentionMeasurementHooks = {
  /** Runs inside the measurement transaction after the summary query resolves. */
  afterSummary?: () => Promise<void> | void;
};

export type RawRetentionDryRunInput = {
  workspaceId: string;
  retentionDays: RawRetentionDays;
  platform?: string;
  sampleSize?: number;
  now?: Date;
};

type AggregateRow = {
  rawBearingRows: bigint | number;
  eligibleRows: bigint | number;
  oldestDate: Date | null;
  newestDate: Date | null;
  oldestPulledAt: Date | null;
  newestPulledAt: Date | null;
  metaAdNameRows: bigint | number;
  shopeeBroadRows: bigint | number;
  shopeeDirectRows: bigint | number;
  shopeeKeywordRows: bigint | number;
};

type PlatformExactRow = {
  platform: string;
  eligibleRows: bigint | number;
  oldestDate: Date | null;
  newestDate: Date | null;
  oldestPulledAt: Date | null;
  newestPulledAt: Date | null;
};

type SampleRow = {
  platform: string;
  bytes: bigint | number;
};

function count(value: bigint | number | null | undefined): number {
  const result = typeof value === "bigint" ? value : BigInt(value ?? 0);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RawRetentionInputError("Retention measurement exceeds the safe response range.");
  }
  return Number(result);
}

function bytesEstimate(rows: number, sampledRows: number, sampledBytes: number): number | null {
  if (sampledRows === 0) return null;
  const estimate = Math.floor((rows * sampledBytes) / sampledRows);
  return Number.isSafeInteger(estimate) ? estimate : null;
}

function assertInput(input: RawRetentionDryRunInput): Required<Omit<RawRetentionDryRunInput, "platform">> & Pick<RawRetentionDryRunInput, "platform"> {
  if (!input.workspaceId?.trim()) throw new RawRetentionInputError("A workspace scope is required.");
  if (!RAW_RETENTION_POLICIES.includes(input.retentionDays)) throw new RawRetentionInputError("Retention policy must be 14, 30, or 90 days.");
  if (input.platform !== undefined && !/^[a-z0-9_]{1,64}$/.test(input.platform)) {
    throw new RawRetentionInputError("Platform must be a canonical provider identifier.");
  }
  const sampleSize = input.sampleSize ?? DEFAULT_RAW_RETENTION_SAMPLE_SIZE;
  if (!Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > MAX_RAW_RETENTION_SAMPLE_SIZE) {
    throw new RawRetentionInputError(`Sample size must be an integer from 1 to ${MAX_RAW_RETENTION_SAMPLE_SIZE}.`);
  }
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new RawRetentionInputError("Measurement time is invalid.");
  return { ...input, workspaceId: input.workspaceId.trim(), sampleSize, now };
}

function isTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "57014") return true;
  const message = String((error as { message?: unknown }).message ?? "");
  if (/statement timeout|query timed out/i.test(message)) return true;
  if (/transaction expired|transaction[^.]{0,80}timed?\s*out/i.test(message)) return true;
  // P2028 is Prisma's transaction-API failure. Isolation here is a hardcoded
  // valid constant, so any other P2028 in this read-only flow is a transaction
  // budget/closure failure — except an explicit invalid-isolation programming
  // error, which must stay loud instead of mapping to 408.
  if (code === "P2028" && !/invalid isolation/i.test(message)) return true;
  return false;
}

/**
 * Read-only measurement of raw provider payloads that would be eligible for a
 * future policy. `pulledAt`, rather than provider reporting date, preserves an
 * old backfill for its full policy window. This service has no mutation path.
 *
 * Sampling is structurally bounded: exact counts use grouped aggregates, and
 * byte sampling never ranks or sorts the eligible population. Small eligible
 * sets (at most `sampleSize` rows) are measured with a bounded unsorted scan
 * and labeled exact; larger sets use a fixed `TABLESAMPLE SYSTEM` page sample
 * with a hard row cap and are labeled sampled. Zero sampled rows yields
 * `unknown`, never a false zero-byte estimate. `octet_length("rawData")` is
 * the only payload-derived value read; raw payload contents never leave
 * PostgreSQL.
 *
 * Every measurement query runs inside one RepeatableRead transaction, so the
 * response is internally snapshot-consistent as of that transaction snapshot —
 * not a long-lived historical database snapshot. A later invocation takes a
 * fresh snapshot and observes subsequently committed imports. The transaction
 * performs plain SELECTs only (no locking reads, no provider/network work),
 * so concurrent ingestion is never blocked. Read-only transactions cannot hit
 * serialization failures, so no retry loop is needed.
 */
export async function measureCampaignMetricRawRetention(
  input: RawRetentionDryRunInput,
  db: ReadDb = prisma,
  hooks?: RawRetentionMeasurementHooks,
) {
  const safe = assertInput(input);
  // Reuse the mandatory tenant-scope helper before constructing parameterized SQL.
  const scope = scopeCampaignMetricWhere(safe.workspaceId);
  const cutoff = new Date(safe.now.getTime() - safe.retentionDays * 86_400_000);
  const platform = safe.platform ?? null;

  const filter = Prisma.sql`
    "workspaceId" = ${scope.workspaceId}
    AND "rawData" IS NOT NULL
    AND (${platform}::text IS NULL OR "platform" = ${platform})
  `;
  const eligible = Prisma.sql`${filter} AND "pulledAt" < ${cutoff}`;

  try {
    const result = await db.$transaction(async (tx: ReadTx) => {
      // set_config is transaction-local and parameterized; it does not persist settings or data.
      await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout', ${String(RAW_RETENTION_STATEMENT_TIMEOUT_MS)}, true)`);
      const [summary] = await tx.$queryRaw<AggregateRow[]>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE ${filter}) AS "rawBearingRows",
          COUNT(*) FILTER (WHERE ${eligible}) AS "eligibleRows",
          MIN("date") FILTER (WHERE ${eligible}) AS "oldestDate",
          MAX("date") FILTER (WHERE ${eligible}) AS "newestDate",
          MIN("pulledAt") FILTER (WHERE ${eligible}) AS "oldestPulledAt",
          MAX("pulledAt") FILTER (WHERE ${eligible}) AS "newestPulledAt",
          COUNT(*) FILTER (WHERE ${eligible} AND "platform" = 'meta_ads' AND "rawData" LIKE '%"ad_name"%') AS "metaAdNameRows",
          COUNT(*) FILTER (WHERE ${eligible} AND "platform" = 'shopee' AND "rawData" LIKE '%"broad_metrics"%') AS "shopeeBroadRows",
          COUNT(*) FILTER (WHERE ${eligible} AND "platform" = 'shopee' AND "rawData" LIKE '%"direct_metrics"%') AS "shopeeDirectRows",
          COUNT(*) FILTER (WHERE ${eligible} AND "platform" = 'shopee' AND ("rawData" LIKE '%"keyword_settings"%' OR "rawData" LIKE '%"keyword_settings_count"%')) AS "shopeeKeywordRows"
        FROM "CampaignMetric"
        WHERE "workspaceId" = ${scope.workspaceId}
      `);
      await hooks?.afterSummary?.();
      const platformExact = await tx.$queryRaw<PlatformExactRow[]>(Prisma.sql`
        SELECT "platform", COUNT(*) AS "eligibleRows",
          MIN("date") AS "oldestDate", MAX("date") AS "newestDate",
          MIN("pulledAt") AS "oldestPulledAt", MAX("pulledAt") AS "newestPulledAt"
        FROM "CampaignMetric"
        WHERE ${eligible}
        GROUP BY "platform"
      `);
      const eligibleRows = summary ? count(summary.eligibleRows) : 0;
      let sampleRows: SampleRow[] = [];
      let sampleMethod: "none" | "bounded-unsorted-scan" | "tablesample-system-10" = "none";
      if (eligibleRows > 0) {
        if (eligibleRows <= safe.sampleSize) {
          sampleMethod = "bounded-unsorted-scan";
          // No ORDER BY: heap order is sufficient for a full measurement capped
          // at sampleSize, which already covers every eligible row here.
          sampleRows = await tx.$queryRaw<SampleRow[]>(Prisma.sql`
            SELECT "platform", octet_length("rawData") AS bytes
            FROM "CampaignMetric"
            WHERE ${eligible}
            LIMIT ${safe.sampleSize}
          `);
        } else {
          sampleMethod = "tablesample-system-10";
          // Physical page sampling happens inside PostgreSQL before the row
          // cap; there is no window function and no sort of the candidate set.
          sampleRows = await tx.$queryRaw<SampleRow[]>(Prisma.sql`
            SELECT "platform", octet_length("rawData") AS bytes
            FROM "CampaignMetric" TABLESAMPLE SYSTEM (${Prisma.raw(String(RAW_RETENTION_TABLESAMPLE_PERCENT))})
            WHERE ${eligible}
            LIMIT ${safe.sampleSize}
          `);
        }
      }
      return { summary: summary ?? null, platformExact, sampleRows, sampleMethod };
    }, {
      isolationLevel: "RepeatableRead",
      timeout: RAW_RETENTION_TRANSACTION_TIMEOUT_MS,
      maxWait: RAW_RETENTION_TRANSACTION_MAX_WAIT_MS,
    });

    const summary = result.summary;
    if (!summary) throw new RawRetentionInputError("Workspace scope could not be measured.");
    const eligibleRows = count(summary.eligibleRows);
    const perPlatformExact = [...result.platformExact].sort((a, b) => (a.platform < b.platform ? -1 : a.platform > b.platform ? 1 : 0));

    const sampledByPlatform = new Map<string, { rows: number; bytes: number }>();
    for (const row of result.sampleRows) {
      const entry = sampledByPlatform.get(row.platform) ?? { rows: 0, bytes: 0 };
      entry.rows += 1;
      entry.bytes += count(row.bytes);
      sampledByPlatform.set(row.platform, entry);
    }
    const totalSampledRows = result.sampleRows.length;
    const fullyMeasured = result.sampleMethod === "bounded-unsorted-scan" && totalSampledRows === eligibleRows;
    const bytesEvidence = eligibleRows === 0 || totalSampledRows === 0
      ? "unknown" as const
      : fullyMeasured
        ? "exact" as const
        : "sampled" as const;
    const totalSampledBytes = [...sampledByPlatform.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    const estimatedBytes = bytesEvidence === "unknown"
      ? null
      : bytesEstimate(eligibleRows, totalSampledRows, totalSampledBytes);

    return {
      dryRun: true as const,
      wouldMutate: false as const,
      executionAvailable: false as const,
      retentionPolicy: { days: safe.retentionDays, recommendedFutureDefaultDays: 30 },
      cutoff: cutoff.toISOString(),
      statementTimeoutMs: RAW_RETENTION_STATEMENT_TIMEOUT_MS,
      totalRawBearingRows: count(summary.rawBearingRows),
      exactEligibleRowCount: eligibleRows,
      eligibleByteEstimate: {
        evidence: bytesEvidence,
        bytes: estimatedBytes,
        sampleRows: totalSampledRows,
        sampleMethod: result.sampleMethod,
        sampleLimit: safe.sampleSize,
      },
      byteSampling: {
        method: result.sampleMethod,
        tablesamplePercent: result.sampleMethod === "tablesample-system-10" ? RAW_RETENTION_TABLESAMPLE_PERCENT : null,
        sampleLimit: safe.sampleSize,
        sampleRows: totalSampledRows,
      },
      eligibleRange: {
        oldestProviderDate: summary.oldestDate?.toISOString() ?? null,
        newestProviderDate: summary.newestDate?.toISOString() ?? null,
        oldestPulledAt: summary.oldestPulledAt?.toISOString() ?? null,
        newestPulledAt: summary.newestPulledAt?.toISOString() ?? null,
      },
      knownReaderImpact: {
        metaAdNameRows: count(summary.metaAdNameRows),
        shopeeBroadMetricRows: count(summary.shopeeBroadRows),
        shopeeDirectMetricRows: count(summary.shopeeDirectRows),
        shopeeKeywordRows: count(summary.shopeeKeywordRows),
      },
      perPlatform: perPlatformExact.map((row) => {
        const exact = count(row.eligibleRows);
        const sample = sampledByPlatform.get(row.platform);
        const sampledRows = sample?.rows ?? 0;
        const platformFullyMeasured = fullyMeasured || (result.sampleMethod === "bounded-unsorted-scan" && sampledRows === exact);
        const evidence = exact === 0 || sampledRows === 0
          ? "unknown" as const
          : platformFullyMeasured
            ? "exact" as const
            : "sampled" as const;
        return {
          platform: row.platform,
          exactEligibleRowCount: exact,
          sampledByteEstimate: {
            evidence,
            bytes: evidence === "unknown" ? null : bytesEstimate(exact, sampledRows, sample?.bytes ?? 0),
            sampledRows,
          },
          oldestProviderDate: row.oldestDate?.toISOString() ?? null,
          newestProviderDate: row.newestDate?.toISOString() ?? null,
          oldestPulledAt: row.oldestPulledAt?.toISOString() ?? null,
          newestPulledAt: row.newestPulledAt?.toISOString() ?? null,
        };
      }),
      assumptions: [
        "Eligibility is exact and uses CampaignMetric.pulledAt < cutoff in UTC.",
        "Provider reporting date is descriptive only and does not affect retention eligibility.",
        "Byte totals are estimates unless every eligible row was measured; see evidence labels.",
      ],
      limitations: [
        "Malformed JSON is treated as opaque text and cannot fail this measurement.",
        "No retention policy is enabled and execution remains unavailable.",
        "Meta ad_name and Shopee broad/direct/keyword payload fields require migration before pruning.",
        "Exact pulledAt aggregates scan scoped rows and remain statement-timeout bounded without a supporting index; no index is added in this phase.",
        "Large-set byte samples use a fixed physical page sample and must not be read as precise storage accounting.",
      ],
    };
  } catch (error) {
    if (isTimeout(error)) throw new RawRetentionTimeoutError("Retention measurement timed out before any result was returned.");
    throw error;
  }
}

export interface RawDependencyReadiness {
  workspaceId: string;
  measuredAt: string;
  meta: { rawDependent: number; promoted: number };
  shopee: { rawDependent: number; fullyPromoted: number; partiallyPromoted: number };
  totals: { rawDependent: number; fullyPromoted: number; partiallyPromoted: number };
}

const SHOPEE_PROMOTED_COLUMNS = [
  "shopeeBroadOrders",
  "shopeeBroadUnits",
  "shopeeBroadGmv",
  "shopeeDirectOrders",
  "shopeeDirectUnits",
  "shopeeDirectGmv",
  "shopeeKeywordSettingsCount",
] as const;

/**
 * Read-only retention-readiness evidence for the next bounded backfill phase.
 * Classifies rows by promoted-column coverage without returning raw payload
 * values — counts only. No execution route, no mutation.
 *
 * A row is raw-dependent when its promoted column is NULL while its rawData
 * still carries the corresponding marker. Rows with neither marker nor
 * promoted value need no backfill and stay unclassified.
 */
export async function classifyRawDependencyReadiness(
  workspaceId: string,
  db: Pick<typeof prisma, "campaignMetric"> = prisma,
): Promise<RawDependencyReadiness> {
  const metric = (db as any).campaignMetric;
  const scoped = (where: Record<string, unknown>) =>
    scopeCampaignMetricWhere(workspaceId, where as any);

  const [metaDependent, metaPromoted, shopeeDependent, shopeeFull, shopeePartial] = await Promise.all([
    metric.count({ where: scoped({ platform: "meta_ads", adName: null, rawData: { contains: '"ad_name"' } }) }),
    metric.count({ where: scoped({ platform: "meta_ads", adName: { not: null } }) }),
    metric.count({
      where: scoped({
        platform: "shopee",
        rawData: { not: null },
        OR: [
          { AND: [{ rawData: { contains: '"broad_metrics"' } }, { shopeeBroadOrders: null }] },
          { AND: [{ rawData: { contains: '"direct_metrics"' } }, { shopeeDirectOrders: null }] },
          {
            AND: [
              { OR: [{ rawData: { contains: '"keyword_settings_count"' } }, { rawData: { contains: '"keyword_settings"' } }] },
              { shopeeKeywordSettingsCount: null },
            ],
          },
        ],
      }),
    }),
    metric.count({
      where: scoped({
        platform: "shopee",
        ...Object.fromEntries(SHOPEE_PROMOTED_COLUMNS.map((column) => [column, { not: null }])),
      }),
    }),
    metric.count({
      where: scoped({
        platform: "shopee",
        OR: SHOPEE_PROMOTED_COLUMNS.map((column) => ({ [column]: { not: null } })),
        NOT: {
          AND: SHOPEE_PROMOTED_COLUMNS.map((column) => ({ [column]: { not: null } })),
        },
      }),
    }),
  ]);

  return {
    workspaceId,
    measuredAt: new Date().toISOString(),
    meta: { rawDependent: metaDependent, promoted: metaPromoted },
    shopee: { rawDependent: shopeeDependent, fullyPromoted: shopeeFull, partiallyPromoted: shopeePartial },
    totals: {
      rawDependent: metaDependent + shopeeDependent,
      fullyPromoted: metaPromoted + shopeeFull,
      partiallyPromoted: shopeePartial,
    },
  };
}
