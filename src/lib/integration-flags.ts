/**
 * Backend toggles for which connect flows appear in the product.
 *
 * Connectors are VISIBLE by default — set <NAME>_CONNECT_ENABLED=false to
 * explicitly hide one (e.g. for a region where it isn't supported).
 *
 * Credentials are only required at OAuth / connect time, not to show the card.
 */
export function isTikTokShopConnectEnabled(): boolean {
  return (process.env.TIKTOK_SHOP_CONNECT_ENABLED || 'true').toLowerCase() !== 'false';
}

export function isShopeeConnectEnabled(): boolean {
  return (process.env.SHOPEE_CONNECT_ENABLED || 'true').toLowerCase() !== 'false';
}

export function isMetaAdsConnectEnabled(): boolean {
  return (process.env.META_ADS_CONNECT_ENABLED || 'true').toLowerCase() !== 'false';
}

export function isGoogleAdsConnectEnabled(): boolean {
  return (process.env.GOOGLE_ADS_CONNECT_ENABLED || 'true').toLowerCase() !== 'false';
}

export function isTikTokBusinessConnectEnabled(): boolean {
  return (process.env.TIKTOK_BUSINESS_CONNECT_ENABLED || 'true').toLowerCase() !== 'false';
}

export function isShopifyConnectEnabled(): boolean {
  return (process.env.SHOPIFY_CONNECT_ENABLED || 'true').toLowerCase() !== 'false';
}

export function isAmazonConnectEnabled(): boolean {
  return (process.env.AMAZON_CONNECT_ENABLED || "true").toLowerCase() !== "false";
}

export function isLazadaConnectEnabled(): boolean {
  return (process.env.LAZADA_CONNECT_ENABLED || "true").toLowerCase() !== "false";
}
