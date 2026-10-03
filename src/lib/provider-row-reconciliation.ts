/**
 * Provider stale-row reconciliation — OBSERVABILITY ONLY.
 *
 * Requirements:
 * - Detects rows that exist in the warehouse but were not returned in a
 *   complete provider fetch for the identical time slice.
 * - Never deletes, soft-deletes, or mutates CampaignMetric rows.
 * - Gated on provably complete fetches (fetchComplete: true). Incomplete syncs,
 *   partial windows, or errors MUST NOT invoke comparison to prevent false positives.
 * - Results are logged and returned for surfacing.
 */
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withSystemScope } from "@/lib/tenant-guard";

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
    [...(input.providerEntityIds instanceof Set ? input.providerEntityIds : new Set(input.providerEntityIds))]
      .map((id) => String(id).trim())
      .filter(Boolean)
  );

  const warehouseRows = await withSystemScope(() =>
    prisma.campaignMetric.findMany({
      where: {
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        accountId: input.accountId,
        level: input.level,
        date: { gte: input.since, lte: input.until },
      },
      select: { entityId: true },
    })
  );

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
