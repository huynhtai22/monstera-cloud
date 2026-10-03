import prisma from "@/lib/prisma";
import type { SyncOutcome } from "@/lib/sync-outcome";
import { emitConnectorTelemetry, type ConnectorProvider } from "@/lib/observability/connector-telemetry";

/** Prefer the stored per-connection date; fall back to a live MAX(date) for pre-column rows. */
export function pickDataThroughDate(
  stored: Date | string | null | undefined,
  fallback: Date | string | null | undefined,
): Date | null {
  const first = toDate(stored);
  if (first) return first;
  return toDate(fallback);
}

export function shouldRefreshLastDataThrough(outcome: SyncOutcome): boolean {
  return outcome === "success";
}

/**
 * Set Connection.lastDataThrough to MAX(CampaignMetric.date) for this tenant-scoped connection.
 * Truthful freshness outcomes:
 * - Emits "advanced" only when the persisted date actually moves forward.
 * - Emits "unchanged" when the date equals/predates the stored value, or no row was updated.
 *
 * Concurrency-safe atomic conditional update ensures older dates never overwrite newer dates.
 */
export async function refreshConnectionLastDataThrough(
  workspaceId: string,
  connectionId: string,
): Promise<Date | null> {
  const conn = await prisma.connection.findFirst({
    where: { id: connectionId, workspaceId },
    select: { provider: true, lastDataThrough: true, status: true },
  });

  if (!conn || conn.status === "disconnected") {
    emitConnectorTelemetry({
      eventCategory: "freshness_event",
      provider: (conn?.provider as ConnectorProvider) || "warehouse_queue",
      operation: "data_through_refresh",
      workspaceId,
      connectionId,
      freshnessOutcome: "unchanged",
      outcome: "skipped",
      durationMs: 0,
    });
    return null;
  }

  const agg = await prisma.campaignMetric.aggregate({
    where: { workspaceId, connectionId },
    _max: { date: true },
  });
  const latest = agg._max.date;

  if (!latest) {
    emitConnectorTelemetry({
      eventCategory: "freshness_event",
      provider: (conn.provider as ConnectorProvider) || "warehouse_queue",
      operation: "data_through_refresh",
      workspaceId,
      connectionId,
      freshnessOutcome: "unchanged",
      outcome: "skipped",
      durationMs: 0,
    });
    return null;
  }

  // Atomic conditional update: update ONLY IF stored value is null OR strictly older than latest
  const updateResult = await prisma.connection.updateMany({
    where: {
      id: connectionId,
      workspaceId,
      status: { not: "disconnected" },
      OR: [
        { lastDataThrough: null },
        { lastDataThrough: { lt: latest } },
      ],
    },
    data: { lastDataThrough: latest },
  });

  const advanced = updateResult.count > 0;

  emitConnectorTelemetry({
    eventCategory: "freshness_event",
    provider: (conn.provider as ConnectorProvider) || "warehouse_queue",
    operation: "data_through_refresh",
    workspaceId,
    connectionId,
    freshnessOutcome: advanced ? "advanced" : "unchanged",
    outcome: "success",
    durationMs: 0,
  });

  return latest;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
