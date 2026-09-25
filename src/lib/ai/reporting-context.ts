import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import { RbacError } from "@/lib/rbac";
import type { ScopedTransaction } from "@/lib/warehouse-query";
import { loadReportReadiness } from "@/lib/report-readiness-server";
import { reportingDataset } from "@/lib/report-delivery";
import { reduceFreshness } from "@/lib/ai/evidence-pack";
import { getPlanLimits } from "@/lib/plan-config";
import { withDatabaseTenantContext } from "@/lib/database-tenant-context";
import type {
  ReportingContext,
  ReportingPeriodWindows,
  ReportingWindowPreset,
  ReportingMetricValue,
  ReportingChannelSummary,
  ReportingObservation,
  FreshnessJourney,
} from "./reporting-contracts";
import {
  REPORTING_METRIC_CATALOG,
  REPORTING_BRIEF_FINGERPRINT_VERSION,
  REPORTING_METRIC_CATALOG_VERSION,
} from "./reporting-contracts";
import { buildFreshnessJourney } from "@/lib/freshness-journey";

export type ResolveReportingContextOptions = {
  workspaceId: string;
  clientId: string;
  preset?: ReportingWindowPreset;
  now?: Date;
  tx?: ScopedTransaction;
  onAfterReadiness?: () => Promise<void>;
};

/**
 * Calculates completed reporting periods, excluding the current partial day.
 * - Current: [end - (days - 1), end] where end is yesterday UTC.
 * - Prior: [startCurrent - days, startCurrent - 1 day]
 */
/**
 * Returns a YYYY-MM-DD string representing the wall-clock date of `instant` in
 * the given IANA timezone.  Falls back to UTC and returns null as the effective
 * timezone on any invalid timezone string.
 */
function wallClockDate(instant: Date, tz: string): { date: string; effectiveTz: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const year = parts.find((p) => p.type === "year")?.value ?? "";
    const month = parts.find((p) => p.type === "month")?.value ?? "";
    const day = parts.find((p) => p.type === "day")?.value ?? "";
    return { date: `${year}-${month}-${day}`, effectiveTz: tz };
  } catch {
    // Invalid IANA timezone — degrade to UTC
    const d = instant.toISOString().slice(0, 10);
    return { date: d, effectiveTz: "UTC" };
  }
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function calculateReportingWindows(
  preset: ReportingWindowPreset = "last_7d",
  now = new Date(),
  timezone = "UTC",
  timezoneSource: "verified" | "inferred" | "unknown" = "inferred",
): ReportingPeriodWindows {
  const daysCount = preset === "last_30d" ? 30 : 7;

  // Derive "today" in the account's reporting timezone, then go back 1 day to
  // get the last *completed* reporting day. This preserves provider daily-date
  // semantics without treating daily totals as if they were hourly data.
  const { date: todayInTz, effectiveTz } = wallClockDate(now, timezone);
  const effectiveTimezoneSource: "verified" | "inferred" | "unknown" =
    effectiveTz !== timezone ? "inferred" : timezoneSource;

  // "Yesterday" in the account timezone is the end of the current window.
  const endCurrentStr = addDays(todayInTz, -1);
  const startCurrentStr = addDays(endCurrentStr, -(daysCount - 1));

  // Prior window: equal-length block immediately before the current window.
  const endPriorStr = addDays(startCurrentStr, -1);
  const startPriorStr = addDays(endPriorStr, -(daysCount - 1));

  return {
    preset,
    current: {
      start: startCurrentStr,
      end: endCurrentStr,
    },
    prior: {
      start: startPriorStr,
      end: endPriorStr,
    },
    timezone: effectiveTz,
    timezoneSource: effectiveTimezoneSource,
    daysCount,
    comparisonAvailable: true,
  };
}

type AggregatedBucket = {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  marketplaceOrders: number;
  marketplaceRevenue: number;
  currency: string;
};

function safeRatio(num: number, den: number): number | null {
  if (den <= 0 || !Number.isFinite(den) || !Number.isFinite(num)) return null;
  return num / den;
}

function computeChange(
  current: number | null,
  prior: number | null,
): { absolute: number | null; percentage: number | null; status: "available" | "unavailable" | "zero_baseline" } {
  if (current == null) {
    return { absolute: null, percentage: null, status: "unavailable" };
  }
  if (prior == null || prior === 0) {
    return {
      absolute: current,
      percentage: null,
      status: prior === 0 ? "zero_baseline" : "unavailable",
    };
  }
  const absolute = current - prior;
  const percentage = absolute / prior;
  return { absolute, percentage, status: "available" };
}

/**
 * Resolves a trusted, verified reporting context for a client.
 * Enforces concrete client validation, full-scope aggregates without truncation,
 * explicit currency isolation, and zero-hallucination observations.
 */
