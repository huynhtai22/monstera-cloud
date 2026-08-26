/**
 * Shopee Ads (v2.ads) — granular CPC daily performance → CampaignMetric.
 * Best-effort: if the Open Platform app lacks Ads API permission, sync returns
 * success with 0 rows so order-based Shopee warehouse sync still completes.
 */

import { logger } from "@/lib/logger";
import { getValidShopeeCreds, shopeeAdsClient } from "@/lib/shopee";
import { upsertCampaignMetric } from "@/lib/ad-platform-ingest";
import {
  mapShopeeRowToCampaignMetricPayload,
  parseShopeeAdsRowDate,
} from "@/lib/shopee-ads-mapper";
import type { MarketplaceSyncResult } from "@/lib/sync-marketplace-warehouse";

const UPSERT_CHUNK_SIZE = 25;
export const SHOPEE_SHOP_TIME_ZONE = "Asia/Ho_Chi_Minh";
// Shopee rejects ranges over a calendar month. Use a conservative 28 inclusive
// calendar-day window so month-length and timezone interpretation cannot push a
// request over the provider's boundary.
const SHOPEE_ADS_MAX_DAYS_PER_REQUEST = 28;

function parseYmdUtc(ymd: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new Error(`Invalid Shopee Ads date: ${ymd}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function splitShopeeAdsDateRange(since: string, until: string): Array<{ since: string; until: string }> {
  // The Ads API accepts date-only strings. These are Vietnam shop-calendar
  // labels, not instants; UTC is used only for stable label arithmetic, so a
  // host timezone can never shift an inclusive Vietnam date to a different day.
  const end = parseYmdUtc(until);
  let cursor = parseYmdUtc(since);
  if (cursor > end) throw new Error("Shopee Ads range start must not be after its end");
  const ranges: Array<{ since: string; until: string }> = [];
  while (cursor <= end) {
    const chunkEnd = new Date(Math.min(
      cursor.getTime() + (SHOPEE_ADS_MAX_DAYS_PER_REQUEST - 1) * 86400000,
      end.getTime(),
    ));
    ranges.push({
      since: cursor.toISOString().slice(0, 10),
      until: chunkEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(chunkEnd.getTime() + 86400000);
  }
  return ranges;
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
    m.includes("invalid access_token") ||
    m.includes("error_param")
  );
}

async function upsertPayloadsInChunks(
  payloads: Awaited<ReturnType<typeof mapShopeeRowToCampaignMetricPayload>>[]
): Promise<number> {
  const valid = payloads.filter((p): p is NonNullable<typeof p> => p != null);
  let upserted = 0;
  for (let i = 0; i < valid.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = valid.slice(i, i + UPSERT_CHUNK_SIZE);
    await Promise.all(chunk.map((payload) => upsertCampaignMetric(payload)));
    upserted += chunk.length;
  }
  return upserted;
}

/**
 * Pull CPC ads daily performance and upsert one CampaignMetric row per API row
 * (campaign or ad grain).
 */
export async function syncShopeeAdsWarehouseMetrics(opts: {
  connectionId: string;
  workspaceId: string;
  userPlan: string;
  since: string;
  until: string;
}): Promise<MarketplaceSyncResult> {
  if (isShopeeAdsSyncDisabled()) {
    logger.info("[syncShopeeAdsWarehouse] Skipped (SHOPEE_ADS_SYNC disabled)");
    return { success: true, rowsIngested: 0 };
  }

  const { connectionId, workspaceId, since, until } = opts;

  try {
    const creds = await getValidShopeeCreds(connectionId);
    const apiOpts = {
      accessToken: creds.access_token,
      shopId: creds.shop_id,
      sandbox: creds.sandbox === true,
    };

    let rows: unknown[] = [];
    let mode: "range" | "per_day" = "range";

    try {
      const windows = splitShopeeAdsDateRange(since, until);
      const perDayErrors: string[] = [];
      for (const window of windows) {
        const result = await shopeeAdsClient.getAllCpcAdsDailyPerformance(
          apiOpts,
          window.since,
          window.until,
        );
        rows.push(...result.rows);
        if (result.mode === "per_day") mode = "per_day";
        if (result.perDayErrors?.length) perDayErrors.push(...result.perDayErrors);
      }
      if (perDayErrors.length) {
        logger.warn("[syncShopeeAdsWarehouse] Per-day fallback had errors", {
          count: perDayErrors.length,
          sample: perDayErrors.slice(0, 3),
        });
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

    if (rows.length === 0) {
      logger.info(
        "[syncShopeeAdsWarehouse] No CPC daily rows (empty shop or no ads data in range)",
        { connectionId, since, until, mode }
      );
      return { success: true, rowsIngested: 0 };
    }

    const accountId = String(creds.shop_id);
    const accountName = `Shopee shop ${accountId}`;
    const jobId = `shopee-ads-warehouse-${Date.now()}`;

    const payloads = [];
    let skippedDate = 0;
    let skippedMap = 0;

    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const d = parseShopeeAdsRowDate(row);
      if (!d) {
        skippedDate += 1;
        continue;
      }
      const dayKey = d.toISOString().slice(0, 10);
      if (dayKey < since || dayKey > until) continue;

      const payload = mapShopeeRowToCampaignMetricPayload({
        workspaceId,
        connectionId,
        accountId,
        accountName,
        row,
        syncJobId: jobId,
        apiMode: mode,
      });
      if (!payload) {
        skippedMap += 1;
        continue;
      }
      payloads.push(payload);
    }

    if (payloads.length === 0) {
      logger.warn("[syncShopeeAdsWarehouse] No mappable rows after transform", {
        connectionId,
        mode,
        skippedDate,
        skippedMap,
        sample: rows[0],
      });
      return { success: true, rowsIngested: 0 };
    }

    const upserted = await upsertPayloadsInChunks(payloads);

    logger.info(
      `[syncShopeeAdsWarehouse] ${upserted} granular rows for ${connectionId}`,
      { mode, skippedDate, skippedMap }
    );
    return { success: true, rowsIngested: upserted };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Shopee ads warehouse sync failed";
    logger.error("[syncShopeeAdsWarehouse]", e);
    return { success: false, rowsIngested: 0, error: msg };
  }
}
