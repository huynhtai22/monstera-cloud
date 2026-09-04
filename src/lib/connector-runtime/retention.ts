/**
 * Connector Runtime v1 — retention enforcement for connector artifacts.
 *
 * Deletes only expired ConnectorRunArtifact rows in bounded batches.
 * Never touches certification evidence, warehouse metrics, or unexpired
 * artifacts. A bounded summary is returned (and audited when anything was
 * deleted, so repeated empty cleanups do not bloat the audit log).
 */
import prisma from "@/lib/prisma";
import { withSystemScope } from "@/lib/tenant-guard";

export const DEFAULT_CLEANUP_BATCH_LIMIT = 500;
export const MAX_CLEANUP_BATCH_LIMIT = 1000;

export interface ArtifactCleanupSummary {
  deleted: number;
  cutoff: string;
  batchLimit: number;
  hasMore: boolean;
}

export function normalizeCleanupInput(input: { before?: unknown; limit?: unknown }): {
  cutoff: Date;
  batchLimit: number;
} {
  const now = Date.now();
  const before = input.before instanceof Date ? input.before : new Date(now);
  const cutoff = Number.isNaN(before.getTime()) ? new Date(now) : before;
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.min(MAX_CLEANUP_BATCH_LIMIT, Math.max(1, Math.floor(input.limit)))
      : DEFAULT_CLEANUP_BATCH_LIMIT;
  return { cutoff, batchLimit: limit };
}

export async function cleanupExpiredArtifacts(input: {
  before?: unknown;
  limit?: unknown;
}): Promise<ArtifactCleanupSummary> {
  const { cutoff, batchLimit } = normalizeCleanupInput(input);
  return withSystemScope(async () => {
    const expired = await prisma.connectorRunArtifact.findMany({
      where: { retainedUntil: { lt: cutoff } },
      select: { id: true, workspaceId: true },
      orderBy: { createdAt: "asc" },
      take: batchLimit + 1,
    });
    const batch = expired.slice(0, batchLimit);
    let deleted = 0;
    if (batch.length > 0) {
      const removed = await prisma.connectorRunArtifact.deleteMany({
        // Re-check the cutoff inside the delete so concurrent expiries stay exact.
        where: { id: { in: batch.map((row) => row.id) }, retainedUntil: { lt: cutoff } },
      });
      deleted = removed.count;
      await prisma.auditEvent.create({
        data: {
          workspaceId: batch[0].workspaceId,
          actorUserId: null,
          action: "connector_runtime.cleanup",
          resource: "system",
          resourceId: "connector-artifacts",
          metadata: {
            system: "connector-runtime-worker",
            deleted,
            cutoff: cutoff.toISOString(),
            batchLimit,
          },
        },
      });
    }
    return {
      deleted,
      cutoff: cutoff.toISOString(),
      batchLimit,
      hasMore: expired.length > batchLimit,
    };
  });
}
