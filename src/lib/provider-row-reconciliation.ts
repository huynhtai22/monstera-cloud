/**
 * Provider stale-row reconciliation — OBSERVABILITY ONLY.
 *
 * Known Limitations §2: when a provider permanently stops returning a
 * previously stored row, Monstera does not reconcile the warehouse. This
 * module provides safe DETECTION without any destructive or misleading
 * mutation:
 *
 *   - It never deletes, soft-deletes, or rewrites CampaignMetric rows.
 *   - It computes stats only for a slice whose provider fetch is PROVABLY
 *     complete: the caller must pass `fetchComplete: true` only when every
 *     page succeeded, the window is fully covered, and no rows failed to
 *     ingest. Incomplete syncs, partial windows, retryable errors, and
 *     provider outages MUST NOT invoke comparison (a missing page would look
 *     like mass deletion).
 *   - Results are logged and returned for surfacing; consumers must present
 *     them as "possibly stale" signals, never as authoritative deletions.
 */
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface StaleRowStats {
  connectionId: string;
  accountId: string;
  level: string;
  windowDays: number;
  warehouseEntityCount: number;
  providerEntityCount: number;
  staleEntityIds: string[];
  staleRowCount: number;
  computedAt: string;
}

export interface ReconciliationInput {
  workspaceId: string;
  connectionId: string;
  accountId: string;
  level: string;
  since: Date;
  until: Date;
  /** Entity ids the provider returned for this exact slice. */
  providerEntityIds: Set<string> | string[];
  /**
   * Must be true ONLY when the provider fetch for this slice was provably
   * complete (all pages ok, full window, zero failed rows). False → no
   * comparison is performed (returns null).
   */
  fetchComplete: boolean;
}

export async function computeStaleRowStats(input: ReconciliationInput): Promise<StaleRowStats | null> {
  if (!input.fetchComplete) {
    logger.info(
      `[RECONCILE] Skipping stale-row comparison for ${input.connectionId}/${input.accountId}: provider fetch not provably complete`
    );
    return null;
  }

  const providerIds = new Set(
    [...(input.providerEntityIds instanceof Set ? input.providerEntityIds : new Set(input.providerEntityIds))].map((id) =>
      String(id).trim()
    ).filter(Boolean)
  );

  const warehouseRows = await prisma.campaignMetric.findMany({
    where: {
      workspaceId: input.workspaceId, // tenant fence
      connectionId: input.connectionId,
      accountId: input.accountId,
      level: input.level,
      date: { gte: input.since, lte: input.until },
    },
    select: { entityId: true },
  });

  const warehouseEntityIds = new Set(warehouseRows.map((r) => r.entityId));
  const staleEntityIds = [...warehouseEntityIds].filter((id) => !providerIds.has(id));

  const stats: StaleRowStats = {
    connectionId: input.connectionId,
    accountId: input.accountId,
    level: input.level,
    windowDays: Math.max(1, Math.round((input.until.getTime() - input.since.getTime()) / 86_400_000) + 1),
    warehouseEntityCount: warehouseEntityIds.size,
    providerEntityCount: providerIds.size,
    staleEntityIds: staleEntityIds.slice(0, 100),
    staleRowCount: staleEntityIds.length,
    computedAt: new Date().toISOString(),
  };

  if (staleEntityIds.length > 0) {
    logger.warn(
      `[RECONCILE] ${staleEntityIds.length} warehouse entit${staleEntityIds.length === 1 ? "y" : "ies"} for ` +
        `${input.connectionId}/${input.accountId} (level=${input.level}) were NOT returned by the provider in the ` +
        `complete ${stats.windowDays}-day window — possibly deleted at the provider. Rows are RETAINED (observability only).`
    );
  }
  return stats;
}
