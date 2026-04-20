import type { EtlProvider, ExtractResult, PipelineContext } from '@/etl/types';
import { extractShopeeOrders } from '@/etl/extractors/shopee';
import { extractShopifyOrders } from '@/etl/extractors/shopify';
import { extractAmazonOrders } from '@/etl/extractors/amazon';
import { extractLazadaOrders } from '@/etl/extractors/lazada';
import { extractCampaignMetricsFromDb } from '@/etl/extractors/campaignMetrics';

export async function extractForProvider(opts: {
  provider: EtlProvider;
  ctx: PipelineContext;
  sourceCreds: any;
  cursorRaw: string | null;
}): Promise<ExtractResult> {
  switch (opts.provider) {
    case 'shopee':
      return extractShopeeOrders(opts.ctx, opts.sourceCreds, opts.cursorRaw);
    case 'shopify':
      return extractShopifyOrders(opts.ctx, opts.sourceCreds, opts.cursorRaw);
    case 'amazon':
      return extractAmazonOrders(opts.ctx, opts.sourceCreds, opts.cursorRaw);
    case 'lazada':
      return extractLazadaOrders(opts.ctx, opts.sourceCreds, opts.cursorRaw);
    case 'meta_ads':
    case 'google_ads':
    case 'tiktok_business':
      return extractCampaignMetricsFromDb({ connectionId: opts.ctx.sourceConnectionId, cursorRaw: opts.cursorRaw });
    default:
      throw new Error(`Unsupported source provider: ${opts.provider}`);
  }
}

