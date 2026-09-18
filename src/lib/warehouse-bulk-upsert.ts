/**
 * Fenced bulk upsert for CampaignMetric (Workstream 11: ingestion performance).
 *
 * Disabled by default behind `WAREHOUSE_BULK_UPSERT_ENABLED=1`. When disabled,
 * every caller uses the existing per-row Prisma path; this module is inert.
 *
 * Design (Tab 2 approved):
 * - One `$executeRaw` statement per batch with typed parallel arrays + UNNEST.
 * - Same conflict key as the per-row path:
 *   (connectionId, accountId, level, entityId, date, breakdownHash).
 * - Meta batches carry fencing inside the same statement via a `lease_ok` CTE
 *   (scope + leaseId + fencingToken + running + unexpired). No
 *   assert-once-per-batch: a stolen lease yields zero writes by construction.
 * - Generic batches mirror the per-row path (lease evidence stamped, no
 *   per-write assert; callers heartbeat per batch as they do per chunk today).
 * - Batches are bounded by row count AND payload-byte budget; a single row
 *   larger than the byte budget bypasses bulk and uses the per-row fallback.
 * - Any bulk batch failure falls back to row-by-row processing through the
 *   existing per-row upserts, preserving failure accounting.
 *
 * Non-goals: no schema/index changes, no flag enablement, no backfill,
 * pruning, cron, or connector behavior changes.
 */

import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { CampaignMetricPayload } from "@/lib/ad-platform-ingest";

/** Disabled by default. Set to exactly "1" to enable the bulk path. */
export function isWarehouseBulkUpsertEnabled(): boolean {
  return process.env.WAREHOUSE_BULK_UPSERT_ENABLED === "1";
}

/**
 * Conservative explicit byte/row budgets (NOT Tab 2 selected values).
 *
 * - 1000 rows: the low end of the 1k–5k design range. UNNEST binds one array
 *   per column, so Postgres' 65535-parameter limit is not binding; the row cap
 *   instead bounds lock-hold time and fallback blast radius.
 * - 256 KiB payload bytes: rawData payloads are unbounded strings, so bytes
 *   (not rows) dominate statement size. 256 KiB keeps statements small enough
 *   to avoid long row locks and multi-hundred-row replays on fallback, while
 *   still collapsing the common case (small ad rows) into few round trips.
 */
export const BULK_UPSERT_DEFAULT_MAX_ROWS = 1000;
export const BULK_UPSERT_DEFAULT_MAX_BYTES = 262144;

export function bulkUpsertMaxRows(): number {
  const raw = Number(process.env.WAREHOUSE_BULK_MAX_ROWS ?? BULK_UPSERT_DEFAULT_MAX_ROWS);
  if (!Number.isFinite(raw)) return BULK_UPSERT_DEFAULT_MAX_ROWS;
  return Math.min(5000, Math.max(1, Math.floor(raw)));
}

export function bulkUpsertMaxBytes(): number {
  const raw = Number(process.env.WAREHOUSE_BULK_MAX_BYTES ?? BULK_UPSERT_DEFAULT_MAX_BYTES);
  if (!Number.isFinite(raw)) return BULK_UPSERT_DEFAULT_MAX_BYTES;
  return Math.max(65536, Math.floor(raw));
}

/** Sanitized bulk row. Mirrors the per-row upsert sanitization exactly. */
export interface BulkMetricRow {
  /** Client-generated PK: raw SQL bypasses Prisma's client-side cuid() default. */
  id: string;
  workspaceId: string;
  connectionId: string;
  platform: string;
  accountId: string;
  accountName: string | null;
  level: string;
  entityId: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string | null;
  adId: string;
  date: Date;
  breakdownHash: string;
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  cpc: number;
  ctr: number;
  conversions: number;
  revenue: number;
  roas: number;
  currency: string | null;
  rawData: string | null;
  adName: string | null;
  shopeeBroadOrders: number | null;
  shopeeBroadUnits: number | null;
  shopeeBroadGmv: number | null;
  shopeeDirectOrders: number | null;
  shopeeDirectUnits: number | null;
  shopeeDirectGmv: number | null;
  shopeeKeywordSettingsCount: number | null;
  syncJobId: string | null;
  lockScope: string | null;
  /** Pre-sanitized decimal string for ::bigint binding (null when absent). */
  fencingToken: string | null;
}

