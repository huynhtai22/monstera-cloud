/**
 * Backend toggles for which TikTok (and related) connect flows appear in the product.
 *
 * A connector is enabled when:
 *   1. Its credentials are present in env, AND
 *   2. The explicit toggle (if set) is not "false".
 *
 * Set TIKTOK_SHOP_CONNECT_ENABLED=false or TIKTOK_BUSINESS_CONNECT_ENABLED=false
 * to force-hide a connector even if credentials are present.
 */
export function isTikTokShopConnectEnabled(): boolean {
  const toggle = (process.env.TIKTOK_SHOP_CONNECT_ENABLED || 'true').toLowerCase();
  if (toggle === 'false') return false;
  // Require at least the app key to be present
  const key = (process.env.TIKTOK_SHOP_APP_KEY || '').trim();
  return key.length > 0;
}

export function isShopeeConnectEnabled(): boolean {
  const toggle = (process.env.SHOPEE_CONNECT_ENABLED || 'true').toLowerCase();
  if (toggle === 'false') return false;
  const key = (process.env.SHOPEE_PARTNER_ID || '').trim();
  return key.length > 0;
}

export function isTikTokBusinessConnectEnabled(): boolean {
  const toggle = (process.env.TIKTOK_BUSINESS_CONNECT_ENABLED || 'true').toLowerCase();
  if (toggle === 'false') return false;
  // Require BOTH app_id and secret — without the secret, token exchange will fail
  const key = (
    process.env.TIKTOK_BUSINESS_CLIENT_KEY ||
    process.env.TIKTOK_BUSINESS_APP_ID ||
    ''
  ).trim();
  const secret = (
    process.env.TIKTOK_BUSINESS_CLIENT_SECRET ||
    process.env.TIKTOK_BUSINESS_APP_SECRET ||
    ''
  ).trim();
  return key.length > 0 && secret.length > 0;
}
