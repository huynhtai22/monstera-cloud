/**
 * Backend toggles for which TikTok (and related) connect flows appear in the product.
 * Set env to the string "false" to hide a connector without redeploying app code (still need env update on host).
 */
export function isTikTokShopConnectEnabled(): boolean {
  return (process.env.TIKTOK_SHOP_CONNECT_ENABLED || 'true').toLowerCase() !== 'false';
}

export function isTikTokBusinessConnectEnabled(): boolean {
  return (process.env.TIKTOK_BUSINESS_CONNECT_ENABLED || 'true').toLowerCase() !== 'false';
}
