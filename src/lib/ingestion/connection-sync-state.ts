import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { assertConnectionSyncLease, type ConnectionLease } from "@/lib/connection-sync-lease";

type ConnIds = { sourceId: string; destinationId: string };

/**
 * Sync-outcome writes must never resurrect a disconnected connection (a sync that
 * raced with Disconnect must not flip status back to "connected"), so they use
 * updateMany with `status: { not: "disconnected" }` instead of unconditional update.
 *
 * Callers holding a connection lease (pipelines/run keeps one per connection
 * across ETL) pass `leases` so a worker that lost its lease to a newer
 * generation cannot clobber the current owner's lastSyncAt/lastError/status.
 */

export type ConnectionSyncLeases = {
  sourceId?: ConnectionLease;
  destinationId?: ConnectionLease;
};

async function assertOwned(
  connectionId: string,
  lease: ConnectionLease | undefined
): Promise<boolean> {
  if (!lease) return true;
  try {
    await assertConnectionSyncLease(lease);
    return true;
  } catch (error) {
    logger.warn(
      `[SYNC_STATE] Stale worker skipping outcome write for connection ${connectionId}:`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

/** After a successful sync (including 0 rows): show freshness, clear errors. */
export async function markConnectionsSyncedOk(ids: ConnIds, at: Date, leases?: ConnectionSyncLeases) {
  const sourceOwned = await assertOwned(ids.sourceId, leases?.sourceId);
  const destinationOwned = await assertOwned(ids.destinationId, leases?.destinationId);

  const ops: ReturnType<typeof prisma.connection.updateMany>[] = [];
  if (sourceOwned) {
    ops.push(
      prisma.connection.updateMany({
        where: { id: ids.sourceId, status: { not: "disconnected" } },
        data: { lastSyncAt: at, lastError: null, status: "connected" },
      })
    );
  }
  if (destinationOwned) {
    ops.push(
      prisma.connection.updateMany({
        where: { id: ids.destinationId, status: { not: "disconnected" } },
        data: { lastSyncAt: at, lastError: null, status: "connected" },
      })
    );
  }
  if (ops.length > 0) {
    await prisma.$transaction(ops);
  }
}

/** After a failed sync: surface error on both connections (destination write may have failed too). */
export async function markConnectionsSyncError(ids: ConnIds, errorLine: string, leases?: ConnectionSyncLeases) {
  const err = errorLine.slice(0, 2000);
  const sourceOwned = await assertOwned(ids.sourceId, leases?.sourceId);
  const destinationOwned = await assertOwned(ids.destinationId, leases?.destinationId);

  const ops: ReturnType<typeof prisma.connection.updateMany>[] = [];
  if (sourceOwned) {
    ops.push(
      prisma.connection.updateMany({
        where: { id: ids.sourceId, status: { not: "disconnected" } },
        data: { lastError: err, status: "connected" },
      })
    );
  }
  if (destinationOwned) {
    ops.push(
      prisma.connection.updateMany({
        where: { id: ids.destinationId, status: { not: "disconnected" } },
        data: { lastError: err, status: "connected" },
      })
    );
  }
  if (ops.length > 0) {
    await prisma.$transaction(ops);
  }
}
