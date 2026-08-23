/**
 * Generic ad platform ingestion for CampaignMetric.
 *
 * Callers inside a connection-sync lease pass `lease` so rows are stamped with
 * lockScope/fencingToken evidence and the loop heartbeats + self-aborts when
 * the lease is lost. Callers without a lease keep the legacy unfenced behavior.
 */

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  heartbeatConnectionSyncLease,
  type ConnectionLease,
} from '@/lib/connection-sync-lease';

export interface CampaignMetricPayload {
  workspaceId: string;
  connectionId: string;
  platform: string; // 'google_ads' | 'tiktok_business' | 'meta_ads'
  accountId: string;
  accountName?: string;
  level: string;
  entityId: string;
  campaignId: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  adId?: string;
  date: Date;
  breakdownHash?: string;
  impressions: number;
  clicks: number;
  spend: number;
  reach?: number;
  cpc: number;
  ctr: number;
  conversions: number;
  revenue?: number;
  roas?: number;
  currency?: string;
  rawData?: unknown;
  syncJobId?: string;
  /** When present, the row is stamped with lease evidence and ingestion is fenced. */
  lease?: ConnectionLease;
}

/**
 * Upsert a campaign metric row.
 * Pass `lease` to stamp lease evidence (lockScope + fencingToken) onto the row;
 * without it the write is unfenced (legacy behavior for callers outside a
 * connection-lease scope).
 */
export async function upsertCampaignMetric(
  payload: CampaignMetricPayload
): Promise<void> {
  const {
    workspaceId,
    connectionId,
    platform,
    accountId,
    accountName,
    level,
    entityId,
    campaignId,
    campaignName,
    adsetId,
    adsetName,
    adId,
    date,
    breakdownHash = 'none',
    impressions,
    clicks,
    spend,
    reach = 0,
    cpc,
    ctr,
    conversions,
    revenue = 0,
    roas = 0,
    currency,
    rawData,
    syncJobId,
    lease,
  } = payload;

  // Do not manufacture a USD label when a provider did not supply currency.
  // Monetary rows must remain unlabelled until their real source currency is known.
  const safeCurrency = currency?.trim() || null;
  const safeCampaignId = campaignId?.trim() || entityId?.trim() || 'unknown_campaign';
  const safeCampaignName = campaignName?.trim() || safeCampaignId;
  const safeEntityId = entityId?.trim() || safeCampaignId;
  const safeLevel = level?.trim() || 'campaign';
  const safeBreakdownHash = breakdownHash?.trim() || 'none';

  const safeImpressions = Number.isFinite(impressions) ? Math.max(0, Math.round(impressions)) : 0;
  const safeClicks = Number.isFinite(clicks) ? Math.max(0, Math.round(clicks)) : 0;
  const safeSpend = Number.isFinite(spend) ? Math.max(0, spend) : 0;
  const safeReach = Number.isFinite(reach) ? Math.max(0, Math.round(reach)) : 0;
  const safeConversions = Number.isFinite(conversions) ? Math.max(0, conversions) : 0;
  const safeRevenue = Number.isFinite(revenue) ? Math.max(0, revenue) : 0;
  const safeRoas = Number.isFinite(roas) ? Math.max(0, roas) : 0;
  const safeCpc = Number.isFinite(cpc) ? Math.max(0, cpc) : safeClicks > 0 ? safeSpend / safeClicks : 0;
  const safeCtr = Number.isFinite(ctr) ? Math.max(0, ctr) : safeImpressions > 0 ? (safeClicks / safeImpressions) * 100 : 0;

  await (prisma as any).campaignMetric.upsert({
    where: {
      connectionId_accountId_level_entityId_date_breakdownHash: {
        connectionId,
        accountId,
        level: safeLevel,
        entityId: safeEntityId,
        date,
        breakdownHash: safeBreakdownHash,
      },
    },
    create: {
      workspaceId,
      connectionId,
      platform,
      accountId,
      accountName: accountName ?? null,
      level: safeLevel,
      entityId: safeEntityId,
      campaignId: safeCampaignId,
      campaignName: safeCampaignName,
      adsetId: adsetId ?? '',
      adsetName: adsetName ?? null,
      adId: adId ?? '',
      date,
      breakdownHash: safeBreakdownHash,
      impressions: safeImpressions,
      clicks: safeClicks,
      spend: safeSpend,
      reach: safeReach,
      cpc: safeCpc,
      ctr: safeCtr,
      conversions: safeConversions,
      revenue: safeRevenue,
      roas: safeRoas,
      currency: safeCurrency,
      rawData: rawData ? JSON.stringify(rawData) : null,
      syncJobId: syncJobId ?? null,
      pulledAt: new Date(),
      lockScope: lease?.scope ?? null,
      fencingToken: lease?.fencingToken ?? null,
    },
    update: {
      accountName: accountName ?? null,
      campaignId: safeCampaignId,
      campaignName: safeCampaignName,
      adsetId: adsetId ?? '',
      adsetName: adsetName ?? null,
      adId: adId ?? '',
      impressions: safeImpressions,
      clicks: safeClicks,
      spend: safeSpend,
      reach: safeReach,
      cpc: safeCpc,
      ctr: safeCtr,
      conversions: safeConversions,
      revenue: safeRevenue,
      roas: safeRoas,
      currency: safeCurrency,
      rawData: rawData ? JSON.stringify(rawData) : null,
      syncJobId: syncJobId ?? null,
      pulledAt: new Date(),
      lockScope: lease?.scope ?? null,
      fencingToken: lease?.fencingToken ?? null,
    },
  });
}