export interface BulkRowInput {
  workspaceId: string;
  connectionId: string;
  platform: string;
  accountId: string;
  accountName?: string;
  level?: string;
  entityId: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  adId?: string;
  date: Date;
  breakdownHash?: string;
  impressions: number;
  clicks: number;
  spend: number;
  reach?: number;
  cpc: number;
  ctr: number;
  conversions: number;
  revenue?: number;
  roas?: number;
  currency?: string;
  rawData?: unknown;
  adName?: string | null;
  shopeeBroadOrders?: number | null;
  shopeeBroadUnits?: number | null;
  shopeeBroadGmv?: number | null;
  shopeeDirectOrders?: number | null;
  shopeeDirectUnits?: number | null;
  shopeeDirectGmv?: number | null;
  shopeeKeywordSettingsCount?: number | null;
  syncJobId?: string;
  lockScope?: string;
  fencingToken?: bigint;
}

export class BulkRowPoisonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkRowPoisonError";
  }
}

const num = (v: number, round = false): number => {
  if (!Number.isFinite(v)) return 0;
  const clamped = Math.max(0, v);
  return round ? Math.round(clamped) : clamped;
};

const numOrNull = (v: number | null | undefined): number | null => {
  if (v == null) return null;
  if (!Number.isFinite(v)) return null;
  return Math.max(0, v);
};

/**
 * Pre-sanitize one row before binding. Mirrors the per-row upsert rules:
 * finite/non-negative numbers, trimmed strings, JSON-serialized rawData.
 * Throws BulkRowPoisonError when the row cannot be bound (bad date,
 * unserializable rawData) so the caller falls back to per-row processing.
 */
export function sanitizeBulkRow(input: BulkRowInput): BulkMetricRow {
  if (!(input.date instanceof Date) || isNaN(input.date.getTime())) {
    throw new BulkRowPoisonError("bulk row has an invalid date");
  }
  let rawData: string | null = null;
  if (input.rawData !== undefined && input.rawData !== null) {
    try {
      rawData = JSON.stringify(input.rawData);
    } catch {
      throw new BulkRowPoisonError("bulk row rawData is not serializable");
    }
  }
  const safeClicks = num(input.clicks, true);
  const safeImpressions = num(input.impressions, true);
  const safeSpend = num(input.spend);
  return {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    platform: input.platform,
    accountId: input.accountId,
    accountName: input.accountName ?? null,
    level: input.level?.trim() || "campaign",
    entityId: input.entityId?.trim() || input.campaignId?.trim() || "unknown_campaign",
    campaignId: input.campaignId?.trim() || input.entityId?.trim() || "unknown_campaign",
    campaignName: input.campaignName?.trim() || input.campaignId?.trim() || input.entityId?.trim() || "unknown_campaign",
    adsetId: input.adsetId ?? "",
    adsetName: input.adsetName ?? null,
    adId: input.adId ?? "",
    date: input.date,
    breakdownHash: input.breakdownHash?.trim() || "none",
    impressions: safeImpressions,
    clicks: safeClicks,
    spend: safeSpend,
    reach: num(input.reach ?? 0, true),
    cpc: Number.isFinite(input.cpc) ? Math.max(0, input.cpc) : safeClicks > 0 ? safeSpend / safeClicks : 0,
    ctr: Number.isFinite(input.ctr)
      ? Math.max(0, input.ctr)
      : safeImpressions > 0
        ? (safeClicks / safeImpressions) * 100
        : 0,
    conversions: num(input.conversions),
    revenue: num(input.revenue ?? 0),
    roas: num(input.roas ?? 0),
    currency: input.currency?.trim() || null,
    rawData,
    adName: typeof input.adName === "string" && input.adName.trim() ? input.adName : null,
    shopeeBroadOrders: numOrNull(input.shopeeBroadOrders),
    shopeeBroadUnits: numOrNull(input.shopeeBroadUnits),
    shopeeBroadGmv: numOrNull(input.shopeeBroadGmv),
    shopeeDirectOrders: numOrNull(input.shopeeDirectOrders),
    shopeeDirectUnits: numOrNull(input.shopeeDirectUnits),
    shopeeDirectGmv: numOrNull(input.shopeeDirectGmv),
    shopeeKeywordSettingsCount:
      input.shopeeKeywordSettingsCount == null ? null : Math.max(0, Math.round(input.shopeeKeywordSettingsCount)),
    syncJobId: input.syncJobId ?? null,
    lockScope: input.lockScope ?? null,
    fencingToken: input.fencingToken == null ? null : input.fencingToken.toString(),
  };
}

