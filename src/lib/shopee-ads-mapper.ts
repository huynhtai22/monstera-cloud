import { createHash } from "crypto";
import type { CampaignMetricPayload } from "@/lib/ad-platform-ingest";
import type {
  ShopeeProductCampaignDailyMetric,
  ShopeeProductCampaignSetting,
  ShopeeKeywordSetting,
} from "@/lib/shopee";

export type ShopeeAdsMetricLevel = "campaign" | "ad";

/** SHA-1 of sorted `k=v` pairs for extra breakdown dimensions (not entityId/level/date). */
export function generateShopeeBreakdownHash(
  dims: Record<string, string | number>
): string {
  const keys = Object.keys(dims).sort();
  if (keys.length === 0) return "none";
  const hashString = keys.map((k) => `${k}=${dims[k]}`).join("|");
  return createHash("sha1").update(hashString).digest("hex");
}

export function parseShopeeAdsRowDate(
  row: Record<string, unknown>,
  fallbackYmd?: string
): Date | null {
  const raw =
    (typeof row.date === "string" && row.date) ||
    (typeof row.report_date === "string" && row.report_date) ||
    (typeof row.performance_date === "string" && row.performance_date) ||
    fallbackYmd;
  if (!raw) return null;
  const s = String(raw).trim();
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (dmy) {
    const d = Number(dmy[1]);
    const mo = Number(dmy[2]);
    const y = Number(dmy[3]);
    return new Date(Date.UTC(y, mo - 1, d));
  }
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymd) {
    return new Date(`${s}T00:00:00.000Z`);
  }
  return null;
}

function num(v: unknown): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function pickCampaignId(row: Record<string, unknown>): string | null {
  const id = row.campaign_id ?? row.campaignId;
  if (id == null || id === "") return null;
  return String(id);
}

function pickAdId(row: Record<string, unknown>): string | null {
  const id = row.ad_id ?? row.adId ?? row.item_id;
  if (id == null || id === "") return null;
  return String(id);
}

export function resolveShopeeAdsRowLevel(
  row: Record<string, unknown>
): ShopeeAdsMetricLevel | null {
  const campaignId = pickCampaignId(row);
  if (!campaignId) return null;
  const adId = pickAdId(row);
  if (adId) return "ad";
  return "campaign";
}

export type MapShopeeAdsRowParams = {
  workspaceId: string;
  connectionId: string;
  accountId: string;
  accountName: string;
  row: Record<string, unknown>;
  level?: ShopeeAdsMetricLevel;
  syncJobId?: string;
  apiMode?: "range" | "per_day";
};

/**
 * Map one Shopee v2.ads performance row → CampaignMetric upsert payload.
 * Idempotent via Prisma unique key: connectionId, accountId, level, entityId, date, breakdownHash.
 */
export function mapShopeeRowToCampaignMetricPayload(
  params: MapShopeeAdsRowParams
): CampaignMetricPayload | null {
  const {
    workspaceId,
    connectionId,
    accountId,
    accountName,
    row,
    syncJobId,
    apiMode,
  } = params;

  const level = params.level ?? resolveShopeeAdsRowLevel(row);
  if (!level) return null;

  const campaignId = pickCampaignId(row);
  if (!campaignId) return null;

  const date = parseShopeeAdsRowDate(row);
  if (!date) return null;

  const adId = pickAdId(row);
  const entityId = level === "ad" && adId ? adId : campaignId;

  const extraDims: Record<string, string | number> = {};
  const placement = row.placement_type ?? row.placement;
  if (placement != null && placement !== "") {
    extraDims.placement_type = String(placement);
  }
  const breakdownHash = generateShopeeBreakdownHash(extraDims);

  const impressions = Math.round(num(row.impression ?? row.impressions));
  const clicks = Math.round(num(row.clicks));
  const spend = num(row.expense ?? row.ad_expense);
  const revenue = num(row.broad_gmv ?? row.direct_gmv);
  const conversions = num(row.broad_order ?? row.direct_order);
  const ctrFromApi = num(row.ctr);
  const roasFromApi = num(row.broad_roas ?? row.direct_roas ?? row.roas);

  const ctr =
    ctrFromApi > 0
      ? ctrFromApi
      : impressions > 0
        ? clicks / impressions
        : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const roas =
    roasFromApi > 0 ? roasFromApi : spend > 0 ? revenue / spend : 0;

  const campaignName =
    typeof row.campaign_name === "string" && row.campaign_name
      ? row.campaign_name
      : typeof row.campaignName === "string" && row.campaignName
        ? row.campaignName
        : `Campaign ${campaignId}`;

  return {
    workspaceId,
    connectionId,
    platform: "shopee",
    accountId,
    accountName,
    level,
    entityId,
    campaignId,
    campaignName,
    adsetId: "",
    adsetName: undefined,
    adId: level === "ad" && adId ? adId : "",
    date,
    breakdownHash,
    impressions,
    clicks,
    spend,
    reach: 0,
    cpc,
    ctr,
    conversions,
    revenue,
    roas,
    currency:
      typeof row.currency === "string" && row.currency ? row.currency : "VND",
    rawData: {
      source: "shopee_ads_v2",
      metric: "get_all_cpc_ads_daily_performance",
      mode: apiMode,
      revenue_basis: "broad_gmv_preferred",
      row,
    },
    syncJobId,
  };
}

