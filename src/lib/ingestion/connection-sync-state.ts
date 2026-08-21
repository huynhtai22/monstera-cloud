import prisma from "@/lib/prisma";

type ConnIds = { sourceId: string; destinationId: string };

/**
 * Sync-outcome writes must never resurrect a disconnected connection (a sync that
 * raced with Disconnect must not flip status back to "connected"), so they use
 * updateMany with `status: { not: "disconnected" }` instead of unconditional update.
 */

/** After a successful sync (including 0 rows): show freshness, clear errors. */
export async function markConnectionsSyncedOk(ids: ConnIds, at: Date) {
  await prisma.$transaction([
    prisma.connection.updateMany({
      where: { id: ids.sourceId, status: { not: "disconnected" } },
      data: { lastSyncAt: at, lastError: null, status: "connected" },
    }),
    prisma.connection.updateMany({
      where: { id: ids.destinationId, status: { not: "disconnected" } },
      data: { lastSyncAt: at, lastError: null, status: "connected" },
    }),
  ]);
}

/** After a failed sync: surface error on both connections (destination write may have failed too). */
export async function markConnectionsSyncError(ids: ConnIds, errorLine: string) {
  const err = errorLine.slice(0, 2000);
  await prisma.$transaction([
    prisma.connection.updateMany({
      where: { id: ids.sourceId, status: { not: "disconnected" } },
      data: { lastError: err, status: "connected" },
    }),
    prisma.connection.updateMany({
      where: { id: ids.destinationId, status: { not: "disconnected" } },
      data: { lastError: err, status: "connected" },
    }),
  ]);
}
