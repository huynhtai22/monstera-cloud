/**
 * Shopee Ads (v2.ads) — Granular Product & Campaign Daily Performance → CampaignMetric.
 * Strictly enforces Vietnam-only region policy, fetches product campaign discovery,
 * settings, keyword configuration, and product-level daily performance in <= 100 ID batches
 * and <= 30-day date windows.
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getValidShopeeCreds, shopeeAdsClient, shopeeDataClient, type ShopeeProductCampaignSetting } from "@/lib/shopee";
import { upsertCampaignMetric } from "@/lib/ad-platform-ingest";
import { heartbeatConnectionSyncLease, type ConnectionLease } from "@/lib/connection-sync-lease";
import {
  mapShopeeProductDailyToCampaignMetricPayload,
  mapShopeeRowToCampaignMetricPayload,
  parseShopeeAdsRowDate,
} from "@/lib/shopee-ads-mapper";
import { isShopeeRegionEligible, assertShopeeRegionEligible } from "@/lib/provider-market-policy";
import type { MarketplaceSyncResult } from "@/lib/sync-marketplace-warehouse";

const UPSERT_CHUNK_SIZE = 25;
const SHOPEE_ADS_MAX_DAYS_PER_REQUEST = 28;

function parseYmdUtc(ymd: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new Error(`Invalid Shopee Ads date: ${ymd}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function splitShopeeAdsDateRange(since: string, until: string): Array<{ since: string; until: string }> {
  const end = parseYmdUtc(until);
  let cursor = parseYmdUtc(since);
  if (cursor > end) throw new Error("Shopee Ads range start must not be after its end");
  const windows: Array<{ since: string; until: string }> = [];
  while (cursor <= end) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + (SHOPEE_ADS_MAX_DAYS_PER_REQUEST - 1) * 86_400_000, end.getTime()));
    windows.push({ since: cursor.toISOString().slice(0, 10), until: chunkEnd.toISOString().slice(0, 10) });
    cursor = new Date(chunkEnd.getTime() + 86_400_000);
  }
  return windows;
}

function isShopeeAdsSyncDisabled(): boolean {
  const v = (process.env.SHOPEE_ADS_SYNC ?? "").trim().toLowerCase();
  return v === "false" || v === "0" || v === "off" || v === "no";
}

function isBenignAdsFailure(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("permission") ||
    m.includes("error_permission") ||
    m.includes("not authorized") ||
    m.includes("unauthorized") ||
    m.includes("access denied") ||
    m.includes("error_auth") ||
    m.includes("invalid access_token")
  );
}

/** Clamp historical date to Shopee's 6-month limit (approx 180 days). */
function clampShopeeHistoricalDate(sinceYmd: string): string {
  const earliest = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  return sinceYmd < earliest ? earliest : sinceYmd;
}

async function upsertPayloadsInChunks(
  payloads: Awaited<ReturnType<typeof mapShopeeProductDailyToCampaignMetricPayload>>[],
  lease?: ConnectionLease
): Promise<number> {
  const valid = payloads.filter((p): p is NonNullable<typeof p> => p != null);
  let upserted = 0;
  for (let i = 0; i < valid.length; i += UPSERT_CHUNK_SIZE) {
    if (lease) {
      await heartbeatConnectionSyncLease(lease);
    }
    const chunk = valid.slice(i, i + UPSERT_CHUNK_SIZE);
    await Promise.all(
      chunk.map((payload) => upsertCampaignMetric({ ...payload, lease }))
    );
    upserted += chunk.length;
  }
  return upserted;
}

/**
 * Pull product campaign daily performance and upsert one CampaignMetric row per product/campaign day.
 */
