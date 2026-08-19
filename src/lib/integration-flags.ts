/**
 * Backend toggles for which connect flows appear in the product.
 *
 * Certified pilot providers default ON. Uncertified providers default OFF
 * and stay hidden unless explicitly enabled after certification.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

export const PILOT_CERTIFIED_PROVIDERS = [
  "meta_ads",
  "google_ads",
  "tiktok_business",
  "shopee",
] as const;

export type PilotCertifiedProvider = (typeof PILOT_CERTIFIED_PROVIDERS)[number];

const UNCERTIFIED_PROVIDERS = ["tiktok_shop", "lazada", "shopify", "amazon"] as const;

export function isPilotCertifiedProvider(providerId: string): boolean {
  return (PILOT_CERTIFIED_PROVIDERS as readonly string[]).includes(providerId);
}

function envFlagEnabled(name: string, defaultEnabled: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return defaultEnabled;
  const value = raw.trim().toLowerCase();
  if (FALSY.has(value)) return false;
  if (TRUTHY.has(value)) return true;
  return defaultEnabled;
}

export function isTikTokShopConnectEnabled(): boolean {
  return envFlagEnabled("TIKTOK_SHOP_CONNECT_ENABLED", false);
}

export function isShopeeConnectEnabled(): boolean {
  return envFlagEnabled("SHOPEE_CONNECT_ENABLED", true);
}

export function isMetaAdsConnectEnabled(): boolean {
  return envFlagEnabled("META_ADS_CONNECT_ENABLED", true);
}

export function isGoogleAdsConnectEnabled(): boolean {
  return envFlagEnabled("GOOGLE_ADS_CONNECT_ENABLED", true);
}

export function isTikTokBusinessConnectEnabled(): boolean {
  return envFlagEnabled("TIKTOK_BUSINESS_CONNECT_ENABLED", true);
}

export function isShopifyConnectEnabled(): boolean {
  return envFlagEnabled("SHOPIFY_CONNECT_ENABLED", false);
}

export function isAmazonConnectEnabled(): boolean {
  return envFlagEnabled("AMAZON_CONNECT_ENABLED", false);
}

export function isLazadaConnectEnabled(): boolean {
  return envFlagEnabled("LAZADA_CONNECT_ENABLED", false);
}

/** Connect-surface gate used by OAuth and catalog UI. Unknown ids stay closed. */
export function isConnectEnabled(providerId: string): boolean {
  switch (providerId) {
    case "meta_ads":
      return isMetaAdsConnectEnabled();
    case "google_ads":
      return isGoogleAdsConnectEnabled();
    case "tiktok_business":
      return isTikTokBusinessConnectEnabled();
    case "shopee":
      return isShopeeConnectEnabled();
    case "tiktok_shop":
      return isTikTokShopConnectEnabled();
    case "shopify":
      return isShopifyConnectEnabled();
    case "amazon":
      return isAmazonConnectEnabled();
    case "lazada":
      return isLazadaConnectEnabled();
    default:
      return false;
  }
}

export function isUncertifiedProvider(providerId: string): boolean {
  return (UNCERTIFIED_PROVIDERS as readonly string[]).includes(providerId);
}