const FENCED_HEARTBEAT_INTERVAL_ROWS = 100;

/**
 * Shared row-loop for fenced ingestion: heartbeats the connection lease every
 * FENCED_HEARTBEAT_INTERVAL_ROWS so a worker that lost its lease (expiry +
 * steal) stops writing rows instead of continuing as a zombie generation.
 * Returns false when the lease was lost mid-loop.
 */
async function fencedHeartbeat(
  lease: ConnectionLease | undefined,
  processedRows: number,
): Promise<boolean> {
  if (!lease || processedRows % FENCED_HEARTBEAT_INTERVAL_ROWS !== 0) return true;
  try {
    await heartbeatConnectionSyncLease(lease);
    return true;
  } catch (error) {
    logger.warn('[AD_INGEST] Lease lost during ingestion; aborting remaining rows', error);
    return false;
  }
}

/**
 * Ingest Google Ads campaign rows to CampaignMetric.
 */
export async function ingestGoogleAdsRows(
  rows: Array<{
    campaign_id?: string;
    campaign_name?: string;
    ad_group_id?: string;
    ad_group_name?: string;
    date?: string; // YYYY-MM-DD
    impressions?: number;
    clicks?: number;
    cost?: number; // Already converted from micros
    cpc?: number;
    ctr?: number;
    conversions?: number;
    conversion_value?: number;
    currency?: string;
    raw?: unknown;
  }>,
  opts: {
    workspaceId: string;
    connectionId: string;
    accountId: string;
    accountName?: string;
    syncJobId: string;
    lease?: ConnectionLease;
  }
): Promise<{ upserted: number; failed: number }> {
  let upserted = 0;
  let failed = 0;

  if (opts.lease) {
    try {
      await heartbeatConnectionSyncLease(opts.lease);
    } catch {
      return { upserted: 0, failed: rows.length };
    }
  }

  for (const row of rows) {
    if (!(await fencedHeartbeat(opts.lease, upserted + failed))) {
      failed += rows.length - upserted - failed;
      break;
    }
    try {
      if (!row.date || !row.campaign_id) {
        failed++;
        continue;
      }

      const date = new Date(row.date);
      if (isNaN(date.getTime())) {
        logger.warn('[GOOGLE_ADS_INGEST] Invalid date:', row.date);
        failed++;
        continue;
      }

      await upsertCampaignMetric({
        workspaceId: opts.workspaceId,
        connectionId: opts.connectionId,
        platform: 'google_ads',
        accountId: opts.accountId,
        accountName: opts.accountName,
        level: 'campaign',
        entityId: row.campaign_id,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name ?? '',
        adsetId: row.ad_group_id ?? '',
        adsetName: row.ad_group_name ?? '',
        date,
        impressions: row.impressions ?? 0,
        clicks: row.clicks ?? 0,
        spend: row.cost ?? 0,
        cpc: row.cpc ?? 0,
        ctr: row.ctr ?? 0,
        conversions: row.conversions ?? 0,
        revenue: row.conversion_value ?? 0,
        currency: row.currency,
        rawData: row.raw,
        syncJobId: opts.syncJobId,
        lease: opts.lease,
      });

      upserted++;
    } catch (error) {
      logger.error('[GOOGLE_ADS_INGEST] Row failed:', error);
      failed++;
    }
  }

  return { upserted, failed };
}

