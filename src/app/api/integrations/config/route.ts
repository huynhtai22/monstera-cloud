import { NextResponse } from 'next/server';
import {
  isTikTokBusinessConnectEnabled,
  isTikTokShopConnectEnabled,
  isShopeeConnectEnabled,
  isMetaAdsConnectEnabled,
  isGoogleAdsConnectEnabled,
  isAmazonConnectEnabled,
  isLazadaConnectEnabled,
} from '@/lib/integration-flags';
import {
  amazonSpOAuthRedirectUri,
  googleAdsOAuthRedirectUri,
  lazadaOAuthRedirectUri,
  metaAdsOAuthRedirectUri,
} from '@/lib/oauth-callback-urls';
import { isAmazonOAuthEnvConfigured } from '@/lib/amazon-sp';
import { isLazadaOAuthEnvConfigured } from '@/lib/lazada';
import { PRODUCT_SITE_URL } from '@/lib/site-url';

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
    googleAds: isGoogleAdsConnectEnabled(),
    amazon:
      isAmazonConnectEnabled() && isAmazonOAuthEnvConfigured(),
    lazada: isLazadaConnectEnabled() && isLazadaOAuthEnvConfigured(),
    productDomain: PRODUCT_SITE_URL,
    oauthCallbacks: {
      metaAds: metaAdsOAuthRedirectUri(request),
      googleAds: googleAdsOAuthRedirectUri(request),
      amazon: amazonSpOAuthRedirectUri(request),
      lazada: lazadaOAuthRedirectUri(request),
    },
    /** Same paths on MonsteraCloud.com — paste these into Meta / Google Cloud consoles for production. */
    oauthCallbacksProduction: {
      metaAds: `${PRODUCT_SITE_URL}/api/auth/meta-ads/callback`,
      googleAds: `${PRODUCT_SITE_URL}/api/auth/google-ads/callback`,
      amazon: `${PRODUCT_SITE_URL}/api/auth/amazon/callback`,
      lazada: `${PRODUCT_SITE_URL}/api/auth/lazada/callback`,
    },
  });
}
