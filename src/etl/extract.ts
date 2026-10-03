import type { EtlProvider, ExtractResult, PipelineContext } from '@/etl/types';
import { extractShopeeOrders } from '@/etl/extractors/shopee';
import { extractShopifyOrders } from '@/etl/extractors/shopify';
import { extractAmazonOrders } from '@/etl/extractors/amazon';
import { extractLazadaOrders } from '@/etl/extractors/lazada';
import { extractCampaignMetricsFromDb } from '@/etl/extractors/campaignMetrics';
import { PROVIDER_SOURCE_GRAINS, type VerifiedReportProvider } from '@/lib/provider-metric-grain';

export async function extractForProvider(opts: {
  provider: EtlProvider;
  ctx: PipelineContext;
  sourceCreds: any;
  cursorRaw: string | null;
  userPlan: string;
}): Promise<ExtractResult> {
  switch (opts.provider) {
    case 'shopee':
      return extractShopeeOrders(opts.ctx, opts.sourceCreds, opts.cursorRaw);
    case 'shopify':
      return extractShopifyOrders(opts.ctx, opts.sourceCreds, opts.cursorRaw);
    case 'amazon':
      return extractAmazonOrders();
    case 'lazada':
      return extractLazadaOrders();
    case 'meta_ads':
      // Pipeline orchestration pre-syncs Meta through syncConnectionData, whose
      // canonical CampaignMetric contract is ad-day grain. Extraction is a
      // warehouse read only; it must never invoke the legacy campaign writer.
      return extractCampaignMetricsFromDb({ connectionId: opts.ctx.sourceConnectionId, cursorRaw: opts.cursorRaw, provider: opts.provider, level: PROVIDER_SOURCE_GRAINS.meta_ads });
    case 'google_ads':
    case 'tiktok_business':
      return extractCampaignMetricsFromDb({ connectionId: opts.ctx.sourceConnectionId, cursorRaw: opts.cursorRaw, provider: opts.provider, level: PROVIDER_SOURCE_GRAINS[opts.provider as VerifiedReportProvider] });
    default:
      throw new Error(`Unsupported source provider: ${opts.provider}`);
  }
}