/** Rough payload-byte estimate: variable strings + fixed numeric overhead. */
export function estimateBulkRowBytes(row: BulkMetricRow): number {
  let bytes = 256;
  const strings = [
    row.workspaceId, row.connectionId, row.platform, row.accountId,
    row.level, row.entityId, row.campaignId, row.campaignName,
    row.adsetId, row.breakdownHash,
  ];
  for (const s of strings) bytes += Buffer.byteLength(s, "utf8");
  for (const s of [row.accountName, row.adsetName, row.adId, row.currency, row.rawData, row.adName, row.syncJobId, row.lockScope, row.fencingToken]) {
    if (s != null) bytes += Buffer.byteLength(s, "utf8");
  }
  return bytes;
}

export interface BulkBatch<T> {
  rows: T[];
  /** True when a single row exceeds the byte budget: use per-row fallback. */
  oversized: boolean;
}

/** Split sanitized rows into batches bounded by row count and byte budget. */
export function splitBulkBatches<T>(
  rows: T[],
  estimateBytes: (row: T) => number,
  maxRows: number = bulkUpsertMaxRows(),
  maxBytes: number = bulkUpsertMaxBytes(),
): Array<BulkBatch<T>> {
  const batches: Array<BulkBatch<T>> = [];
  let current: T[] = [];
  let currentBytes = 0;
  for (const row of rows) {
    const size = estimateBytes(row);
    if (size > maxBytes) {
      if (current.length > 0) {
        batches.push({ rows: current, oversized: false });
        current = [];
        currentBytes = 0;
      }
      batches.push({ rows: [row], oversized: true });
      continue;
    }
    if (current.length >= maxRows || (current.length > 0 && currentBytes + size > maxBytes)) {
      batches.push({ rows: current, oversized: false });
      current = [];
      currentBytes = 0;
    }
    current.push(row);
    currentBytes += size;
  }
  if (current.length > 0) batches.push({ rows: current, oversized: false });
  return batches;
}

// Column order shared by both bulk statements (INSERT column list).
// "id" is first: raw SQL bypasses Prisma's client-side cuid() default, so
// each row carries a generated PK. Updates never touch "id".
const BULK_COLUMNS = [
  '"id"', '"workspaceId"', '"connectionId"', '"platform"', '"accountId"', '"accountName"',
  '"level"', '"entityId"', '"campaignId"', '"campaignName"', '"adsetId"', '"adsetName"',
  '"adId"', '"date"', '"breakdownHash"', '"impressions"', '"clicks"', '"spend"',
  '"reach"', '"cpc"', '"ctr"', '"conversions"', '"revenue"', '"roas"', '"currency"',
  '"rawData"', '"adName"', '"shopeeBroadOrders"', '"shopeeBroadUnits"', '"shopeeBroadGmv"',
  '"shopeeDirectOrders"', '"shopeeDirectUnits"', '"shopeeDirectGmv"',
  '"shopeeKeywordSettingsCount"', '"syncJobId"', '"lockScope"', '"fencingToken"',
] as const;

// Per-row parity: the generic upsert never touches adName on update, and the
// Meta upsert never touches Shopee columns on update.
const GENERIC_UPDATE_SET = [
  '"accountName" = EXCLUDED."accountName"',
  '"campaignId" = EXCLUDED."campaignId"',
  '"campaignName" = EXCLUDED."campaignName"',
  '"adsetId" = EXCLUDED."adsetId"',
  '"adsetName" = EXCLUDED."adsetName"',
  '"adId" = EXCLUDED."adId"',
  '"impressions" = EXCLUDED."impressions"',
  '"clicks" = EXCLUDED."clicks"',
  '"spend" = EXCLUDED."spend"',
  '"reach" = EXCLUDED."reach"',
  '"cpc" = EXCLUDED."cpc"',
  '"ctr" = EXCLUDED."ctr"',
  '"conversions" = EXCLUDED."conversions"',
  '"revenue" = EXCLUDED."revenue"',
  '"roas" = EXCLUDED."roas"',
  '"currency" = EXCLUDED."currency"',
  '"rawData" = EXCLUDED."rawData"',
  '"shopeeBroadOrders" = EXCLUDED."shopeeBroadOrders"',
  '"shopeeBroadUnits" = EXCLUDED."shopeeBroadUnits"',
  '"shopeeBroadGmv" = EXCLUDED."shopeeBroadGmv"',
  '"shopeeDirectOrders" = EXCLUDED."shopeeDirectOrders"',
  '"shopeeDirectUnits" = EXCLUDED."shopeeDirectUnits"',
  '"shopeeDirectGmv" = EXCLUDED."shopeeDirectGmv"',
  '"shopeeKeywordSettingsCount" = EXCLUDED."shopeeKeywordSettingsCount"',
  '"syncJobId" = EXCLUDED."syncJobId"',
  '"lockScope" = EXCLUDED."lockScope"',
  '"fencingToken" = EXCLUDED."fencingToken"',
  '"pulledAt" = NOW()',
].join(", ");

