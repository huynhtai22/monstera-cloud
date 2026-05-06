/**
 * Generic ad platform ingestion for CampaignMetric.
 * 
 * Unlike Meta which has complex distributed locking, this uses simple upserts
 * for Google Ads and TikTok manual syncs.
 */

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

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
}

/**
 * Upsert a campaign metric row.
 * Simple version without distributed locking (used for Google Ads, TikTok).
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
  } = payload;

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
      platform,
      accountId,
      accountName: accountName ?? null,
      level,
      entityId,
      campaignId,
      campaignName: campaignName ?? '',
      adsetId: adsetId ?? '',
      adsetName: adsetName ?? null,
      adId: adId ?? '',
      date,
      breakdownHash,
      impressions,
      clicks,
      spend,
      reach,
      cpc,
      ctr,
      conversions,
      revenue,
      roas,
      currency: currency ?? null,
      rawData: rawData ? JSON.stringify(rawData) : null,
      syncJobId: syncJobId ?? null,
      pulledAt: new Date(),
    },
    update: {
      impressions,
      clicks,
      spend,
      reach,
      cpc,
      ctr,
      conversions,
      revenue,
      roas,
      currency: currency ?? null,
      rawData: rawData ? JSON.stringify(rawData) : null,
      syncJobId: syncJobId ?? null,
      pulledAt: new Date(),
    },
  });
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
  }
): Promise<{ upserted: number; failed: number }> {
  let upserted = 0;
  let failed = 0;

  for (const row of rows) {
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
  }
): Promise<{ upserted: number; failed: number }> {
  let upserted = 0;
  let failed = 0;

  for (const row of rows) {
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
      const currency = String(metrics.currency ?? 'USD');

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
      });

      upserted++;
    } catch (error) {
      logger.error('[TIKTOK_INGEST] Row failed:', error);
      failed++;
    }
  }

  return { upserted, failed };
}
