/**
 * Connection-level sync lease — reuses the `SyncLock` model (advisory xact lock +
 * lease row + monotonic fencing token) that meta-sync-lock.ts established, but at
 * whole-connection granularity so that ANY two execution paths (manual sync,
 * cron warehouse-refresh, batch import, OAuth backfill) cannot run the same
 * connection simultaneously, regardless of provider.
 *
 * The lease also fences outcome persistence: a worker that lost its lease
 * (expiry + steal) fails `assertConnectionSyncLease` and must not update
 * lastSyncAt / status / lastError.
 */
import crypto from "node:crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export const LEASE_DURATION_MS = 20 * 60 * 1000; // 20 minutes — stale workers release by expiry

export type ConnectionLease = {
  scope: string;
  leaseId: string;
  fencingToken: bigint;
};

export type ConnectionLeaseResult =
  | { acquired: true; lease: ConnectionLease }
  | { acquired: false; reason: "active" | "db_lock_busy" };

export function buildConnectionScope(params: {
  provider: string;
  workspaceId: string;
  connectionId: string;
}): string {
  // NOTE: must keep the `${provider}:${workspaceId}:${connectionId}:` prefix
  // convention so Meta's force-unlock (`scope LIKE 'meta_ads:ws:conn:%'`)
  // also clears the connection-level lease.
  return `${params.provider}:${params.workspaceId}:${params.connectionId}:__sync__`;
}

export async function acquireConnectionSyncLease(params: {
  provider: string;
  workspaceId: string;
  connectionId: string;
  jobId?: string;
}): Promise<ConnectionLeaseResult> {
  const scope = buildConnectionScope(params);
  const leaseId = crypto.randomUUID();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ locked: boolean }>>(
      `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked`,
      scope,
    );
    if (rows[0]?.locked !== true) {
      return { acquired: false as const, reason: "db_lock_busy" as const };
    }

    const current = await (tx as any).syncLock.findUnique({ where: { scope } });
    if (current && current.status === "running" && current.leaseExpiresAt > now) {
      return { acquired: false as const, reason: "active" as const };
    }

    const nextFencingToken = BigInt(current?.fencingToken ?? 0) + BigInt(1);
    const lock = await (tx as any).syncLock.upsert({
      where: { scope },
      create: {
        scope,
        provider: params.provider,
        workspaceId: params.workspaceId,
        connectionId: params.connectionId,
        accountId: "__sync__",
        jobId: params.jobId ?? "adhoc",
        leaseId,
        fencingToken: nextFencingToken,
        status: "running",
        heartbeatAt: now,
        leaseExpiresAt,
      },
      update: {
        jobId: params.jobId ?? "adhoc",
        leaseId,
        fencingToken: nextFencingToken,
        status: "running",
        heartbeatAt: now,
        leaseExpiresAt,
      },
    });

    return {
      acquired: true as const,
      lease: { scope, leaseId: lock.leaseId as string, fencingToken: lock.fencingToken as bigint },
    };
  });
}

/** Throws if this worker no longer owns the lease (expired/stolen/token advanced). */
export async function assertConnectionSyncLease(lease: ConnectionLease): Promise<void> {
  const lock = await (prisma as any).syncLock.findUnique({
    where: { scope: lease.scope },
    select: { leaseId: true, fencingToken: true, leaseExpiresAt: true, status: true },
  });
  if (
    !lock ||
    lock.status !== "running" ||
    lock.leaseId !== lease.leaseId ||
    BigInt(lock.fencingToken) !== lease.fencingToken ||
    new Date(lock.leaseExpiresAt) <= new Date()
  ) {
    throw new Error(
      `[SYNC_LEASE] Stale worker detected for scope=${lease.scope}. Refusing to update sync outcome.`,
    );
  }
}

/**
 * Extend the caller's lease and prove continued ownership in one atomic write.
 * Throws when the lease expired or was stolen, so long-running phases
 * (marketplace pagination, ad-platform row ingestion) can self-abort before
 * writing data on behalf of a dead generation.
 */
export async function heartbeatConnectionSyncLease(lease: ConnectionLease): Promise<void> {
  const updated = await (prisma as any).syncLock.updateMany({
    where: {
      scope: lease.scope,
      leaseId: lease.leaseId,
      status: "running",
      leaseExpiresAt: { gt: new Date() },
    },
    data: {
      heartbeatAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
    },
  });
  if (updated.count !== 1) {
    throw new Error(
      `[SYNC_LEASE] Lease lost for scope=${lease.scope}. Aborting current phase.`,
    );
  }
}

export async function releaseConnectionSyncLease(
  lease: ConnectionLease,
  success: boolean,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ locked: boolean }>>(
        `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked`,
        lease.scope,
      );
      if (rows[0]?.locked !== true) return;
      await (tx as any).syncLock.updateMany({
        where: { scope: lease.scope, leaseId: lease.leaseId },
        data: { status: success ? "released" : "failed", heartbeatAt: new Date(), leaseExpiresAt: new Date() },
      });
    });
  } catch (error) {
    logger.warn(`[SYNC_LEASE] Release failed for ${lease.scope} (expiry will recover):`, error);
  }
}