const META_UPDATE_SET = [
  '"accountName" = EXCLUDED."accountName"',
  '"campaignId" = EXCLUDED."campaignId"',
  '"campaignName" = EXCLUDED."campaignName"',
  '"adsetId" = EXCLUDED."adsetId"',
  '"adsetName" = EXCLUDED."adsetName"',
  '"adId" = EXCLUDED."adId"',
  '"impressions" = EXCLUDED."impressions"',
  '"clicks" = EXCLUDED."clicks"',
  '"spend" = EXCLUDED."spend"',
  '"reach" = EXCLUDED."reach"',
  '"cpc" = EXCLUDED."cpc"',
  '"ctr" = EXCLUDED."ctr"',
  '"conversions" = EXCLUDED."conversions"',
  '"revenue" = EXCLUDED."revenue"',
  '"roas" = EXCLUDED."roas"',
  '"currency" = EXCLUDED."currency"',
  '"rawData" = EXCLUDED."rawData"',
  '"adName" = EXCLUDED."adName"',
  '"syncJobId" = EXCLUDED."syncJobId"',
  '"lockScope" = EXCLUDED."lockScope"',
  '"fencingToken" = EXCLUDED."fencingToken"',
  '"pulledAt" = NOW()',
].join(", ");

const CONFLICT_TARGET =
  '("connectionId", "accountId", "level", "entityId", "date", "breakdownHash")';

function columnArrays(rows: BulkMetricRow[]): Record<string, unknown[]> {
  const col = <T>(pick: (row: BulkMetricRow) => T): T[] => rows.map(pick);
  return {
    id: col((r) => r.id),
    workspaceId: col((r) => r.workspaceId),
    connectionId: col((r) => r.connectionId),
    platform: col((r) => r.platform),
    accountId: col((r) => r.accountId),
    accountName: col((r) => r.accountName),
    level: col((r) => r.level),
    entityId: col((r) => r.entityId),
    campaignId: col((r) => r.campaignId),
    campaignName: col((r) => r.campaignName),
    adsetId: col((r) => r.adsetId),
    adsetName: col((r) => r.adsetName),
    adId: col((r) => r.adId),
    date: col((r) => r.date.toISOString()),
    breakdownHash: col((r) => r.breakdownHash),
    impressions: col((r) => r.impressions),
    clicks: col((r) => r.clicks),
    spend: col((r) => r.spend),
    reach: col((r) => r.reach),
    cpc: col((r) => r.cpc),
    ctr: col((r) => r.ctr),
    conversions: col((r) => r.conversions),
    revenue: col((r) => r.revenue),
    roas: col((r) => r.roas),
    currency: col((r) => r.currency),
    rawData: col((r) => r.rawData),
    adName: col((r) => r.adName),
    shopeeBroadOrders: col((r) => r.shopeeBroadOrders),
    shopeeBroadUnits: col((r) => r.shopeeBroadUnits),
    shopeeBroadGmv: col((r) => r.shopeeBroadGmv),
    shopeeDirectOrders: col((r) => r.shopeeDirectOrders),
    shopeeDirectUnits: col((r) => r.shopeeDirectUnits),
    shopeeDirectGmv: col((r) => r.shopeeDirectGmv),
    shopeeKeywordSettingsCount: col((r) => r.shopeeKeywordSettingsCount),
    syncJobId: col((r) => r.syncJobId),
    lockScope: col((r) => r.lockScope),
    fencingToken: col((r) => r.fencingToken),
  };
}

