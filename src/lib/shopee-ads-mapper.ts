import { createHash } from "crypto";
import type { CampaignMetricPayload } from "@/lib/ad-platform-ingest";

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
      typeof row.currency === "string" && row.currency ? row.currency : undefined,
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
