import { NextResponse } from 'next/server';
import {
  isTikTokBusinessConnectEnabled,
  isTikTokShopConnectEnabled,
  isShopeeConnectEnabled,
  isMetaAdsConnectEnabled,
  isGoogleAdsConnectEnabled,
} from '@/lib/integration-flags';

/**
 * Public config for the dashboard (no secrets). Used to show/hide connect cards.
 */
export async function GET() {
  return NextResponse.json({
    tiktokShop: isTikTokShopConnectEnabled(),
    tiktokBusiness: isTikTokBusinessConnectEnabled(),
    shopee: isShopeeConnectEnabled(),
    metaAds: isMetaAdsConnectEnabled(),
    googleAds: isGoogleAdsConnectEnabled(),
  });
}