const UNNEST_SELECT = [
  "$1::text[]", "$2::text[]", "$3::text[]", "$4::text[]", "$5::text[]",
  "$6::text[]", "$7::text[]", "$8::text[]", "$9::text[]", "$10::text[]",
  "$11::text[]", "$12::text[]", "$13::text[]", "$14::timestamptz[]", "$15::text[]",
  "$16::integer[]", "$17::integer[]", "$18::double precision[]",
  "$19::integer[]", "$20::double precision[]", "$21::double precision[]",
  "$22::double precision[]", "$23::double precision[]", "$24::double precision[]",
  "$25::text[]", "$26::text[]", "$27::text[]",
  "$28::double precision[]", "$29::double precision[]", "$30::double precision[]",
  "$31::double precision[]", "$32::double precision[]", "$33::double precision[]",
  "$34::integer[]", "$35::text[]", "$36::text[]", "$37::bigint[]",
].join(", ");

/** Build the generic (unfenced) bulk upsert statement + bind params. */
export function buildGenericBulkUpsert(rows: BulkMetricRow[]): { sql: string; params: unknown[] } {
  const arrays = columnArrays(rows);
  const order = [
    "id", "workspaceId", "connectionId", "platform", "accountId", "accountName",
    "level", "entityId", "campaignId", "campaignName", "adsetId", "adsetName",
    "adId", "date", "breakdownHash", "impressions", "clicks", "spend",
    "reach", "cpc", "ctr", "conversions", "revenue", "roas", "currency",
    "rawData", "adName", "shopeeBroadOrders", "shopeeBroadUnits", "shopeeBroadGmv",
    "shopeeDirectOrders", "shopeeDirectUnits", "shopeeDirectGmv",
    "shopeeKeywordSettingsCount", "syncJobId", "lockScope", "fencingToken",
  ];
  const sql = [
    `INSERT INTO "CampaignMetric" (${BULK_COLUMNS.join(", ")}, "pulledAt")`,
    `SELECT ${BULK_COLUMNS.join(", ")}, NOW() FROM UNNEST(${UNNEST_SELECT})`,
    `AS src(${BULK_COLUMNS.join(", ")})`,
    `ON CONFLICT ${CONFLICT_TARGET} DO UPDATE SET ${GENERIC_UPDATE_SET}`,
  ].join(" ");
  return { sql, params: order.map((key) => arrays[key]) };
}

export interface MetaBulkLease {
  scope: string;
  leaseId: string;
  fencingToken: bigint;
}

/**
 * Build the Meta bulk upsert with in-statement fencing. The `lease_ok` CTE
 * verifies scope, lease ID, fencing token, running status, and unexpired
 * lease inside the same statement: a stolen/expired lease yields zero writes
 * by construction (empty source set + guarded UPDATE).
 */
export function buildMetaBulkUpsert(
  rows: BulkMetricRow[],
  lease: MetaBulkLease,
): { sql: string; params: unknown[] } {
  const arrays = columnArrays(rows);
  const order = [
    "id", "workspaceId", "connectionId", "platform", "accountId", "accountName",
    "level", "entityId", "campaignId", "campaignName", "adsetId", "adsetName",
    "adId", "date", "breakdownHash", "impressions", "clicks", "spend",
    "reach", "cpc", "ctr", "conversions", "revenue", "roas", "currency",
    "rawData", "adName", "shopeeBroadOrders", "shopeeBroadUnits", "shopeeBroadGmv",
    "shopeeDirectOrders", "shopeeDirectUnits", "shopeeDirectGmv",
    "shopeeKeywordSettingsCount", "syncJobId", "lockScope", "fencingToken",
  ];
  const placeholders = order.map((_, index) => `$${index + 4}::${unnestType(index)}`);
  const sql = [
    `WITH lease_ok AS (`,
    `SELECT 1 AS ok WHERE EXISTS (`,
    `SELECT 1 FROM "SyncLock"`,
    `WHERE "scope" = $1 AND "leaseId" = $2 AND "fencingToken" = $3::bigint`,
    `AND "status" = 'running' AND "leaseExpiresAt" > NOW()`,
    `)`,
    `)`,
    `INSERT INTO "CampaignMetric" (${BULK_COLUMNS.join(", ")}, "pulledAt")`,
    `SELECT ${BULK_COLUMNS.join(", ")}, NOW() FROM UNNEST(${placeholders.join(", ")})`,
    `AS src(${BULK_COLUMNS.join(", ")}) CROSS JOIN lease_ok`,
    `ON CONFLICT ${CONFLICT_TARGET} DO UPDATE SET ${META_UPDATE_SET}`,
    `WHERE EXISTS (SELECT 1 FROM lease_ok)`,
  ].join(" ");
  return {
    sql,
    params: [lease.scope, lease.leaseId, lease.fencingToken.toString(), ...order.map((key) => arrays[key])],
  };
}

