/**
 * PostgreSQL advisory-lock-based sync ownership for Meta Ads.
 *
 * Three-layer safety model (per design doc):
 *   1. pg_try_advisory_xact_lock   — short atomic ownership decision
 *   2. SyncLock persistent lease   — leaseId + fencingToken + heartbeat
 *   3. CampaignMetric upsert       — deterministic unique key prevents duplicates
 *
 * Scope key format: meta_ads:{workspaceId}:{connectionId}:{adAccountId}
 *
 * Invariant:
 *   Advisory lock decides who may CLAIM the lease.
 *   Lease row decides who may WRITE.
 *   Unique constraints decide what may EXIST.
 */

import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

const LEASE_DURATION_MS = 20 * 60 * 1000; // 20 minutes

// ── Scope helpers ─────────────────────────────────────────────────────────────

export function buildSyncScope(params: {
  workspaceId: string;
  connectionId: string;
  adAccountId: string;
}): string {
  return `meta_ads:${params.workspaceId}:${params.connectionId}:${params.adAccountId}`;
}

// ── Acquire ───────────────────────────────────────────────────────────────────

export type AcquireResult =
  | { acquired: true; scope: string; leaseId: string; fencingToken: bigint }
  | { acquired: false; reason: 'active' | 'db_lock_busy'; scope: string };

/**
 * Try to claim a sync lease for one Meta ad account.
 *
 * - Uses pg_try_advisory_xact_lock(advisory_lock_key(scope)) inside a short
 *   transaction so two workers can never simultaneously claim/steal the same scope.
 * - If a lease exists and is NOT expired → returns { acquired: false, reason: 'active' }.
 * - If a lease is expired (stale worker) → steals it, increments fencingToken.
 * - If the advisory DB lock itself is contended → returns { acquired: false, reason: 'db_lock_busy' }.
 */
export async function acquireMetaSyncLock(params: {
  workspaceId: string;
  connectionId: string;
  adAccountId: string;
  jobId: string;
}): Promise<AcquireResult> {
  const { workspaceId, connectionId, adAccountId, jobId } = params;
  const scope = buildSyncScope({ workspaceId, connectionId, adAccountId });
  const leaseId = crypto.randomUUID();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);

  return prisma.$transaction(async (tx) => {
    // ── 1. Advisory transaction lock (short; auto-released when tx commits) ──
    const rows = await tx.$queryRawUnsafe<Array<{ locked: boolean }>>(
      `SELECT pg_try_advisory_xact_lock(advisory_lock_key($1)) AS locked`,
      scope,
    );

    if (rows[0]?.locked !== true) {
      logger.warn(`[META_LOCK] Advisory lock busy for scope ${scope}`);
      return { acquired: false as const, reason: 'db_lock_busy' as const, scope };
    }

    // ── 2. Check for an active (non-expired) lease ────────────────────────────
    const current = await (tx as any).syncLock.findUnique({ where: { scope } });

    if (current && current.status === 'running' && current.leaseExpiresAt > now) {
      logger.info(`[META_LOCK] Active lease found for ${scope}, skipping`);
      return { acquired: false as const, reason: 'active' as const, scope };
    }

    // ── 3. Claim or steal the lease; increment fencingToken ───────────────────
    const nextFencingToken = BigInt(current?.fencingToken ?? 0) + BigInt(1);

    const lock = await (tx as any).syncLock.upsert({
      where: { scope },
      create: {
        scope,
        provider: 'meta_ads',
        workspaceId,
        connectionId,
        accountId: adAccountId,
        jobId,
        leaseId,
        fencingToken: nextFencingToken,
        status: 'running',
        heartbeatAt: now,
        leaseExpiresAt,
      },
      update: {
        jobId,
        leaseId,
        fencingToken: nextFencingToken,
        status: 'running',
        heartbeatAt: now,
        leaseExpiresAt,
      },
    });

    logger.info(
      `[META_LOCK] Acquired scope=${scope} leaseId=${leaseId} fencingToken=${nextFencingToken}`,
    );

    return {
      acquired: true as const,
      scope,
      leaseId: lock.leaseId as string,
      fencingToken: lock.fencingToken as bigint,
    };
  });
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

/**
 * Extend the lease after each Meta API page or write batch.
 * Throws immediately if the lease has been stolen by a newer worker.
 */
export async function heartbeatMetaSyncLock(params: {
  scope: string;
  leaseId: string;
}): Promise<void> {
  const { scope, leaseId } = params;

  const updated = await (prisma as any).syncLock.updateMany({
    where: { scope, leaseId, status: 'running' },
    data: {
      heartbeatAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
    },
  });

  if (updated.count !== 1) {
    throw new Error(
      `[META_LOCK] Lease lost for scope=${scope}. Abort worker immediately.`,
    );
  }
}

