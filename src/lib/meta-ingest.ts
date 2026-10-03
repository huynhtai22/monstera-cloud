/**
 * Meta Ads insight ingestion — production-grade, memory-safe.
 *
 * Design goals:
 *  1. Fenced atomic upserts — delegates to upsertMetaMetric() which first asserts
 *     SyncLock lease ownership (fencingToken check) before writing. Zombie workers
 *     are rejected before they can create duplicates.
 *  2. Chunked processing — never holds the full API response in memory; processes
 *     rows in batches of CHUNK_SIZE, calling heartbeat between chunks.
 *  3. buildBreakdownHash — stable SHA-1 of sorted breakdown key=value pairs.
 */

import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import {
  upsertMetaMetric,
  heartbeatMetaSyncLock,
  normalizeMetaAdName,
  type MetaMetricPayload,
} from '@/lib/meta-sync-lock';
import type { MetaInsightsRow, MetaAction } from '@/lib/meta-ads';
import { recordPayloadSchemaDiscovery } from '@/lib/payload-schema-discovery';
import {
  flushMetaPayloadBatches,
  isWarehouseBulkUpsertEnabled,
  type MetaFlushRow,
} from '@/lib/warehouse-bulk-upsert';

const CHUNK_SIZE = 100;
/** Canonical Meta CampaignMetric fact grain used by every active sync path. */
export const META_CANONICAL_METRIC_GRAIN = "ad" as const;

export interface IngestMetaRowsOpts {
  workspaceId: string;
  connectionId: string;
  accountId: string;
  accountName?: string;
  currency?: string;
  level: string;
  breakdowns?: string[];
  rows: MetaInsightsRow[];
  syncJobId: string;
  lockScope: string;
  leaseId: string;
  fencingToken: bigint;
}

export interface IngestResult {
  upserted: number;
  failed: number;
}

/**
 * Build a stable, deterministic SHA-1 hash from the breakdown slice values
 * present on a row. Returns "none" if no breakdowns are requested or present.
 */
export function buildBreakdownHash(row: MetaInsightsRow, breakdowns: string[]): string {
  if (!breakdowns.length) return 'none';
  const parts = breakdowns
    .map((b) => `${b}=${String(row[b] ?? '')}`)
    .sort()
    .join('|');
  return createHash('sha1').update(parts).digest('hex').slice(0, 16);
}

/**
 * Derive the entityId for the composite unique key based on the level being synced.
 * campaign → campaign_id, adset → adset_id, ad → ad_id, account → account_id.
 */