function unnestType(index: number): string {
  const types = [
    "text[]", "text[]", "text[]", "text[]", "text[]",
    "text[]", "text[]", "text[]", "text[]", "text[]",
    "text[]", "text[]", "text[]", "timestamptz[]", "text[]",
    "integer[]", "integer[]", "double precision[]",
    "integer[]", "double precision[]", "double precision[]",
    "double precision[]", "double precision[]", "double precision[]",
    "text[]", "text[]", "text[]",
    "double precision[]", "double precision[]", "double precision[]",
    "double precision[]", "double precision[]", "double precision[]",
    "integer[]", "text[]", "text[]", "bigint[]",
  ];
  return types[index]!;
}

export interface BulkUpsertOutcome {
  upserted: number;
  failed: number;
  /** Batches (or rows) that fell back to the per-row path. */
  fallbacks: number;
}

async function runPerRowFallback<T>(
  rows: T[],
  fallbackRow: (row: T) => Promise<void>,
): Promise<{ upserted: number; failed: number }> {
  let upserted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await fallbackRow(row);
      upserted++;
    } catch (error) {
      logger.error("[BULK_UPSERT] Per-row fallback failed:", error);
      failed++;
    }
  }
  return { upserted, failed };
}

export interface BulkBatchExecutor {
  executeBulk: (sql: string, params: unknown[]) => Promise<number>;
  findLease?: () => Promise<{ leaseId: string; fencingToken: bigint | string | number; status: string; leaseExpiresAt: Date } | null>;
}

export interface MetaFenceExpectation {
  leaseId: string;
  fencingToken: string;
}

const defaultExecutor: BulkBatchExecutor = {
  executeBulk: async (sql: string, params: unknown[]) =>
    (prisma as any).$executeRawUnsafe(sql, ...params) as Promise<number>,
};

/**
 * Execute one sanitized batch: bulk statement first, per-row fallback on any
 * failure. For Meta batches, an affected-count mismatch re-checks the lease:
 * a lost lease throws (zero writes by construction); otherwise the batch
 * falls back row-by-row (idempotent under the conflict key).
 */
export async function executeBulkBatch<T>(
  batch: BulkMetricRow[],
  build: (rows: BulkMetricRow[]) => { sql: string; params: unknown[] },
  fallbackRow: (row: T, sanitized: BulkMetricRow) => Promise<void>,
  originals: T[],
  executor: BulkBatchExecutor = defaultExecutor,
  kind: "generic" | "meta" = "generic",
  expectFence?: MetaFenceExpectation,
): Promise<BulkUpsertOutcome> {
  if (batch.length === 0) return { upserted: 0, failed: 0, fallbacks: 0 };
  let affected: number;
  try {
    const { sql, params } = build(batch);
    affected = await executor.executeBulk(sql, params);
  } catch (error) {
    logger.warn(`[BULK_UPSERT] ${kind} bulk batch failed; falling back to per-row`, error);
    const result = await runPerRowFallback(
      originals.map((row, index) => ({ row, sanitized: batch[index]! })),
      ({ row, sanitized }) => fallbackRow(row, sanitized),
    );
    return { ...result, fallbacks: 1 };
  }
  if (kind === "meta" && affected !== batch.length && executor.findLease) {
    const lease = await executor.findLease();
    const now = new Date();
    const fenced =
      lease != null &&
      lease.status === "running" &&
      lease.leaseExpiresAt > now &&
      (expectFence == null ||
        (lease.leaseId === expectFence.leaseId &&
          BigInt(lease.fencingToken).toString() === BigInt(expectFence.fencingToken).toString()));
    if (!fenced) {
      throw new Error("[BULK_UPSERT] Meta lease lost during bulk batch. Zero writes applied.");
    }
    logger.warn("[BULK_UPSERT] Meta bulk affected-count mismatch with live lease; falling back to per-row");
    const result = await runPerRowFallback(
      originals.map((row, index) => ({ row, sanitized: batch[index]! })),
      ({ row, sanitized }) => fallbackRow(row, sanitized),
    );
    return { ...result, fallbacks: 1 };
  }
  return { upserted: batch.length, failed: 0, fallbacks: 0 };
}

export function defaultBulkExecutor(): BulkBatchExecutor {
  return defaultExecutor;
}