/**
 * Ingest TikTok campaign rows to CampaignMetric.
 */
export async function ingestTiktokRows(
  rows: Array<{
    dimensions?: Record<string, string | number>;
    metrics?: Record<string, string | number>;
    raw?: unknown;
  }>,
  opts: {
    workspaceId: string;
    connectionId: string;
    accountId: string;
    accountName?: string;
    syncJobId: string;
    lease?: ConnectionLease;
  }
): Promise<{ upserted: number; failed: number }> {
  let upserted = 0;
  let failed = 0;

  if (opts.lease) {
    try {
      await heartbeatConnectionSyncLease(opts.lease);
    } catch {
      return { upserted: 0, failed: rows.length };
    }
  }

  for (const row of rows) {
    if (!(await fencedHeartbeat(opts.lease, upserted + failed))) {
      failed += rows.length - upserted - failed;
      break;
    }
    try {
      const dims = row.dimensions || {};
      const metrics = row.metrics || {};

      // TikTok dimensions
      const campaignId = String(dims.campaign_id ?? '');
      const campaignName = String(dims.campaign_name ?? '');
      const adgroupId = String(dims.adgroup_id ?? '');
      const adgroupName = String(dims.adgroup_name ?? '');
      const dateStr = String(dims.stat_time_day ?? dims.date ?? '');

      if (!dateStr || !campaignId) {
        failed++;
        continue;
      }

      // Parse date (TikTok format: YYYY-MM-DD)
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        logger.warn('[TIKTOK_INGEST] Invalid date:', dateStr);
        failed++;
        continue;
      }

      // TikTok metrics
      const impressions = parseInt(String(metrics.impression ?? metrics.impressions ?? 0), 10);
      const clicks = parseInt(String(metrics.click ?? metrics.clicks ?? 0), 10);
      const spend = parseFloat(String(metrics.spend ?? metrics.cost ?? 0));
      const cpc = parseFloat(String(metrics.cpc ?? 0));
      const ctr = parseFloat(String(metrics.ctr ?? 0)) / 100; // Convert percentage to decimal
      const conversions = parseFloat(String(metrics.conversion ?? metrics.conversions ?? 0));
      const revenue = parseFloat(String(metrics.revenue ?? metrics.conversion_value ?? 0));
      const roas = parseFloat(String(metrics.roas ?? 0));
      const currency = typeof metrics.currency === 'string' ? metrics.currency : undefined;

      await upsertCampaignMetric({
        workspaceId: opts.workspaceId,
        connectionId: opts.connectionId,
        platform: 'tiktok_business',
        accountId: opts.accountId,
        accountName: opts.accountName,
        level: 'campaign',
        entityId: campaignId,
        campaignId,
        campaignName,
        adsetId: adgroupId,
        adsetName: adgroupName,
        date,
        impressions,
        clicks,
        spend,
        cpc,
        ctr,
        conversions,
        revenue,
        roas,
        currency,
        rawData: row.raw ?? { dimensions: dims, metrics },
        syncJobId: opts.syncJobId,
        lease: opts.lease,
      });

      upserted++;
    } catch (error) {
      logger.error('[TIKTOK_INGEST] Row failed:', error);
      failed++;
    }
  }

  return { upserted, failed };
}
