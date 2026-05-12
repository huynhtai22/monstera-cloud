/**
 * Shopee Ads (v2.ads) — shop-level CPC daily performance → CampaignMetric.
 * Best-effort: if the Open Platform app lacks Ads API permission, sync returns
 * success with 0 rows so order-based Shopee warehouse sync still completes.
 *
 * Revenue uses broad_gmv when present (shop-attributed ad GMV; aligns with
 * Seller Center “Conversions” style). See Shopee Ads API guide.
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getValidShopeeCreds, shopeeAdsClient } from "@/lib/shopee";
import { upsertCampaignMetric } from "@/lib/ad-platform-ingest";
import type { MarketplaceSyncResult } from "@/lib/sync-marketplace-warehouse";

function parseYmd(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}

function num(v: unknown): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
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

/** Parse Shopee date field: usually DD-MM-YYYY on Ads performance rows. */
function parseShopeeAdsRowDate(
  row: Record<string, unknown>,
  fallbackYmd?: string
): Date | null {
  const raw =
    (typeof row.date === "string" && row.date) ||
    (typeof row.report_date === "string" && row.report_date) ||
    fallbackYmd;
  if (!raw) return null;
  const s = raw.trim();
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (dmy) {
    const d = Number(dmy[1]);
    const mo = Number(dmy[2]);
    const y = Number(dmy[3]);
    return new Date(Date.UTC(y, mo - 1, d));
  }
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymd) {
    return parseYmd(s);
  }
  return null;
}

function aggregateRowInto(
  acc: {
    impressions: number;
    clicks: number;
    spend: number;
    revenue: number;
    conversions: number;
    ctr: number;
    roas: number;
    currency?: string;
  },
  row: Record<string, unknown>
): void {
  const impressions = Math.round(num(row.impression ?? row.impressions));
  const clicks = Math.round(num(row.clicks));
  const spend = num(row.expense ?? row.ad_expense);
  const revenue = num(row.broad_gmv ?? row.direct_gmv);
  const conversions = num(row.broad_order ?? row.direct_order);
  const ctr = num(row.ctr);
  const roas = num(row.broad_roas ?? row.direct_roas ?? row.roas);
  const currency =
    typeof row.currency === "string" && row.currency
      ? row.currency
      : acc.currency;

  acc.impressions += impressions;
  acc.clicks += clicks;
  acc.spend += spend;
  acc.revenue += revenue;
  acc.conversions += conversions;
  if (ctr > 0) acc.ctr = ctr;
  if (roas > 0) acc.roas = roas;
  if (currency) acc.currency = currency;
}

/**
 * Pull shop-level CPC ads daily performance and upsert CampaignMetric rows
 * (separate entity from order rollups).
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
      const result = await shopeeAdsClient.getAllCpcAdsDailyPerformance(
        apiOpts,
        since,
        until
      );
      rows = result.rows;
      mode = result.mode;
      if (result.perDayErrors?.length) {
        logger.warn("[syncShopeeAdsWarehouse] Per-day fallback had errors", {
          count: result.perDayErrors.length,
          sample: result.perDayErrors.slice(0, 3),
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

    const byDay = new Map<
      string,
      {
        impressions: number;
        clicks: number;
        spend: number;
        revenue: number;
        conversions: number;
        ctr: number;
        roas: number;
        currency?: string;
      }
    >();

    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const d = parseShopeeAdsRowDate(row);
      if (!d) continue;
      const key = d.toISOString().slice(0, 10);
      if (key < since || key > until) continue;

      let acc = byDay.get(key);
      if (!acc) {
        acc = {
          impressions: 0,
          clicks: 0,
          spend: 0,
          revenue: 0,
          conversions: 0,
          ctr: 0,
          roas: 0,
        };
        byDay.set(key, acc);
      }
      aggregateRowInto(acc, row);
    }

    if (byDay.size === 0) {
      logger.warn(
        "[syncShopeeAdsWarehouse] Could not parse dates from Ads rows; check API response shape",
        { connectionId, mode, sample: rows[0] }
      );
      return { success: true, rowsIngested: 0 };
    }

    const accountId = String(creds.shop_id);
    const jobId = `shopee-ads-warehouse-${Date.now()}`;
    let upserted = 0;

    for (const [dayStr, agg] of byDay) {
      const d = parseYmd(dayStr);
      const cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0;
      const ctr = agg.ctr;
      const roas =
        agg.roas > 0
          ? agg.roas
          : agg.spend > 0
            ? agg.revenue / agg.spend
            : 0;

      await upsertCampaignMetric({
        workspaceId,
        connectionId,
        platform: "shopee",
        accountId,
        accountName: `Shopee shop ${accountId}`,
        level: "campaign",
        entityId: "shopee-ads-cpc-daily",
        campaignId: "shopee-ads-cpc-daily",
        campaignName: "Shopee Ads — CPC (shop daily)",
        adsetId: "",
        adsetName: undefined,
        date: d,
        breakdownHash: "shopee_ads_cpc_shop_daily",
        impressions: agg.impressions,
        clicks: agg.clicks,
        spend: agg.spend,
        reach: 0,
        cpc,
        ctr,
        conversions: agg.conversions,
        revenue: agg.revenue,
        roas,
        currency: agg.currency,
        rawData: {
          source: "shopee_ads_v2",
          metric: "get_all_cpc_ads_daily_performance",
          mode,
          revenue_basis: "broad_gmv_preferred",
        },
        syncJobId: jobId,
      });
      upserted += 1;
    }

    logger.info(
      `[syncShopeeAdsWarehouse] ${upserted} day rows (CPC ads) for ${connectionId}`
    );
    return { success: true, rowsIngested: upserted };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Shopee ads warehouse sync failed";
    logger.error("[syncShopeeAdsWarehouse]", e);
    return { success: false, rowsIngested: 0, error: msg };
  }
}