// ── Shared flush helpers (flag-gated loop wiring) ───────────────────────────

function toBulkInput(payload: CampaignMetricPayload): BulkRowInput {
  return {
    workspaceId: payload.workspaceId,
    connectionId: payload.connectionId,
    platform: payload.platform,
    accountId: payload.accountId,
    accountName: payload.accountName,
    level: payload.level,
    entityId: payload.entityId,
    campaignId: payload.campaignId,
    campaignName: payload.campaignName,
    adsetId: payload.adsetId,
    adsetName: payload.adsetName,
    adId: payload.adId,
    date: payload.date,
    breakdownHash: payload.breakdownHash,
    impressions: payload.impressions,
    clicks: payload.clicks,
    spend: payload.spend,
    reach: payload.reach,
    cpc: payload.cpc,
    ctr: payload.ctr,
    conversions: payload.conversions,
    revenue: payload.revenue,
    roas: payload.roas,
    currency: payload.currency,
    rawData: payload.rawData,
    shopeeBroadOrders: payload.shopeeBroadOrders,
    shopeeBroadUnits: payload.shopeeBroadUnits,
    shopeeBroadGmv: payload.shopeeBroadGmv,
    shopeeDirectOrders: payload.shopeeDirectOrders,
    shopeeDirectUnits: payload.shopeeDirectUnits,
    shopeeDirectGmv: payload.shopeeDirectGmv,
    shopeeKeywordSettingsCount: payload.shopeeKeywordSettingsCount,
    syncJobId: payload.syncJobId,
    lockScope: payload.lease?.scope,
    fencingToken: payload.lease?.fencingToken,
  };
}

export interface FlushGenericOpts {
  fallbackRow: (payload: CampaignMetricPayload) => Promise<void>;
  onHeartbeat?: () => Promise<void>;
  maxRows?: number;
  maxBytes?: number;
  executor?: BulkBatchExecutor;
}

/**
 * Flush validated generic payloads through the bulk path with per-row
 * fallback. Poison rows (unsanitizable) go straight to the per-row fallback,
 * which applies the existing failure accounting.
 */
export async function flushGenericPayloadBatches(
  payloads: CampaignMetricPayload[],
  opts: FlushGenericOpts,
): Promise<BulkUpsertOutcome> {
  const fallbackPairs: CampaignMetricPayload[] = [];
  const sanitized: BulkMetricRow[] = [];
  const owners: CampaignMetricPayload[] = [];
  for (const payload of payloads) {
    try {
      sanitized.push(sanitizeBulkRow(toBulkInput(payload)));
      owners.push(payload);
    } catch {
      fallbackPairs.push(payload);
    }
  }
  let upserted = 0;
  let failed = 0;
  let fallbacks = 0;
  if (fallbackPairs.length > 0) {
    const result = await runPerRowFallback(fallbackPairs, (row) => opts.fallbackRow(row));
    upserted += result.upserted;
    failed += result.failed;
    fallbacks += 1;
  }
  const batches = splitBulkBatches(
    sanitized.map((row, index) => ({ row, owner: owners[index]! })),
    ({ row }) => estimateBulkRowBytes(row),
    opts.maxRows ?? bulkUpsertMaxRows(),
    opts.maxBytes ?? bulkUpsertMaxBytes(),
  );
  const executor = opts.executor ?? defaultExecutor;
  for (const batch of batches) {
    if (batch.oversized) {
      const result = await runPerRowFallback(batch.rows.map(({ owner }) => owner), (row) => opts.fallbackRow(row));
      upserted += result.upserted;
      failed += result.failed;
      fallbacks += 1;
      continue;
    }
    if (opts.onHeartbeat) {
      try {
        await opts.onHeartbeat();
      } catch (error) {
        // A lost lease must stop writes: the per-row fallback does not assert
        // ownership, so remaining rows are counted failed without writing —
        // exactly like the per-row loops abort on a failed heartbeat.
        logger.warn("[BULK_UPSERT] Lease heartbeat lost; aborting remaining batches without writing", error);
        const remaining = batches.slice(batches.indexOf(batch)).reduce((sum, b) => sum + b.rows.length, 0);
        failed += remaining;
        fallbacks += 1;
        break;
      }
    }
    const outcome = await executeBulkBatch(
      batch.rows.map(({ row }) => row),
      (rows) => buildGenericBulkUpsert(rows),
      (owner) => opts.fallbackRow(owner),
      batch.rows.map(({ owner }) => owner),
      executor,
      "generic",
    );
    upserted += outcome.upserted;
    failed += outcome.failed;
    fallbacks += outcome.fallbacks;
  }
  return { upserted, failed, fallbacks };
}

