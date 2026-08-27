import { NextResponse } from 'next/server';
import {
  isTikTokBusinessConnectEnabled,
  isTikTokShopConnectEnabled,
  isShopeeConnectEnabled,
  isMetaAdsConnectEnabled,
  isGoogleAdsConnectEnabled,
  isAmazonConnectEnabled,
  isLazadaConnectEnabled,
  isShopifyConnectEnabled,
} from '@/lib/integration-flags';
import {
  amazonSpOAuthRedirectUri,
  googleAdsOAuthRedirectUri,
  lazadaOAuthRedirectUri,
  metaAdsOAuthRedirectUri,
  providerOAuthCallbackUri,
} from '@/lib/oauth-callback-urls';
import { isAmazonOAuthEnvConfigured } from '@/lib/amazon-sp';
import { isLazadaOAuthEnvConfigured } from '@/lib/lazada';
import { PRODUCT_SITE_URL } from '@/lib/site-url';
import { isProviderConfigured } from '@/lib/oauth-framework/registry';

/**
 * Public config for the console (no secrets). Used to show/hide connect cards.
 * oauthCallbacks — exact redirect URIs to register in Meta & Google Cloud consoles.
 */
export async function GET(request: Request) {
  return NextResponse.json({
    tiktokShop: isTikTokShopConnectEnabled(),
    tiktokBusiness: isTikTokBusinessConnectEnabled(),
    shopee: isShopeeConnectEnabled(),
    metaAds: isMetaAdsConnectEnabled(),
    googleAds: isGoogleAdsConnectEnabled() && isProviderConfigured('google_ads'),
    amazon:
      isAmazonConnectEnabled() && isAmazonOAuthEnvConfigured(),
    lazada: isLazadaConnectEnabled() && isLazadaOAuthEnvConfigured(),
    shopify: isShopifyConnectEnabled(),
    productDomain: PRODUCT_SITE_URL,
    oauthCallbacks: {
      metaAds: metaAdsOAuthRedirectUri(request),
      googleAds: googleAdsOAuthRedirectUri(request),
      amazon: amazonSpOAuthRedirectUri(request),
      lazada: lazadaOAuthRedirectUri(request),
    },
    /** Exact production callback URIs to register with each OAuth provider. */
    oauthCallbacksProduction: {
      metaAds: `${PRODUCT_SITE_URL}/api/auth/meta-ads/callback`,
      googleAds: providerOAuthCallbackUri(PRODUCT_SITE_URL, 'google_ads'),
      amazon: `${PRODUCT_SITE_URL}/api/auth/amazon/callback`,
      lazada: `${PRODUCT_SITE_URL}/api/auth/lazada/callback`,
    },
  });
}
