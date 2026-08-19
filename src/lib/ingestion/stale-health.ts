import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

/** Pipelines and connected sources older than this are stale. */
export const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

export function isStaleTimestamp(
  lastAt: Date | null | undefined,
  createdAt: Date,
  now: Date = new Date(),
): boolean {
  const reference = lastAt ?? createdAt;
  return now.getTime() - reference.getTime() > STALE_AFTER_MS;
}

export type StaleHealthReport = {
  staleThreshold: string;
  pipelinesMarkedStale: number;
  staleSourceConnections: number;
};

/**
 * Marks healthy pipelines stale and counts warehouse sources that have not
 * synced within the freshness window. Connection lastError is left alone —
 * staleness is freshness, not a credential failure.
 */
export async function evaluateStaleHealth(now: Date = new Date()): Promise<StaleHealthReport> {
  const staleThreshold = new Date(now.getTime() - STALE_AFTER_MS);

  const stalePipelines = await prisma.pipeline.updateMany({
    where: {
      status: "active",
      healthStatus: "healthy",
      OR: [
        { lastSyncedAt: { lt: staleThreshold } },
        { lastSyncedAt: null, createdAt: { lt: staleThreshold } },
      ],
    },
    data: { healthStatus: "stale" },
  });

  const staleSourceConnections = await prisma.connection.count({
    where: {
      type: "source",
      status: "connected",
      OR: [
        { lastSyncAt: { lt: staleThreshold } },
        { lastSyncAt: null, createdAt: { lt: staleThreshold } },
      ],
    },
  });

  if (stalePipelines.count > 0) {
    logger.warn(`[STALE_HEALTH] Marked ${stalePipelines.count} pipeline(s) stale`);
  }
  if (staleSourceConnections > 0) {
    logger.warn(
      `[STALE_HEALTH] ${staleSourceConnections} connected source(s) have no successful sync within 26h`,
    );
  }

  return {
    staleThreshold: staleThreshold.toISOString(),
    pipelinesMarkedStale: stalePipelines.count,
    staleSourceConnections,
  };
}