export type MapShopeeProductPerformanceParams = {
  workspaceId: string;
  connectionId: string;
  accountId: string;
  accountName: string;
  metric: ShopeeProductCampaignDailyMetric;
  setting?: ShopeeProductCampaignSetting;
  syncJobId?: string;
};

/**
 * Map documented Shopee product-level daily advertising performance row → CampaignMetric payload.
 * Stores comprehensive non-PII marketing metrics (broad/direct conversions, units, GMV, ROAS, ACOS, CR, CPC)
 * and discloses that keyword records are configuration-only.
 */
export function mapShopeeProductDailyToCampaignMetricPayload(
  params: MapShopeeProductPerformanceParams
): CampaignMetricPayload | null {
  const {
    workspaceId,
    connectionId,
    accountId,
    accountName,
    metric,
    setting,
    syncJobId,
  } = params;

  const campaignId = String(metric.campaign_id);
  const itemId = metric.item_id ? String(metric.item_id) : (setting?.item_id ? String(setting.item_id) : undefined);
  const level: ShopeeAdsMetricLevel = itemId ? "ad" : "campaign";
  const entityId = itemId ? itemId : campaignId;

  const date = parseShopeeAdsRowDate(metric as any, metric.date);
  if (!date) return null;

  const campaignName =
    metric.campaign_name || setting?.campaign_name || `Shopee Campaign ${campaignId}`;
  const itemName = metric.item_name || setting?.item_name;

  const extraDims: Record<string, string | number> = {};
  if (setting?.placement) {
    extraDims.placement = setting.placement;
  }
  if (metric.ad_type || setting?.ad_type) {
    extraDims.ad_type = metric.ad_type || setting?.ad_type || "product";
  }
  const breakdownHash = generateShopeeBreakdownHash(extraDims);

  const impressions = Math.round(num(metric.impression));
  const clicks = Math.round(num(metric.clicks));
  const spend = num(metric.expense);
  const conversions = num(metric.broad_order);
  const revenue = num(metric.broad_gmv);

  const ctr =
    metric.ctr > 0
      ? metric.ctr
      : impressions > 0
        ? clicks / impressions
        : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const roas =
    metric.broad_roas > 0
      ? metric.broad_roas
      : spend > 0
        ? revenue / spend
        : 0;

  const keywordSettings: ShopeeKeywordSetting[] = setting?.keyword_list || [];

  return {
    workspaceId,
    connectionId,
    platform: "shopee",
    accountId,
    accountName,
    level,
    entityId,
    campaignId,
    campaignName,
    adsetId: itemId ?? "",
    adsetName: itemName,
    adId: itemId ?? "",
    date,
    breakdownHash,
    impressions,
    clicks,
    spend,
    reach: 0,
    cpc,
    ctr,
    conversions,
    revenue,
    roas,
    currency: "VND",
    rawData: {
      source: "shopee_product_campaign_daily",
      region: "VN",
      campaign_id: campaignId,
      campaign_name: campaignName,
      item_id: itemId,
      item_name: itemName,
      ad_type: metric.ad_type || setting?.ad_type,
      bidding_method: setting?.bidding_method,
      budget: setting?.budget,
      roas_target: setting?.roas_target,
      broad_metrics: {
        orders: metric.broad_order,
        units_sold: metric.broad_order_amount,
        gmv: metric.broad_gmv,
        roas: metric.broad_roas,
        acos: metric.broad_cir,
        conversion_rate: metric.broad_cr,
        cost_per_conversion: metric.broad_cost_per_conversion ?? (metric.broad_order > 0 ? spend / metric.broad_order : 0),
      },
      direct_metrics: {
        orders: metric.direct_order,
        units_sold: metric.direct_order_amount,
        gmv: metric.direct_gmv,
        roas: metric.direct_roas,
        acos: metric.direct_cir,
        conversion_rate: metric.direct_cr,
        cost_per_conversion: metric.direct_cost_per_conversion ?? (metric.direct_order > 0 ? spend / metric.direct_order : 0),
      },
      keyword_settings_count: keywordSettings.length,
      keyword_settings: keywordSettings,
      keyword_performance_note:
        "Shopee API exposes keyword configuration only; keyword-level performance metrics are not supported by Shopee Open Platform.",
      metric_raw: metric.raw,
    },
    syncJobId,
  };
}