type ReportingContextOverride = ((options: ResolveReportingContextOptions) => Promise<ReportingContext>) | null;
let reportingContextOverride: ReportingContextOverride = null;

export function setReportingContextOverride(override: ReportingContextOverride): void {
  reportingContextOverride = override;
}

type ReportingClockOverride = (() => Date) | Date | null;
let reportingClockOverride: ReportingClockOverride = null;

export function setReportingClockOverride(override: ReportingClockOverride): void {
  reportingClockOverride = override;
}

export async function resolveReportingContext(
  options: ResolveReportingContextOptions,
): Promise<ReportingContext> {
  if (reportingContextOverride) {
    return await reportingContextOverride(options);
  }

  const effectiveNow =
    options.now ??
    (typeof reportingClockOverride === "function"
      ? reportingClockOverride()
      : reportingClockOverride ?? new Date());

  const { workspaceId, clientId, preset = "last_7d", now = effectiveNow } = options;

  // 1. Strict Scope Validation: A client brief requires a concrete client.
  if (!clientId || clientId === "all" || clientId === "all_clients" || clientId === "unassigned") {
    throw new RbacError("A concrete client is required for reporting", "INVALID_CLIENT_SCOPE", 400);
  }

  const runWithTx = async (tx: ScopedTransaction) => {
    // 2. Fetch Client and Workspace
    const client = await tx.client.findFirst({
      where: { workspaceId, id: clientId },
      select: {
        id: true,
        name: true,
        accountAssignmentsConfiguredAt: true,
        workspace: { select: { id: true, plan: true } },
      },
    });

    if (!client) {
      throw new RbacError("Client not found in workspace", "CLIENT_NOT_FOUND", 404);
    }

    const tempWindows = calculateReportingWindows(preset, now, "UTC", "inferred");

    // 4. Run Canonical Readiness Evaluation
    const { evaluations: [evaluation] } = await loadReportReadiness(
      workspaceId,
      { start: tempWindows.current.start, end: tempWindows.current.end },
      { clientId, tx, now },
    );

    if (!evaluation) {
      throw new RbacError("Readiness evaluation failed", "READINESS_FAILED", 500);
    }

    if (options.onAfterReadiness) {
      await options.onAfterReadiness();
    }

    const resolvedTimezone = evaluation.timezones.length === 1 ? evaluation.timezones[0] : "UTC";
    const timezoneSource = evaluation.timezones.length === 1 ? "verified" : "inferred";
    const windows = calculateReportingWindows(preset, now, resolvedTimezone, timezoneSource);

    // 5. Enforce Actual Workspace Plan Limits across both resolved windows
    const planLimits = getPlanLimits(client.workspace.plan);
    const { date: todayInTz } = wallClockDate(now, resolvedTimezone);
    const maxHistoryDays = planLimits.maxHistoryDays;
    const earliestAllowedDate = maxHistoryDays ? addDays(todayInTz, -maxHistoryDays) : null;

    // Check if the current reporting window itself is allowed
    const currentDisallowed =
      earliestAllowedDate != null &&
      (windows.current.start < earliestAllowedDate || windows.daysCount > maxHistoryDays!);

    if (currentDisallowed) {
      throw new RbacError(
        `Requested reporting window (${preset}) exceeds ${planLimits.displayName} plan limit (${planLimits.maxHistoryDays} days max history). Upgrade required to report over this period.`,
        "PLAN_LIMIT_EXCEEDED",
        403,
      );
    }

    // Check if the prior comparison window is allowed within the history entitlement
    const priorAllowed =
      earliestAllowedDate == null || windows.prior.start >= earliestAllowedDate;

    const comparisonAvailable = priorAllowed;
    const comparisonUnavailableReason = priorAllowed
      ? null
      : `Prior-period comparison requires access through ${windows.prior.start}, but ${planLimits.displayName} plan is limited to ${planLimits.maxHistoryDays} days history (earliest: ${earliestAllowedDate}). Upgrade required for period-over-period comparisons.`;

    windows.comparisonAvailable = comparisonAvailable;
    windows.comparisonUnavailableReason = comparisonUnavailableReason;

    // 6. Generate Dataset Snapshot and Fingerprint for Current Window
    const snapshot = await reportingDataset(
      tx,
      workspaceId,
      clientId,
      { start: windows.current.start, end: windows.current.end },
      evaluation.requiredProviders,
    );

    // Generate Dataset Snapshot for Prior Window if comparison is permitted
    const priorSnapshot = comparisonAvailable
      ? await reportingDataset(
          tx,
          workspaceId,
          clientId,
          { start: windows.prior.start, end: windows.prior.end },
          evaluation.requiredProviders,
        )
      : null;

    // 7. Aggregate Scope Totals Across Full Authorized Accounts
    const isExplicit = client.accountAssignmentsConfiguredAt != null;
    const assignments = isExplicit
      ? await tx.clientProviderAccountAssignment.findMany({
          where: { workspaceId, clientId },
          select: { provider: true, accountId: true, connectionId: true },
        })
      : [];

    const whereScope = isExplicit
      ? (assignments.length > 0
          ? {
              workspaceId,
              OR: assignments.map((a) => ({
                platform: a.provider,
                accountId: a.accountId,
              })),
            }
          : { workspaceId, id: "__never_match__" })
      : {
          workspaceId,
          connection: { clientId, type: "source" },
        };

    let hasAmbiguousShopeeRows = false;
    let hasUnknownCurrency = false;

    const fetchBucketMetrics = async (start: string, end: string) => {
      const rows = await tx.campaignMetric.findMany({
        where: {
          ...whereScope,
          date: {
            gte: new Date(`${start}T00:00:00.000Z`),
            lte: new Date(`${end}T23:59:59.999Z`),
          },
        },
        select: {
          platform: true,
          currency: true,
          spend: true,
          impressions: true,
          clicks: true,
          conversions: true,
          revenue: true,
          campaignId: true,
          entityId: true,
          breakdownHash: true,
        },
      });

      const currencyTotals = new Map<string, AggregatedBucket>();
      const channelTotals = new Map<string, AggregatedBucket>();

      for (const row of rows) {
        const rawCurr = row.currency?.trim() || "";
        const curr = rawCurr && rawCurr.toUpperCase() !== "UNKNOWN" ? rawCurr : "UNKNOWN";
        const plat = (row.platform?.trim() || "other").toLowerCase();

        const spend = Number(row.spend) || 0;
        const imp = Number(row.impressions) || 0;
        const clk = Number(row.clicks) || 0;
        const conv = Number(row.conversions) || 0;
        const rev = Number(row.revenue) || 0;

        if (curr === "UNKNOWN" && (spend > 0 || rev > 0)) {
          hasUnknownCurrency = true;
        }

        const isMarketplaceRollup =
          (plat === "shopee" || plat === "lazada") &&
          (row.campaignId === `${plat}-orders-daily` ||
            row.entityId === `${plat}-orders-daily` ||
            row.breakdownHash === "day_orders");

        const isAd =
          plat !== "shopee" && plat !== "lazada"
            ? true
            : (!isMarketplaceRollup && (spend > 0 || imp > 0 || clk > 0));

        // If a Shopee/Lazada row is neither a verified daily rollup nor an ad row with spend/clicks/impressions,
        // but carries revenue or conversions, attribution cannot be established from stored row semantics.
        if (!isMarketplaceRollup && !isAd && (plat === "shopee" || plat === "lazada") && (rev > 0 || conv > 0)) {
          hasAmbiguousShopeeRows = true;
        }

        // Currency bucket
        const cBucket = currencyTotals.get(curr) || {
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          conversionValue: 0,
          marketplaceOrders: 0,
          marketplaceRevenue: 0,
          currency: curr,
        };

        if (isAd) {
          cBucket.spend += spend;
          cBucket.impressions += imp;
          cBucket.clicks += clk;
          cBucket.conversions += conv;
          cBucket.conversionValue += rev;
        } else if (isMarketplaceRollup) {
          cBucket.marketplaceOrders += conv;
          cBucket.marketplaceRevenue += rev;
        }
        currencyTotals.set(curr, cBucket);

        // Channel bucket
        const chKey = `${plat}:${curr}`;
        const chBucket = channelTotals.get(chKey) || {
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          conversionValue: 0,
          marketplaceOrders: 0,
          marketplaceRevenue: 0,
          currency: curr,
        };

        if (isAd) {
          chBucket.spend += spend;
          chBucket.impressions += imp;
          chBucket.clicks += clk;
          chBucket.conversions += conv;
          chBucket.conversionValue += rev;
        } else if (isMarketplaceRollup) {
          chBucket.marketplaceOrders += conv;
          chBucket.marketplaceRevenue += rev;
        }
        channelTotals.set(chKey, chBucket);
      }

      return { currencyTotals, channelTotals };
    };

    const currentData = await fetchBucketMetrics(windows.current.start, windows.current.end);
    const priorData = comparisonAvailable
      ? await fetchBucketMetrics(windows.prior.start, windows.prior.end)
      : { currencyTotals: new Map<string, AggregatedBucket>(), channelTotals: new Map<string, AggregatedBucket>() };

    // Collect all observed, non-unknown currencies
    const observedCurrencies = Array.from(
      new Set(
        [
          ...evaluation.currencies,
          ...currentData.currencyTotals.keys(),
          ...priorData.currencyTotals.keys(),
        ].filter((c) => c && c !== "UNKNOWN")
      )
    ).sort();

    // Compute non-monetary totals across all currencies
    let totalCurrentImpressions = 0;
    let totalPriorImpressions = 0;
    let totalCurrentClicks = 0;
    let totalPriorClicks = 0;
    let totalCurrentConversions = 0;
    let totalPriorConversions = 0;
    let totalCurrentMarketplaceOrders = 0;
    let totalPriorMarketplaceOrders = 0;

    for (const b of currentData.currencyTotals.values()) {
      totalCurrentImpressions += b.impressions;
      totalCurrentClicks += b.clicks;
      totalCurrentConversions += b.conversions;
      totalCurrentMarketplaceOrders += b.marketplaceOrders;
    }
    if (comparisonAvailable) {
      for (const b of priorData.currencyTotals.values()) {
        totalPriorImpressions += b.impressions;
        totalPriorClicks += b.clicks;
        totalPriorConversions += b.conversions;
        totalPriorMarketplaceOrders += b.marketplaceOrders;
      }
    }

    const getComparisonChange = (current: number | null, prior: number | null) => {
      if (!comparisonAvailable) {
        return { absolute: null, percentage: null, status: "unavailable" as const };
      }
      return computeChange(current, prior);
    };

    const getMetricLimitations = (baseLimitations: string[]) => {
      if (comparisonAvailable) return [...baseLimitations];
      return [
        ...baseLimitations,
        `Prior period comparison unavailable under current plan limits (${planLimits.maxHistoryDays} days max history).`,
      ];
    };

    const metrics: ReportingMetricValue[] = [];

    // 1. Impressions (Non-monetary)
    const impChange = getComparisonChange(totalCurrentImpressions, comparisonAvailable ? totalPriorImpressions : null);
    metrics.push({
      metricId: "impressions",
      name: REPORTING_METRIC_CATALOG.impressions.name,
      currency: null,
      currentValue: totalCurrentImpressions,
      priorValue: comparisonAvailable ? totalPriorImpressions : null,
      absoluteChange: impChange.absolute,
      percentageChange: impChange.percentage,
      status: impChange.status,
      limitations: getMetricLimitations(REPORTING_METRIC_CATALOG.impressions.semanticLimitations),
    });

    // 2. Clicks (Non-monetary)
    const clkChange = getComparisonChange(totalCurrentClicks, comparisonAvailable ? totalPriorClicks : null);
    metrics.push({
      metricId: "clicks",
      name: REPORTING_METRIC_CATALOG.clicks.name,
      currency: null,
      currentValue: totalCurrentClicks,
      priorValue: comparisonAvailable ? totalPriorClicks : null,
      absoluteChange: clkChange.absolute,
      percentageChange: clkChange.percentage,
      status: clkChange.status,
      limitations: getMetricLimitations(REPORTING_METRIC_CATALOG.clicks.semanticLimitations),
    });

    // 3. CTR (Non-monetary ratio)
    const cCtr = safeRatio(totalCurrentClicks, totalCurrentImpressions);
    const pCtr = comparisonAvailable ? safeRatio(totalPriorClicks, totalPriorImpressions) : null;
    const ctrChange = getComparisonChange(cCtr, pCtr);
    metrics.push({
      metricId: "ctr",
      name: REPORTING_METRIC_CATALOG.ctr.name,
      currency: null,
      currentValue: cCtr,
      priorValue: pCtr,
      absoluteChange: ctrChange.absolute,
      percentageChange: ctrChange.percentage,
      status: ctrChange.status,
      limitations: getMetricLimitations(REPORTING_METRIC_CATALOG.ctr.semanticLimitations),
    });

    // 4. Conversions (Non-monetary)
    const convChange = getComparisonChange(totalCurrentConversions, comparisonAvailable ? totalPriorConversions : null);
    metrics.push({
      metricId: "conversions",
      name: REPORTING_METRIC_CATALOG.conversions.name,
      currency: null,
      currentValue: totalCurrentConversions,
      priorValue: comparisonAvailable ? totalPriorConversions : null,
      absoluteChange: convChange.absolute,
      percentageChange: convChange.percentage,
      status: convChange.status,
      limitations: getMetricLimitations(REPORTING_METRIC_CATALOG.conversions.semanticLimitations),
    });

    // 5. Marketplace Orders (Non-monetary, if applicable)
    if (totalCurrentMarketplaceOrders > 0 || (comparisonAvailable && totalPriorMarketplaceOrders > 0) || hasAmbiguousShopeeRows) {
      if (hasAmbiguousShopeeRows) {
        metrics.push({
          metricId: "marketplace_orders",
          name: REPORTING_METRIC_CATALOG.marketplace_orders.name,
          currency: null,
          currentValue: null,
          priorValue: null,
          absoluteChange: null,
          percentageChange: null,
          status: "unavailable",
          limitations: [
            ...REPORTING_METRIC_CATALOG.marketplace_orders.semanticLimitations,
            "Withheld: Ambiguous Shopee row semantics prevent verifying separate store order totals.",
          ],
        });
      } else {
        const ordChange = getComparisonChange(totalCurrentMarketplaceOrders, comparisonAvailable ? totalPriorMarketplaceOrders : null);
        metrics.push({
          metricId: "marketplace_orders",
          name: REPORTING_METRIC_CATALOG.marketplace_orders.name,
          currency: null,
          currentValue: totalCurrentMarketplaceOrders,
          priorValue: comparisonAvailable ? totalPriorMarketplaceOrders : null,
          absoluteChange: ordChange.absolute,
          percentageChange: ordChange.percentage,
          status: ordChange.status,
          limitations: getMetricLimitations(REPORTING_METRIC_CATALOG.marketplace_orders.semanticLimitations),
        });
      }
    }

    // 6. Monetary Metrics: computed separately per observed currency (never invented, never blended)
    for (const curr of observedCurrencies) {
      const cCurr = currentData.currencyTotals.get(curr) || {
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        conversionValue: 0,
        marketplaceOrders: 0,
        marketplaceRevenue: 0,
        currency: curr,
      };
      const priorHasCurrency = comparisonAvailable && priorData.currencyTotals.has(curr);
      const pCurr = comparisonAvailable ? priorData.currencyTotals.get(curr) : undefined;
      const labelSuffix = observedCurrencies.length > 1 ? ` (${curr})` : "";

      // Spend
      const pSpend = comparisonAvailable && priorHasCurrency && pCurr ? pCurr.spend : null;
      const spendChange = getComparisonChange(cCurr.spend, pSpend);
      metrics.push({
        metricId: "spend",
        name: `${REPORTING_METRIC_CATALOG.spend.name}${labelSuffix}`,
        currency: curr,
        currentValue: cCurr.spend,
        priorValue: pSpend,
        absoluteChange: spendChange.absolute,
        percentageChange: spendChange.percentage,
        status: spendChange.status,
        limitations: getMetricLimitations(REPORTING_METRIC_CATALOG.spend.semanticLimitations),
      });

      // CPC
      const cCpc = safeRatio(cCurr.spend, cCurr.clicks);
      const pCpc = comparisonAvailable && priorHasCurrency && pCurr ? safeRatio(pCurr.spend, pCurr.clicks) : null;
      const cpcChange = getComparisonChange(cCpc, pCpc);
      metrics.push({
        metricId: "cpc",
        name: `${REPORTING_METRIC_CATALOG.cpc.name}${labelSuffix}`,
        currency: curr,
        currentValue: cCpc,
        priorValue: pCpc,
        absoluteChange: cpcChange.absolute,
        percentageChange: cpcChange.percentage,
        status: cpcChange.status,
        limitations: getMetricLimitations(REPORTING_METRIC_CATALOG.cpc.semanticLimitations),
      });

      // CPA
      const cCpa = safeRatio(cCurr.spend, cCurr.conversions);
      const pCpa = comparisonAvailable && priorHasCurrency && pCurr ? safeRatio(pCurr.spend, pCurr.conversions) : null;
      const cpaChange = getComparisonChange(cCpa, pCpa);
      metrics.push({
        metricId: "cost_per_conversion",
        name: `${REPORTING_METRIC_CATALOG.cost_per_conversion.name}${labelSuffix}`,
        currency: curr,
        currentValue: cCpa,
        priorValue: pCpa,
        absoluteChange: cpaChange.absolute,
        percentageChange: cpaChange.percentage,
        status: cpaChange.status,
        limitations: getMetricLimitations(REPORTING_METRIC_CATALOG.cost_per_conversion.semanticLimitations),
      });

      // ROAS
      const cRoas = hasAmbiguousShopeeRows ? null : safeRatio(cCurr.conversionValue, cCurr.spend);
      const pRoas = hasAmbiguousShopeeRows || !comparisonAvailable || !priorHasCurrency || !pCurr ? null : safeRatio(pCurr.conversionValue, pCurr.spend);
      const roasChange = getComparisonChange(cRoas, pRoas);
      metrics.push({
        metricId: "roas",
        name: `${REPORTING_METRIC_CATALOG.roas.name}${labelSuffix}`,
        currency: curr,
        currentValue: cRoas,
        priorValue: pRoas,
        absoluteChange: roasChange.absolute,
        percentageChange: roasChange.percentage,
        status: hasAmbiguousShopeeRows ? "unavailable" : roasChange.status,
        limitations: hasAmbiguousShopeeRows
          ? [
              ...REPORTING_METRIC_CATALOG.roas.semanticLimitations,
              "Withheld: Shopee rows with ambiguous attribution detected. Stored data cannot definitively separate ad revenue from marketplace orders.",
            ]
          : getMetricLimitations(REPORTING_METRIC_CATALOG.roas.semanticLimitations),
      });

      // Marketplace Revenue
      if (cCurr.marketplaceRevenue > 0 || (comparisonAvailable && pCurr && pCurr.marketplaceRevenue > 0) || hasAmbiguousShopeeRows) {
        if (hasAmbiguousShopeeRows) {
          metrics.push({
            metricId: "marketplace_revenue",
            name: `${REPORTING_METRIC_CATALOG.marketplace_revenue.name}${labelSuffix}`,
            currency: curr,
            currentValue: null,
            priorValue: null,
            absoluteChange: null,
            percentageChange: null,
            status: "unavailable",
            limitations: [
              ...REPORTING_METRIC_CATALOG.marketplace_revenue.semanticLimitations,
              "Withheld: Ambiguous Shopee row semantics prevent verifying separate marketplace GMV totals.",
            ],
          });
        } else {
          const pMktRev = comparisonAvailable && priorHasCurrency && pCurr ? pCurr.marketplaceRevenue : null;
          const ordRevChange = getComparisonChange(cCurr.marketplaceRevenue, pMktRev);
          metrics.push({
            metricId: "marketplace_revenue",
            name: `${REPORTING_METRIC_CATALOG.marketplace_revenue.name}${labelSuffix}`,
            currency: curr,
            currentValue: cCurr.marketplaceRevenue,
            priorValue: pMktRev,
            absoluteChange: ordRevChange.absolute,
            percentageChange: ordRevChange.percentage,
            status: ordRevChange.status,
            limitations: getMetricLimitations(REPORTING_METRIC_CATALOG.marketplace_revenue.semanticLimitations),
          });
        }
      }
    }

    if (hasUnknownCurrency) {
      metrics.push({
        metricId: "spend",
        name: "Total Spend (Unknown Currency)",
        currency: null,
        currentValue: null,
        priorValue: null,
        absoluteChange: null,
        percentageChange: null,
        status: "unavailable",
        limitations: [
          ...REPORTING_METRIC_CATALOG.spend.semanticLimitations,
          "Withheld: Rows with missing or unrecognized currency detected. Monetary totals cannot be verified.",
        ],
      });
    }

    // Build Channel Scorecard
    const channels: ReportingChannelSummary[] = [];
    for (const [chKey, b] of currentData.channelTotals.entries()) {
      const [channel, curr] = chKey.split(":");
      const isUnknownCurr = !curr || curr === "UNKNOWN";
      const roas = (hasAmbiguousShopeeRows && channel === "shopee") || isUnknownCurr ? null : safeRatio(b.conversionValue, b.spend);
      channels.push({
        channel: channel ?? "unknown",
        currency: isUnknownCurr ? "UNKNOWN" : (curr ?? "UNKNOWN"),
        spend: isUnknownCurr ? null : b.spend,
        conversions: b.conversions > 0 ? b.conversions : null,
        conversionValue: isUnknownCurr ? null : (b.conversionValue > 0 ? b.conversionValue : null),
        roas,
        orders: b.marketplaceOrders > 0 ? b.marketplaceOrders : null,
        orderRevenue: isUnknownCurr ? null : (b.marketplaceRevenue > 0 ? b.marketplaceRevenue : null),
        clicks: b.clicks,
        impressions: b.impressions,
      });
    }

    // Construct Observations
    const observations: ReportingObservation[] = [];

    // Per-currency spend and ROAS observations
    for (const curr of observedCurrencies) {
      const cCurr = currentData.currencyTotals.get(curr);
      const priorHasCurrency = comparisonAvailable && priorData.currencyTotals.has(curr);
      const pCurr = comparisonAvailable ? priorData.currencyTotals.get(curr) : undefined;

      if (cCurr && cCurr.spend > 0) {
        if (comparisonAvailable) {
          const spendChange = computeChange(cCurr.spend, priorHasCurrency && pCurr ? pCurr.spend : null);
          if (spendChange.percentage != null) {
            const dir = spendChange.percentage >= 0 ? "increased" : "decreased";
            const pct = (Math.abs(spendChange.percentage) * 100).toFixed(1);
            observations.push({
              id: `obs_spend_trend_${curr.toLowerCase()}`,
              type: "spend",
              text: `Total advertising spend in ${curr} ${dir} by ${pct}% compared to prior period (${curr} ${cCurr.spend.toLocaleString()} vs ${pCurr ? pCurr.spend.toLocaleString() : "0"}).`,
              evidenceRef: `metric:spend:${curr}`,
            });
          } else {
            observations.push({
              id: `obs_spend_trend_${curr.toLowerCase()}`,
              type: "spend",
              text: `Total advertising spend in ${curr}: ${curr} ${cCurr.spend.toLocaleString()}${priorHasCurrency ? "" : " (no comparison baseline in prior period)"}.`,
              evidenceRef: `metric:spend:${curr}`,
            });
          }
        } else {
          observations.push({
            id: `obs_spend_trend_${curr.toLowerCase()}`,
            type: "spend",
            text: `Total advertising spend in ${curr}: ${curr} ${cCurr.spend.toLocaleString()} (prior period comparison unavailable under current plan limits).`,
            evidenceRef: `metric:spend:${curr}`,
          });
        }
      }

      if (!hasAmbiguousShopeeRows && cCurr) {
        const cRoas = safeRatio(cCurr.conversionValue, cCurr.spend);
        if (comparisonAvailable) {
          const pRoas = priorHasCurrency && pCurr ? safeRatio(pCurr.conversionValue, pCurr.spend) : null;
          if (cRoas != null && pRoas != null) {
            const delta = cRoas - pRoas;
            const dir = delta >= 0 ? "improved" : "declined";
            observations.push({
              id: `obs_roas_trend_${curr.toLowerCase()}`,
              type: "roas",
              text: `Platform-reported ROAS in ${curr} ${dir} from ${pRoas.toFixed(2)}x to ${cRoas.toFixed(2)}x.`,
              evidenceRef: `metric:roas:${curr}`,
            });
          } else if (cRoas != null) {
            observations.push({
              id: `obs_roas_trend_${curr.toLowerCase()}`,
              type: "roas",
              text: `Platform-reported ROAS in ${curr}: ${cRoas.toFixed(2)}x.`,
              evidenceRef: `metric:roas:${curr}`,
            });
          }
        } else if (cRoas != null) {
          observations.push({
            id: `obs_roas_trend_${curr.toLowerCase()}`,
            type: "roas",
            text: `Platform-reported ROAS in ${curr}: ${cRoas.toFixed(2)}x.`,
            evidenceRef: `metric:roas:${curr}`,
          });
        }
      }

      if (!hasAmbiguousShopeeRows && cCurr && cCurr.marketplaceRevenue > 0) {
        observations.push({
          id: `obs_marketplace_split_${curr.toLowerCase()}`,
          type: "marketplace",
          text: `Marketplace commerce generated ${cCurr.marketplaceOrders.toLocaleString()} direct orders and ${curr} ${cCurr.marketplaceRevenue.toLocaleString()} store revenue, tracked separately from ad conversions.`,
          evidenceRef: `metric:marketplace_revenue:${curr}`,
        });
      }
    }

    if (!comparisonAvailable) {
      observations.push({
        id: "obs_comparison_plan_limited",
        type: "limitation",
        text: comparisonUnavailableReason ?? `Prior-period comparison is unavailable under the ${planLimits.displayName} plan limit (${planLimits.maxHistoryDays} days max history).`,
        evidenceRef: "plan:history_limit",
      });
    }

    if (totalCurrentConversions > 0) {
      const ctr = totalCurrentImpressions > 0 ? (totalCurrentClicks / totalCurrentImpressions) * 100 : null;
      observations.push({
        id: "obs_conversions",
        type: "conversion",
        text: `Recorded ${totalCurrentConversions.toLocaleString()} platform-reported conversions across ${totalCurrentClicks.toLocaleString()} clicks and ${totalCurrentImpressions.toLocaleString()} impressions${ctr != null ? ` (CTR: ${ctr.toFixed(2)}%)` : ""}.`,
        evidenceRef: "metric:conversions",
      });
    }

    if (hasAmbiguousShopeeRows) {
      observations.push({
        id: "obs_shopee_ambiguity",
        type: "limitation",
        text: "Shopee data contains rows that cannot be definitively separated between advertising-attributed revenue and marketplace order revenue. Affected marketplace and advertising totals are withheld.",
        evidenceRef: "provenance:shopee_ambiguity",
      });
    }

    if (hasUnknownCurrency) {
      observations.push({
        id: "obs_currency_unknown",
        type: "limitation",
        text: "Data contains monetary records with missing or unknown currency. Monetary totals and conclusions are withheld to prevent misattribution.",
        evidenceRef: "provenance:unknown_currency",
      });
    }

    const isTimezoneVerified = windows.timezoneSource === "verified";
    if (!isTimezoneVerified) {
      observations.push({
        id: "obs_timezone_unverified",
        type: "limitation",
        text: `Reporting timezone context is ${windows.timezoneSource} (${windows.timezone}). Verified account timezone is required for client export eligibility.`,
        evidenceRef: "timezone:unverified",
      });
    }

    if (observedCurrencies.length > 1) {
      observations.push({
        id: "obs_currency_isolation",
        type: "limitation",
        text: `Multiple currencies observed (${observedCurrencies.join(", ")}). Metrics are reported in their native currencies; no implicit conversion was applied.`,
        evidenceRef: "readiness:currencies",
      });
    }

    // Canonical Readiness Status MUST be preserved exactly
    const readinessStatus: "READY" | "WARNING" | "NOT_READY" | "UNKNOWN" = evaluation.status;

    // Build Canonical Freshness Journey
    const canonicalJourney = buildFreshnessJourney(evaluation);
    const worstSourceHealth = reduceFreshness(evaluation.providers.map((p) => p.health));
    const freshnessJourney: FreshnessJourney = {
      ...canonicalJourney,
      sourceHealth: worstSourceHealth,
      warehouseFreshness: evaluation.freshness,
      readinessStatus: evaluation.status,
      deliveryStatus: evaluation.destination.state === "unavailable" ? "unconfigured" : evaluation.destination.state,
    };

    // Completeness from actual scoped evidence
    const limitReached = evaluation.evidence.limited || evaluation.warnings.some((w) => w.code === "EVIDENCE_LIMIT_REACHED");
    const incompleteWindow = evaluation.blockers.some((b) => b.code === "REPORTING_WINDOW_INCOMPLETE");

    // Collect scoped missing dates from all provider accounts
    const missingDatesSet = new Set<string>();
    for (const prov of evaluation.providers) {
      if (prov.evidence?.accounts) {
        for (const acc of prov.evidence.accounts) {
          if (Array.isArray(acc.missingDates)) {
            for (const d of acc.missingDates) {
              missingDatesSet.add(d);
            }
          }
        }
      }
    }

    let missingDays: number | null = null;
    let coverageStatus: "complete" | "incomplete" | "unknown" = "unknown";

    if (limitReached) {
      missingDays = null;
      coverageStatus = "unknown";
    } else if (missingDatesSet.size > 0) {
      missingDays = missingDatesSet.size;
      coverageStatus = "incomplete";
    } else if (incompleteWindow) {
      missingDays = null;
      coverageStatus = "incomplete";
    } else if (evaluation.providers.length > 0 && evaluation.status === "READY") {
      missingDays = 0;
      coverageStatus = "complete";
    } else {
      missingDays = null;
      coverageStatus = "unknown";
    }

    const exportEligible =
      evaluation.status === "READY" &&
      isTimezoneVerified &&
      !hasAmbiguousShopeeRows &&
      !hasUnknownCurrency &&
      !limitReached;

    const blockers = evaluation.blockers.map((b) => b.code);
    if (!isTimezoneVerified && !blockers.includes("TIMEZONE_UNKNOWN")) {
      blockers.push("TIMEZONE_UNKNOWN");
    }
    if (hasAmbiguousShopeeRows && !blockers.includes("SOURCE_UNVERIFIED")) {
      blockers.push("SOURCE_UNVERIFIED");
    }
    if (hasUnknownCurrency && !blockers.includes("CURRENCY_UNKNOWN")) {
      blockers.push("CURRENCY_UNKNOWN");
    }

    // Brief-specific composite fingerprint covering both reporting periods, scopes, and contracts
    const briefFingerprintPayload = {
      version: REPORTING_BRIEF_FINGERPRINT_VERSION,
      catalogVersion: REPORTING_METRIC_CATALOG_VERSION,
      workspaceId,
      clientId,
      scope: isExplicit
        ? assignments.map((a) => `${a.provider}:${a.accountId}:${a.connectionId}`).sort()
        : `legacy:${clientId}`,
      timezone: windows.timezone,
      timezoneSource: windows.timezoneSource,
      windows: {
        preset: windows.preset,
        current: windows.current,
        prior: windows.prior,
        daysCount: windows.daysCount,
        comparisonAvailable: windows.comparisonAvailable,
      },
      currentDatasetFingerprint: snapshot.fingerprint,
      priorDatasetFingerprint: priorSnapshot ? priorSnapshot.fingerprint : null,
      comparisonAvailable,
      hasAmbiguousShopeeRows,
      hasUnknownCurrency,
    };
    const briefFingerprint = createHash("sha256")
      .update(JSON.stringify(briefFingerprintPayload))
      .digest("hex");

    return {
      workspaceId,
      clientId,
      clientName: client.name,
      plan: client.workspace.plan,
      windows,
      readiness: {
        status: readinessStatus, // Canonical evaluator status preserved
        exportEligible,
        blockers,
        warnings: evaluation.warnings.map((w) => w.code),
        latestDataDate: evaluation.latestDataDate,
        currencies: observedCurrencies,
        timezone: evaluation.timezones.length === 1 ? evaluation.timezones[0] : null,
        fingerprint: snapshot.fingerprint, // Preserves destination-receipt fingerprint contract
      },
      freshnessJourney,
      completeness: {
        coverageStatus,
        sourceCount: evaluation.providers.length,
        partialCount: evaluation.providers.filter((p) => p.health === "partial").length,
        missingDays,
        limitReached,
      },
      metrics,
      channels,
      observations,
      evaluatedAt: new Date().toISOString(),
      fingerprint: briefFingerprint, // Brief-specific fingerprint covering both periods and scope
    };
  };

  if (options.tx) {
    return runWithTx(options.tx);
  }

  return withDatabaseTenantContext(
    prisma as any,
    workspaceId,
    runWithTx as (tx: any) => Promise<ReportingContext>,
    { isolationLevel: "RepeatableRead", timeout: 15_000 },
  );
}
