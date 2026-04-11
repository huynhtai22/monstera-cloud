import prisma from '@/lib/prisma';
import { ExtractResult, safeJsonParse } from '@/etl/types';
import { normalizeCampaignName } from '@/etl/normalize/naming';

const DEFAULT_COLUMNS = [
  'Date',
  'Campaign',
  'Impressions',
  'Clicks',
  'Spend',
  'CPC',
  'CTR',
  'Conversions',
  'ROAS',
];

export async function extractCampaignMetricsFromDb(opts: {
  connectionId: string;
  cursorRaw: string | null;
}): Promise<ExtractResult> {
  const cursor = opts.cursorRaw ? safeJsonParse(opts.cursorRaw) : null;
  const after = cursor?.lastDate ? new Date(String(cursor.lastDate)) : null;

  const metrics = await prisma.campaignMetric.findMany({
    where: {
      connectionId: opts.connectionId,
      ...(after ? { date: { gt: after } } : {}),
    },
    orderBy: { date: 'desc' },
    take: 10000,
  });

  if (metrics.length === 0) {
    return { columns: [], rows: [], nextCursor: null };
  }

  const rows = metrics.map((m: any) => [
    new Date(m.date).toISOString().split('T')[0],
    normalizeCampaignName(m.campaignName),
    m.impressions,
    m.clicks,
    m.spend,
    m.cpc,
    m.ctr,
    m.conversions,
    m.roas,
  ]);

  return {
    columns: DEFAULT_COLUMNS,
    rows,
    nextCursor: { lastDate: new Date(metrics[0].date).toISOString() },
  };
}