export async function syncShopeeAdsWarehouseMetrics(opts: {
  connectionId: string;
  workspaceId: string;
  userPlan: string;
  since: string;
  until: string;
  lease?: ConnectionLease;
}): Promise<MarketplaceSyncResult> {
  if (isShopeeAdsSyncDisabled()) {
    logger.info("[syncShopeeAdsWarehouse] Skipped (SHOPEE_ADS_SYNC disabled)");
    return { success: true, rowsIngested: 0 };
  }

  const { connectionId, workspaceId } = opts;
  const clampedSince = clampShopeeHistoricalDate(opts.since);
  const until = opts.until;

  try {
    const creds = await getValidShopeeCreds(connectionId);
    const apiOpts = {
      accessToken: creds.access_token,
      shopId: creds.shop_id,
      sandbox: creds.sandbox === true,
    };

    // Step 1: Verify authoritative shop region is VN
    try {
      const shopInfo = await shopeeDataClient.getShopInfo(apiOpts);
      assertShopeeRegionEligible(shopInfo.region, "ads_reporting");
    } catch (regionErr: unknown) {
      const msg = regionErr instanceof Error ? regionErr.message : String(regionErr);
      if (msg.includes("Shopee capability") || msg.includes("restricted to [VN]")) {
        logger.warn(`[syncShopeeAdsWarehouse] Ineligible shop region: ${msg}`, { connectionId });
        return { success: false, rowsIngested: 0, error: msg };
      }
      // If shop info failed due to benign permission issue, log warning
      if (isBenignAdsFailure(msg)) {
        logger.warn("[syncShopeeAdsWarehouse] Shop info check deferred", { msg });
      }
    }

    const accountId = String(creds.shop_id);
    const accountName = `Shopee VN Shop ${accountId}`;
    const jobId = `shopee-ads-warehouse-${Date.now()}`;
    const payloads = [];

    // Step 2: Discover product-level campaign IDs
    let campaignIds: number[] = [];
    try {
      campaignIds = await shopeeAdsClient.getAllProductLevelCampaignIds(apiOpts);
      logger.info(`[syncShopeeAdsWarehouse] Discovered ${campaignIds.length} product campaigns for shop ${accountId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isBenignAdsFailure(msg)) {
        logger.warn("[syncShopeeAdsWarehouse] Ads API not available yet (expected until Shopee enables app).", { connectionId, message: msg });
        return { success: true, rowsIngested: 0 };
      }
      logger.warn(`[syncShopeeAdsWarehouse] Product campaign discovery failed, falling back to shop CPC ads: ${msg}`);
    }

    if (campaignIds.length > 0) {
      if (opts.lease) await heartbeatConnectionSyncLease(opts.lease);

      // Step 3: Fetch campaign settings (settings, items, keyword configs) in chunks of <= 100
      let settingsList: ShopeeProductCampaignSetting[] = [];
      try {
        settingsList = await shopeeAdsClient.getProductLevelCampaignSettingInfo(apiOpts, campaignIds);
      } catch (err) {
        logger.warn("[syncShopeeAdsWarehouse] Could not fetch campaign settings, continuing with IDs", { err });
      }
      const settingsMap = new Map<number, ShopeeProductCampaignSetting>();
      for (const s of settingsList) {
        settingsMap.set(s.campaign_id, s);
      }

      if (opts.lease) await heartbeatConnectionSyncLease(opts.lease);

      // Step 4: Fetch product campaign daily metrics
      try {
        const metrics = await shopeeAdsClient.getProductCampaignDailyPerformance(
          apiOpts,
          campaignIds,
          clampedSince,
          until
        );

        for (const m of metrics) {
          const setting = settingsMap.get(m.campaign_id);
          const payload = mapShopeeProductDailyToCampaignMetricPayload({
            workspaceId,
            connectionId,
            accountId,
            accountName,
            metric: m,
            setting,
            syncJobId: jobId,
          });
          if (payload) {
            payloads.push(payload);
          }
        }
      } catch (err) {
        logger.warn("[syncShopeeAdsWarehouse] Product daily metrics pull failed", { err });
      }
    }

    // Step 5: If no product campaign metrics were found or if shop has overall CPC ads, query shop-level daily performance
    if (payloads.length === 0) {
      try {
        for (const window of splitShopeeAdsDateRange(clampedSince, until)) {
          const cpcResult = await shopeeAdsClient.getAllCpcAdsDailyPerformance(apiOpts, window.since, window.until);
          for (const raw of cpcResult.rows) {
          if (!raw || typeof raw !== "object") continue;
          const row = raw as Record<string, unknown>;
          const d = parseShopeeAdsRowDate(row);
          if (!d) continue;
          const dayKey = d.toISOString().slice(0, 10);
          if (dayKey < clampedSince || dayKey > until) continue;

          const payload = mapShopeeRowToCampaignMetricPayload({
            workspaceId,
            connectionId,
            accountId,
            accountName,
            row,
            syncJobId: jobId,
            apiMode: cpcResult.mode,
          });
            if (payload) {
              payloads.push(payload);
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isBenignAdsFailure(msg)) {
          logger.warn(
            "[syncShopeeAdsWarehouse] Ads API not available yet (expected until Shopee enables app).",
            { connectionId, message: msg }
          );
          return { success: true, rowsIngested: 0 };
        }
        throw e;
      }
    }

    if (payloads.length === 0) {
      logger.info(
        "[syncShopeeAdsWarehouse] No ads daily rows (empty shop or no ads data in range)",
        { connectionId, since: clampedSince, until }
      );
      return { success: true, rowsIngested: 0 };
    }

    const upserted = await upsertPayloadsInChunks(payloads, opts.lease);

    logger.info(
      `[syncShopeeAdsWarehouse] ${upserted} granular Shopee Ads rows ingested for connection ${connectionId}`
    );
    return { success: true, rowsIngested: upserted };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Shopee ads warehouse sync failed";
    logger.error("[syncShopeeAdsWarehouse]", e);
    return { success: false, rowsIngested: 0, error: msg };
  }
}
