import { NextResponse } from "next/server";
import { INTEGRATION_LOGOS, absoluteIntegrationLogo } from "@/lib/integration-logos";

/**
 * GET /api/v1/sheets/schema
 * Returns available data sources, dimensions, and metrics for the add-on sidebar.
 * No auth required — this is just the catalog of what's available.
 */

const SCHEMA = {
  sources: [
    {
      id: 'tiktok_ads',
      name: 'TikTok Ads',
      logo: absoluteIntegrationLogo(INTEGRATION_LOGOS.tiktok),
      dataLevels: [
        { value: 'AUCTION_ADVERTISER', label: 'Account' },
        { value: 'AUCTION_CAMPAIGN', label: 'Campaign' },
        { value: 'AUCTION_ADGROUP', label: 'Ad Group' },
        { value: 'AUCTION_AD', label: 'Ad' },
      ],
      dimensions: [
        { value: 'stat_time_day', label: 'Day', levels: ['AUCTION_ADVERTISER', 'AUCTION_CAMPAIGN', 'AUCTION_ADGROUP', 'AUCTION_AD'] },
        { value: 'campaign_id', label: 'Campaign ID', levels: ['AUCTION_CAMPAIGN', 'AUCTION_ADGROUP', 'AUCTION_AD'] },
        { value: 'adgroup_id', label: 'Ad Group ID', levels: ['AUCTION_ADGROUP', 'AUCTION_AD'] },
        { value: 'ad_id', label: 'Ad ID', levels: ['AUCTION_AD'] },
      ],
      metrics: [
        { value: 'spend', label: 'Spend' },
        { value: 'impressions', label: 'Impressions' },
        { value: 'clicks', label: 'Clicks' },
        { value: 'ctr', label: 'CTR (%)' },
        { value: 'cpm', label: 'CPM' },
        { value: 'cpc', label: 'CPC' },
        { value: 'conversion', label: 'Conversions' },
        { value: 'cost_per_conversion', label: 'Cost / Conversion' },
        { value: 'conversion_rate', label: 'Conv. Rate (%)' },
        { value: 'real_time_conversion', label: 'Real-time Conversions' },
        { value: 'video_play_actions', label: 'Video Plays' },
        { value: 'video_watched_2s', label: '2s Video Views' },
        { value: 'video_watched_6s', label: '6s Video Views' },
        { value: 'reach', label: 'Reach' },
      ],
    },
  ],
};

export async function GET() {
  return NextResponse.json(SCHEMA);
}
