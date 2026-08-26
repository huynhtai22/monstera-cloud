/**
 * Centralized Provider Market Policy & Capability Control.
 * Defines market/country eligibility for third-party platforms (e.g. Vietnam-only Shopee Ads).
 */

export const PROVIDER_MARKET_POLICIES = {
  shopee: {
    ads_reporting: ["VN"],
    product_campaign_reporting: ["VN"],
    keyword_settings: ["VN"],
  },
} as const;

export type ShopeeCapability = keyof typeof PROVIDER_MARKET_POLICIES.shopee;

/**
 * Checks if a given Shopee shop region is eligible for a specific capability.
 * Authoritative region must come from `GET /api/v2/shop/get_shop_info`.
 */
export function isShopeeRegionEligible(
  region: string | null | undefined,
  capability: ShopeeCapability = "ads_reporting",
  isSandbox = false
): boolean {
  if (isSandbox) return true;
  if (!region) return false;
  const normalized = region.trim().toUpperCase();
  const allowed = PROVIDER_MARKET_POLICIES.shopee[capability] as readonly string[];
  return allowed.includes(normalized);
}

/**
 * Enforces that a given Shopee shop region is eligible.
 * Throws a detailed, actionable error if not eligible.
 */
export function assertShopeeRegionEligible(
  region: string | null | undefined,
  capability: ShopeeCapability = "ads_reporting",
  isSandbox = false
): void {
  if (isSandbox) return;
  const normalized = (region || "").trim().toUpperCase();
  if (!isShopeeRegionEligible(normalized, capability, isSandbox)) {
    const allowed = PROVIDER_MARKET_POLICIES.shopee[capability].join(", ");
    throw new Error(
      `Shopee capability '${capability}' is currently restricted to [${allowed}] shops. Authoritative shop region is '${normalized || "UNKNOWN"}'.`
    );
  }
}
