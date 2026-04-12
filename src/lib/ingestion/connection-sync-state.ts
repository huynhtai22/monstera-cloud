import prisma from "@/lib/prisma";

type ConnIds = { sourceId: string; destinationId: string };

/** After a successful sync (including 0 rows): show freshness, clear errors. */
export async function markConnectionsSyncedOk(ids: ConnIds, at: Date) {
  await prisma.$transaction([
    prisma.connection.update({
      where: { id: ids.sourceId },
      data: { lastSyncAt: at, lastError: null, status: "connected" },
    }),
    prisma.connection.update({
      where: { id: ids.destinationId },
      data: { lastSyncAt: at, lastError: null, status: "connected" },
    }),
  ]);
}

/** After a failed sync: surface error on both connections (destination write may have failed too). */
export async function markConnectionsSyncError(ids: ConnIds, errorLine: string) {
  const err = errorLine.slice(0, 2000);
  await prisma.$transaction([
    prisma.connection.update({
      where: { id: ids.sourceId },
      data: { lastError: err, status: "connected" },
    }),
    prisma.connection.update({
      where: { id: ids.destinationId },
      data: { lastError: err, status: "connected" },
    }),
  ]);
}
