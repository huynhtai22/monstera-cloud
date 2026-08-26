import prisma from "@/lib/prisma";
import type { SyncOutcome } from "@/lib/sync-outcome";

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
 * No-op when there are no warehouse rows (does not fabricate a date).
 */
export async function refreshConnectionLastDataThrough(
  workspaceId: string,
  connectionId: string,
): Promise<Date | null> {
  const agg = await prisma.campaignMetric.aggregate({
    where: { workspaceId, connectionId },
    _max: { date: true },
  });
  const latest = agg._max.date;
  if (!latest) return null;

  await prisma.connection.updateMany({
    where: { id: connectionId, workspaceId, status: { not: "disconnected" } },
    data: { lastDataThrough: latest },
  });
  return latest;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
