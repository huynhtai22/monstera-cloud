/**
 * Promoted-first resolution for Shopee Ads performance display fields.
 *
 * Resolution order per field, independently:
 *   1. promoted typed column when non-null (zero is valid — explicit nullish checks only);
 *   2. legacy rawData object field;
 *   3. the pre-existing normalized/zero fallback the production route always used.
 *
 * The response shape and derived ratios are computed by callers from these
 * resolved values exactly as before; this module changes only where each value
 * is sourced from.
 */

export interface ShopeeStoredPerformanceRow {
  conversions: number;
  revenue: number;
  spend: number;
  clicks: number;
  shopeeBroadOrders?: number | null;
  shopeeBroadUnits?: number | null;
  shopeeBroadGmv?: number | null;
  shopeeDirectOrders?: number | null;
  shopeeDirectUnits?: number | null;
  shopeeDirectGmv?: number | null;
  shopeeKeywordSettingsCount?: number | null;
}

export interface ShopeeResolvedPerformance {
  broadOrders: number;
  broadUnits: number;
  broadGmv: number;
  directOrders: number;
  directUnits: number;
  directGmv: number;
  keywordSettingsCount: number;
}

export function resolveShopeeRowPerformance(
  row: ShopeeStoredPerformanceRow,
  rawObj: Record<string, any>,
): ShopeeResolvedPerformance {
  const broadMetrics = rawObj?.broad_metrics || {};
  const directMetrics = rawObj?.direct_metrics || {};

  const broadOrders = Number(row.shopeeBroadOrders ?? broadMetrics.orders ?? row.conversions);
  // Legacy units fallback chains off the resolved broad orders, not the raw row.
  const broadUnits = Number(row.shopeeBroadUnits ?? broadMetrics.units_sold ?? broadOrders);
  const broadGmv = Number(row.shopeeBroadGmv ?? broadMetrics.gmv ?? row.revenue);
  const directOrders = Number(row.shopeeDirectOrders ?? directMetrics.orders ?? 0);
  const directUnits = Number(row.shopeeDirectUnits ?? directMetrics.units_sold ?? 0);
  const directGmv = Number(row.shopeeDirectGmv ?? directMetrics.gmv ?? 0);

  return {
    broadOrders,
    broadUnits,
    broadGmv,
    directOrders,
    directUnits,
    directGmv,
    keywordSettingsCount: Number(row.shopeeKeywordSettingsCount ?? rawObj?.keyword_settings_count ?? 0),
  };
}