function resolveEntityId(row: MetaInsightsRow, level: string, accountId: string): string {
  switch (level) {
    case 'ad':      return String(row.ad_id      ?? row.id ?? row.ad_name ?? 'unknown_ad');
    case 'adset':   return String(row.adset_id   ?? row.id ?? row.adset_name ?? 'unknown_adset');
    case 'account': return accountId;
    default:        return String(row.campaign_id ?? row.id ?? row.campaign_name ?? 'unknown_campaign');
  }
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

function extractPurchaseRoas(row: MetaInsightsRow): number {
  const actions = row.purchase_roas as MetaAction[] | undefined;
  if (!actions?.length) return 0;
  const v = parseFloat(actions[0]?.value ?? '');
  return isNaN(v) ? 0 : v;
}

function extractConversions(row: MetaInsightsRow): number {
  const actions = row.actions as MetaAction[] | undefined;
  if (!actions || !actions.length) return 0;
  let total = 0;
  for (const a of actions) {
    if (
      a.action_type === 'purchase' ||
      a.action_type === 'offsite_conversion.fb_pixel_purchase' ||
      a.action_type === 'omni_purchase' ||
      a.action_type === 'web_in_store_purchase' ||
      a.action_type === 'lead' ||
      a.action_type === 'offsite_conversion.fb_pixel_lead'
    ) {
      const v = parseFloat(a.value ?? '');
      if (!isNaN(v)) total += v;
    }
  }
  return total;
}

function extractRevenue(row: MetaInsightsRow): number {
  const actionValues = row.action_values as MetaAction[] | undefined;
  if (!actionValues) return 0;
  const purchase = actionValues.find(
    (a) =>
      a.action_type === 'purchase' ||
      a.action_type === 'offsite_conversion.fb_pixel_purchase' ||
      a.action_type === 'omni_purchase' ||
      a.action_type === 'web_in_store_purchase',
  );
  if (!purchase) return 0;
  const v = parseFloat(purchase.value ?? '');
  return isNaN(v) ? 0 : v;
}

/**
 * Process one chunk of rows with fenced upserts.
 * Calls heartbeat before the chunk to keep the lease alive.
 */
async function processChunk(
  opts: Omit<IngestMetaRowsOpts, 'rows'>,
  chunk: MetaInsightsRow[],
): Promise<{ upserted: number; failed: number }> {
  // Heartbeat before each chunk — extends the lease and detects stolen locks early
  await heartbeatMetaSyncLock({ scope: opts.lockScope, leaseId: opts.leaseId });

  // Bulk path (disabled by default): same validation, fenced UNNEST upsert
  // with per-row fallback. The per-row loop below is unchanged.
  if (isWarehouseBulkUpsertEnabled()) {
    return processChunkBulk(opts, chunk);
  }

  let upserted = 0;
  let failed = 0;

  await Promise.allSettled(
    chunk.map(async (row) => {
      try {
        const date = new Date(row.date_start ?? '');
        if (isNaN(date.getTime())) {
          logger.warn('[META_INGEST] Skipping row — invalid date_start', { row });
          failed++;
          return;
        }

        const entityId    = resolveEntityId(row, opts.level, opts.accountId);
        const campaignId  = String(row.campaign_id ?? '');
        const campaignName = String(row.campaign_name ?? '');
        const adsetId     = String(row.adset_id ?? '');
        const adsetName   = String(row.adset_name ?? '');
        const adId        = String(row.ad_id ?? '');
        const adName      = normalizeMetaAdName(row.ad_name);
        const breakdownHash = buildBreakdownHash(row, opts.breakdowns ?? []);

        const metrics: MetaMetricPayload = {
          impressions:  parseIntSafe(row.impressions),
          clicks:       parseIntSafe(row.clicks),
          spend:        parseFloatSafe(row.spend),
          reach:        parseIntSafe(row.reach),
          cpc:          parseFloatSafe(row.cpc),
          ctr:          parseFloatSafe(row.ctr),
          conversions:  extractConversions(row),
          revenue:      extractRevenue(row),
          roas:         extractPurchaseRoas(row),
          currency:     opts.currency,
          rawData:      row,
        };

        await upsertMetaMetric({
          workspaceId:  opts.workspaceId,
          connectionId: opts.connectionId,
          accountId:    opts.accountId,
          accountName:  opts.accountName,
          level:        opts.level,
          entityId,
          campaignId,
          campaignName,
          adsetId,
          adsetName,
          adId,
          adName,
          date,
          breakdownHash,
          metrics,
          syncJobId:    opts.syncJobId,
          lockScope:    opts.lockScope,
          leaseId:      opts.leaseId,
          fencingToken: opts.fencingToken,
        });

        upserted++;
      } catch (err) {
        logger.error('[META_INGEST] Row upsert failed', { err });
        failed++;
      }
    }),
  );

  return { upserted, failed };
}

/**
 * Bulk variant of processChunk. Validation mirrors the per-row loop exactly;
 * validated rows flush through the fenced UNNEST path. A lost lease throws
 * (zero writes by construction); callers treat it as a fatal sync error like
 * the per-row lease assertion.
 */
async function processChunkBulk(
  opts: Omit<IngestMetaRowsOpts, 'rows'>,
  chunk: MetaInsightsRow[],
): Promise<{ upserted: number; failed: number }> {
  const rows: MetaFlushRow[] = [];
  let failed = 0;
  for (const row of chunk) {
    const date = new Date(row.date_start ?? '');
    if (isNaN(date.getTime())) {
      logger.warn('[META_INGEST] Skipping row — invalid date_start', { row });
      failed++;
      continue;
    }
    rows.push({
      workspaceId: opts.workspaceId,
      connectionId: opts.connectionId,
      accountId: opts.accountId,
      accountName: opts.accountName,
      level: opts.level,
      entityId: resolveEntityId(row, opts.level, opts.accountId),
      campaignId: String(row.campaign_id ?? ''),
      campaignName: String(row.campaign_name ?? ''),
      adsetId: String(row.adset_id ?? ''),
      adsetName: String(row.adset_name ?? ''),
      adId: String(row.ad_id ?? ''),
      adName: normalizeMetaAdName(row.ad_name),
      date,
      breakdownHash: buildBreakdownHash(row, opts.breakdowns ?? []),
      metrics: {
        impressions: parseIntSafe(row.impressions),
        clicks: parseIntSafe(row.clicks),
        spend: parseFloatSafe(row.spend),
        reach: parseIntSafe(row.reach),
        cpc: parseFloatSafe(row.cpc),
        ctr: parseFloatSafe(row.ctr),
        conversions: extractConversions(row),
        revenue: extractRevenue(row),
        roas: extractPurchaseRoas(row),
        currency: opts.currency,
        rawData: row,
      },
      syncJobId: opts.syncJobId,
    });
  }
  const result = await flushMetaPayloadBatches(rows, {
    lease: { scope: opts.lockScope, leaseId: opts.leaseId, fencingToken: opts.fencingToken },
    fallbackRow: (flushRow) =>
      upsertMetaMetric({
        workspaceId: flushRow.workspaceId,
        connectionId: flushRow.connectionId,
        accountId: flushRow.accountId,
        accountName: flushRow.accountName,
        level: flushRow.level,
        entityId: flushRow.entityId,
        campaignId: flushRow.campaignId,
        campaignName: flushRow.campaignName,
        adsetId: flushRow.adsetId,
        adsetName: flushRow.adsetName,
        adId: flushRow.adId,
        adName: flushRow.adName,
        date: flushRow.date,
        breakdownHash: flushRow.breakdownHash,
        metrics: flushRow.metrics,
        syncJobId: flushRow.syncJobId,
        lockScope: opts.lockScope,
        leaseId: opts.leaseId,
        fencingToken: opts.fencingToken,
      }),
  });
  return { upserted: result.upserted, failed: failed + result.failed };
}

/**
 * Top-level entry point.
 * Splits rows into CHUNK_SIZE batches, processes sequentially to bound DB pressure,
 * and heartbeats between each chunk.
 *
 * Callers must acquire a SyncLock before calling this and release it after.
 */
export async function ingestMetaRows(opts: IngestMetaRowsOpts): Promise<IngestResult> {
  const { rows, ...rest } = opts;
  if (rows[0]) {
    void recordPayloadSchemaDiscovery({
      workspaceId: opts.workspaceId,
      connectionId: opts.connectionId,
      provider: "meta_ads",
      sample: rows[0],
    });
  }
  let totalUpserted = 0;
  let totalFailed = 0;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { upserted, failed } = await processChunk(rest, chunk);
    totalUpserted += upserted;
    totalFailed += failed;
    logger.info(
      `[META_INGEST] Chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(rows.length / CHUNK_SIZE)}: ` +
      `${upserted} upserted, ${failed} failed`,
    );
  }

  logger.info(`[META_INGEST] Complete — ${totalUpserted} upserted, ${totalFailed} failed`);
  return { upserted: totalUpserted, failed: totalFailed };
}
