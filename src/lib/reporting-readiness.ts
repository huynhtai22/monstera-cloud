import prisma from "@/lib/prisma";
import { resolveSourceHealthState, SOURCE_HEALTH_STALE_AFTER_MS, type SourceHealthState } from "@/lib/source-health";
import { reduceFreshness, type EvidenceFreshness } from "@/lib/ai/evidence-pack";
import { loadReportReadiness } from "./report-readiness-server";
import { defaultReportingWindow } from "./report-readiness";

export type ReadinessStatus = "ready" | "best_effort" | "blocked";

export type ReportingReadiness = {
  status: ReadinessStatus;
  exportable: boolean;
  freshness: EvidenceFreshness;
  currencies: string[];
  lastDataThrough: string | null;
  destinationConfigured: boolean;
  blockers: string[];
  sources: Array<{
    connectionId: string;
    provider: string;
    health: SourceHealthState;
    lastDataThrough: string | null;
  }>;
};

export type ReadinessWindow = {
  since?: string;
  until?: string;
  clientId?: string;
};

function startOfUtcDay(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
}

function endOfUtcDay(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 10)}T23:59:59.999Z`);
}

export async function deriveReportingReadiness(
  workspaceId: string,
  window: ReadinessWindow = {},
): Promise<ReportingReadiness> {
  // Preserve the legacy consumer shape, but never maintain a second client decision rule.
  if (window.clientId) {
    const defaults = defaultReportingWindow();
    const { evaluations: [evaluation] } = await loadReportReadiness(workspaceId, {
      start: window.since ?? defaults.start, end: window.until ?? defaults.end,
    }, { clientId: window.clientId });
    return {
      status: evaluation.status === "READY" ? "ready" : evaluation.status === "WARNING" ? "best_effort" : "blocked",
      exportable: evaluation.status === "READY",
      freshness: reduceFreshness(evaluation.providers.map(p => p.health)),
      currencies: evaluation.currencies, lastDataThrough: evaluation.latestDataDate,
      destinationConfigured: evaluation.destination.configuredCount > 0,
      blockers: [...evaluation.blockers, ...evaluation.warnings].map(i => i.code),
      sources: evaluation.providers.map(p => ({ connectionId: p.connectionId, provider: p.provider, health: p.health, lastDataThrough: p.latestDataDate })),
    };
  }
  const staleBefore = new Date(Date.now() - SOURCE_HEALTH_STALE_AFTER_MS);
  const connections = await prisma.connection.findMany({
    where: {
      workspaceId,
      type: "source",
      ...(window.clientId ? { clientId: window.clientId } : {}),
    },
    select: {
      id: true,
      provider: true,
      status: true,
      lastError: true,
      lastSyncAt: true,
      lastDataThrough: true,
    },
  });

  const destinations = await prisma.connection.count({
    where: { workspaceId, type: "destination" },
  });
  const apiKeys = await prisma.apiKey.count({
    where: { workspaceId },
  });
  const destinationConfigured = destinations > 0 || apiKeys > 0;

  const sources = connections.map((connection) => ({
    connectionId: connection.id,
    provider: connection.provider,
    health: resolveSourceHealthState({
      connectionStatus: connection.status,
      lastError: connection.lastError,
      lastSyncAt: connection.lastSyncAt,
      staleBefore,
    }),
    lastDataThrough: connection.lastDataThrough?.toISOString() ?? null,
  }));

  const freshness = reduceFreshness(sources.map((source) => source.health));
  const lastDataThroughDates = sources
    .map((source) => source.lastDataThrough)
    .filter((value): value is string => Boolean(value))
    .sort();
  const lastDataThrough = lastDataThroughDates.at(-1) ?? null;

  const metricWhere = {
    workspaceId,
    ...(window.clientId
      ? { connection: { clientId: window.clientId } }
      : {}),
    ...(window.since || window.until
      ? {
          date: {
            ...(window.since ? { gte: startOfUtcDay(window.since) } : {}),
            ...(window.until ? { lte: endOfUtcDay(window.until) } : {}),
          },
        }
      : {}),
  };

  const currencyRows = await prisma.campaignMetric.findMany({
    where: metricWhere,
    distinct: ["currency"],
    select: { currency: true },
    take: 20,
  });
  const currencies = [...new Set(
    currencyRows
      .map((row) => row.currency?.trim().toUpperCase())
      .filter((value): value is string => Boolean(value)),
  )];

  const blockers: string[] = [];
  if (sources.length === 0) blockers.push("no_sources");
  if (!destinationConfigured) blockers.push("no_destination");
  if (currencies.length === 0) blockers.push("currency_unknown");
  if (freshness === "partial") blockers.push("partial_sync");
  if (freshness === "failed") blockers.push("source_error");
  if (freshness === "never") blockers.push("never_synced");
  if (window.until && lastDataThrough && lastDataThrough.slice(0, 10) < window.until.slice(0, 10)) {
    blockers.push("data_through_before_window_end");
  }
  if (window.since && lastDataThrough && lastDataThrough.slice(0, 10) < window.since.slice(0, 10)) {
    blockers.push("data_through_before_window_start");
  }

  const staleOnly = freshness === "stale" || freshness === "refreshing";
  let status: ReadinessStatus = "blocked";
  if (blockers.length === 0 && freshness === "fresh") status = "ready";
  else if (blockers.length === 0 && staleOnly) status = "best_effort";
  else if (
    blockers.length === 1
    && blockers[0] === "data_through_before_window_end"
    && (freshness === "fresh" || staleOnly)
  ) {
    status = "best_effort";
  }

  return {
    status,
    exportable: status === "ready",
    freshness,
    currencies,
    lastDataThrough,
    destinationConfigured,
    blockers,
    sources,
  };
}