export interface MetaFlushRow {
  workspaceId: string;
  connectionId: string;
  accountId: string;
  accountName?: string;
  level: string;
  entityId: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  adId?: string;
  adName?: string | null;
  date: Date;
  breakdownHash: string;
  metrics: {
    impressions: number;
    clicks: number;
    spend: number;
    reach: number;
    cpc: number;
    ctr: number;
    conversions: number;
    revenue: number;
    roas: number;
    currency?: string;
    rawData?: unknown;
  };
  syncJobId: string;
}

export interface FlushMetaOpts {
  lease: MetaBulkLease;
  fallbackRow: (row: MetaFlushRow) => Promise<void>;
  maxRows?: number;
  maxBytes?: number;
  executor?: BulkBatchExecutor;
}

/** Flush validated Meta rows through the fenced bulk path with fallback. */
export async function flushMetaPayloadBatches(
  rows: MetaFlushRow[],
  opts: FlushMetaOpts,
): Promise<BulkUpsertOutcome> {
  const fallbackPairs: MetaFlushRow[] = [];
  const sanitized: BulkMetricRow[] = [];
  const owners: MetaFlushRow[] = [];
  for (const row of rows) {
    try {
      sanitized.push(sanitizeBulkRow({
        workspaceId: row.workspaceId,
        connectionId: row.connectionId,
        platform: "meta_ads",
        accountId: row.accountId,
        accountName: row.accountName,
        level: row.level,
        entityId: row.entityId,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        adsetId: row.adsetId,
        adsetName: row.adsetName,
        adId: row.adId,
        date: row.date,
        breakdownHash: row.breakdownHash,
        impressions: row.metrics.impressions,
        clicks: row.metrics.clicks,
        spend: row.metrics.spend,
        reach: row.metrics.reach,
        cpc: row.metrics.cpc,
        ctr: row.metrics.ctr,
        conversions: row.metrics.conversions,
        revenue: row.metrics.revenue,
        roas: row.metrics.roas,
        currency: row.metrics.currency,
        rawData: row.metrics.rawData,
        adName: row.adName,
        syncJobId: row.syncJobId,
        lockScope: opts.lease.scope,
        fencingToken: opts.lease.fencingToken,
      }));
      owners.push(row);
    } catch {
      fallbackPairs.push(row);
    }
  }
  let upserted = 0;
  let failed = 0;
  let fallbacks = 0;
  if (fallbackPairs.length > 0) {
    const result = await runPerRowFallback(fallbackPairs, (row) => opts.fallbackRow(row));
    upserted += result.upserted;
    failed += result.failed;
    fallbacks += 1;
  }
  const batches = splitBulkBatches(
    sanitized.map((row, index) => ({ row, owner: owners[index]! })),
    ({ row }) => estimateBulkRowBytes(row),
    opts.maxRows ?? bulkUpsertMaxRows(),
    opts.maxBytes ?? bulkUpsertMaxBytes(),
  );
  const executor: BulkBatchExecutor = opts.executor ?? {
    ...defaultExecutor,
    findLease: async () => {
      const lock = await (prisma as any).syncLock.findUnique({
        where: { scope: opts.lease.scope },
        select: { leaseId: true, fencingToken: true, status: true, leaseExpiresAt: true },
      });
      return lock;
    },
  };
  for (const batch of batches) {
    if (batch.oversized) {
      const result = await runPerRowFallback(batch.rows.map(({ owner }) => owner), (row) => opts.fallbackRow(row));
      upserted += result.upserted;
      failed += result.failed;
      fallbacks += 1;
      continue;
    }
    const outcome = await executeBulkBatch(
      batch.rows.map(({ row }) => row),
      (bulkRows) => buildMetaBulkUpsert(bulkRows, opts.lease),
      (owner) => opts.fallbackRow(owner),
      batch.rows.map(({ owner }) => owner),
      executor,
      "meta",
      { leaseId: opts.lease.leaseId, fencingToken: opts.lease.fencingToken.toString() },
    );
    upserted += outcome.upserted;
    failed += outcome.failed;
    fallbacks += outcome.fallbacks;
  }
  return { upserted, failed, fallbacks };
}