// ── Assert lease before writes ────────────────────────────────────────────────

/**
 * Verify this worker still owns the lease before writing metrics.
 * Throws if the lease has expired, been stolen, or the fencingToken has advanced.
 */
export async function assertMetaSyncLease(params: {
  scope: string;
  leaseId: string;
  fencingToken: bigint;
}): Promise<void> {
  const { scope, leaseId, fencingToken } = params;

  const lock = await (prisma as any).syncLock.findUnique({
    where: { scope },
    select: { leaseId: true, fencingToken: true, leaseExpiresAt: true, status: true },
  });

  if (
    !lock ||
    lock.status !== 'running' ||
    lock.leaseId !== leaseId ||
    BigInt(lock.fencingToken) !== fencingToken ||
    new Date(lock.leaseExpiresAt) <= new Date()
  ) {
    throw new Error(
      `[META_LOCK] Stale worker detected for scope=${scope}. Refusing to write metrics.`,
    );
  }
}

// ── Fenced upsert ─────────────────────────────────────────────────────────────

export interface MetaMetricPayload {
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  cpc: number;
  ctr: number;
  conversions: number;
  revenue: number;
  roas: number;
  currency?: string;
  rawData?: unknown;
}

/**
 * Assert lease ownership then atomically upsert one CampaignMetric row.
 * A zombie worker with a stale leaseId/fencingToken is rejected before it can write.
 */
export async function upsertMetaMetric(params: {
  workspaceId: string;
  connectionId: string;
  accountId: string;
  accountName?: string;
  level: string;
  entityId: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adId?: string;
  date: Date;
  breakdownHash: string;
  metrics: MetaMetricPayload;
  syncJobId: string;
  lockScope: string;
  leaseId: string;
  fencingToken: bigint;
}): Promise<void> {
  const {
    workspaceId, connectionId, accountId, accountName,
    level, entityId, campaignId, campaignName, adsetId, adId,
    date, breakdownHash, metrics, syncJobId, lockScope, leaseId, fencingToken,
  } = params;

  // Fencing check — reject stale workers before any DB write
  await assertMetaSyncLease({ scope: lockScope, leaseId, fencingToken });

  await (prisma as any).campaignMetric.upsert({
    where: {
      connectionId_accountId_level_entityId_date_breakdownHash: {
        connectionId,
        accountId,
        level,
        entityId,
        date,
        breakdownHash,
      },
    },
    create: {
      workspaceId,
      connectionId,
      platform: 'meta_ads',
      accountId,
      accountName: accountName ?? null,
      level,
      entityId,
      campaignId: campaignId ?? '',
      campaignName: campaignName ?? '',
      adsetId: adsetId ?? '',
      adId: adId ?? '',
      date,
      breakdownHash,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      spend: metrics.spend,
      reach: metrics.reach,
      cpc: metrics.cpc,
      ctr: metrics.ctr,
      conversions: metrics.conversions,
      revenue: metrics.revenue,
      roas: metrics.roas,
      currency: metrics.currency ?? null,
      rawData: metrics.rawData ? JSON.stringify(metrics.rawData) : null,
      syncJobId,
      lockScope,
      fencingToken,
    },
    update: {
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      spend: metrics.spend,
      reach: metrics.reach,
      cpc: metrics.cpc,
      ctr: metrics.ctr,
      conversions: metrics.conversions,
      revenue: metrics.revenue,
      roas: metrics.roas,
      currency: metrics.currency ?? null,
      rawData: metrics.rawData ? JSON.stringify(metrics.rawData) : null,
      pulledAt: new Date(),
      syncJobId,
      lockScope,
      fencingToken,
    },
  });
}

// ── Release ───────────────────────────────────────────────────────────────────

/**
 * Release the sync lease after the job completes or fails.
 * Uses a short advisory transaction to ensure no other worker is mid-claim.
 */
export async function releaseMetaSyncLock(params: {
  scope: string;
  leaseId: string;
  success: boolean;
}): Promise<void> {
  const { scope, leaseId, success } = params;

  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ locked: boolean }>>(
      `SELECT pg_try_advisory_xact_lock(advisory_lock_key($1)) AS locked`,
      scope,
    );

    if (rows[0]?.locked !== true) {
      logger.warn(`[META_LOCK] Could not acquire advisory lock during release for ${scope}`);
      return;
    }

    await (tx as any).syncLock.updateMany({
      where: { scope, leaseId },
      data: {
        status: success ? 'released' : 'failed',
        heartbeatAt: new Date(),
        leaseExpiresAt: new Date(),
      },
    });
  });

  logger.info(`[META_LOCK] Released scope=${scope} success=${success}`);
}
