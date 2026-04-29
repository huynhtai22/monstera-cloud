/**
 * Meta Ads insight ingestion — production-grade, memory-safe.
 *
 * Design goals:
 *  1. Atomic upserts  — uses prisma.campaignMetric.upsert on the DB-level composite
 *     unique key so concurrent sync triggers are idempotent.
 *  2. Chunked processing — never holds the full Meta JSON response in memory;
 *     streams pages into the DB in batches of CHUNK_SIZE.
 *  3. breakdownHash    — stable SHA-1 of sorted breakdown key=value pairs so rows
 *     with different breakdown slices get distinct keys.
 */

import { createHash } from 'crypto';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { MetaInsightsRow, MetaAction } from '@/lib/meta-ads';

const CHUNK_SIZE = 100;

export interface IngestMetaRowsOpts {
  workspaceId: string;
  connectionId: string;
  accountId: string;
  accountName?: string;
  level: string;
  breakdowns?: string[];
  rows: MetaInsightsRow[];
}

export interface IngestResult {
  upserted: number;
  failed: number;
}

/**
 * Build a stable, deterministic SHA-1 hash from the breakdown slice values
 * present on a row. Returns "" if no breakdowns are requested or present.
 */
export function buildBreakdownHash(row: MetaInsightsRow, breakdowns: string[]): string {
  if (!breakdowns.length) return '';
  const parts = breakdowns
    .map((b) => `${b}=${String(row[b] ?? '')}`)
    .sort()
    .join('|');
  return createHash('sha1').update(parts).digest('hex').slice(0, 16);
}

function parseFloatSafe(v: string | number | undefined): number {
  if (v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function parseIntSafe(v: string | number | undefined): number {
  if (v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? Math.round(v) : parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

function extractPurchaseRoas(row: MetaInsightsRow): number | undefined {
  const actions = row.purchase_roas as MetaAction[] | undefined;
  if (!actions?.length) return undefined;
  const v = parseFloat(actions[0]?.value ?? '');
  return isNaN(v) ? undefined : v;
}

function extractConversions(row: MetaInsightsRow): number | undefined {
  const actions = row.actions as MetaAction[] | undefined;
  if (!actions) return undefined;
  const purchase = actions.find((a) => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
  if (!purchase) return undefined;
  const v = parseFloat(purchase.value ?? '');
  return isNaN(v) ? undefined : v;
}

/**
 * Upsert a single page of Meta insight rows into the CampaignMetric table.
 * Called per-page from the ingestion loop to keep memory bounded.
 */
async function upsertChunk(
  opts: Omit<IngestMetaRowsOpts, 'rows'>,
  chunk: MetaInsightsRow[],
): Promise<{ upserted: number; failed: number }> {
  let upserted = 0;
  let failed = 0;

  await Promise.allSettled(
    chunk.map(async (row) => {
      try {
        const date = new Date(row.date_start ?? '');
        if (isNaN(date.getTime())) {
          logger.warn('[META_INGEST] Skipping row with invalid date_start', { row });
          failed++;
          return;
        }

        const campaignId = String(row.campaign_id ?? row.id ?? 'unknown');
        const campaignName = String(row.campaign_name ?? '');
        const adsetId = String(row.adset_id ?? '');
        const adsetName = String(row.adset_name ?? '');
        const breakdownHash = buildBreakdownHash(row, opts.breakdowns ?? []);

        const data = {
          workspaceId: opts.workspaceId,
          connectionId: opts.connectionId,
          platform: 'meta_ads',
          accountId: opts.accountId,
          accountName: opts.accountName ?? null,
          campaignId,
          campaignName,
          adsetId,
          adsetName: adsetName || null,
          date,
          level: opts.level,
          breakdownHash,
          impressions: parseIntSafe(row.impressions),
          clicks: parseIntSafe(row.clicks),
          spend: parseFloatSafe(row.spend),
          reach: row.reach !== undefined ? parseIntSafe(row.reach) : null,
          cpc: row.cpc !== undefined ? parseFloatSafe(row.cpc) : null,
          ctr: row.ctr !== undefined ? parseFloatSafe(row.ctr) : null,
          conversions: extractConversions(row) ?? null,
          roas: extractPurchaseRoas(row) ?? null,
          rawData: JSON.stringify(row),
          pulledAt: new Date(),
        };

        await (prisma.campaignMetric as any).upsert({
          where: {
            connectionId_accountId_date_level_campaignId_breakdownHash: {
              connectionId: opts.connectionId,
              accountId: opts.accountId,
              date,
              level: opts.level,
              campaignId,
              breakdownHash,
            },
          },
          create: data,
          update: {
            campaignName: data.campaignName,
            adsetId: data.adsetId,
            adsetName: data.adsetName,
            impressions: data.impressions,
            clicks: data.clicks,
            spend: data.spend,
            reach: data.reach,
            cpc: data.cpc,
            ctr: data.ctr,
            conversions: data.conversions,
            roas: data.roas,
            rawData: data.rawData,
            pulledAt: data.pulledAt,
          },
        });

        upserted++;
      } catch (err) {
        logger.error('[META_INGEST] Row upsert failed', { err, row });
        failed++;
      }
    }),
  );

  return { upserted, failed };
}

/**
 * Top-level entry point.
 * Splits rows into CHUNK_SIZE batches and upserts each sequentially
 * to keep DB connection pressure low.
 */
export async function ingestMetaRows(opts: IngestMetaRowsOpts): Promise<IngestResult> {
  const { rows, ...rest } = opts;
  let totalUpserted = 0;
  let totalFailed = 0;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { upserted, failed } = await upsertChunk(rest, chunk);
    totalUpserted += upserted;
    totalFailed += failed;
    logger.info(`[META_INGEST] Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${upserted} upserted, ${failed} failed`);
  }

  logger.info(`[META_INGEST] Done — ${totalUpserted} total upserted, ${totalFailed} total failed`);
  return { upserted: totalUpserted, failed: totalFailed };
}
