/**
 * Aggregate Shopee / Lazada order activity into CampaignMetric (daily rollup rows)
 * for the internal warehouse & Data Explorer.
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getValidShopeeCreds, shopeeDataClient } from "@/lib/shopee";
import { upsertCampaignMetric } from "@/lib/ad-platform-ingest";
import { refreshConnectionLastDataThrough } from "@/lib/connection-data-through";
import { recordPayloadSchemaDiscovery } from "@/lib/payload-schema-discovery";
import { heartbeatConnectionSyncLease, type ConnectionLease } from "@/lib/connection-sync-lease";
import { safeDecrypt } from "@/lib/encryption";
import { parseConnectionCredentialsJson } from "@/lib/parse-connection-credentials";
import { lazadaOrdersGet } from "@/lib/lazada";

export interface MarketplaceSyncResult {
  success: boolean;
  rowsIngested: number;
  error?: string;
}

function parseYmd(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}

function dayKeyFromUnixSeconds(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

/** Pull Shopee orders in range, aggregate by UTC calendar day → CampaignMetric. */
export async function syncShopeeWarehouseMetrics(opts: {
  connectionId: string;
  workspaceId: string;
  userPlan: string;
  since: string;
  until: string;
  lease?: ConnectionLease;
}): Promise<MarketplaceSyncResult> {
  const { connectionId, workspaceId } = opts;
  const { since, until } = opts;

  const rangeStart = parseYmd(since).getTime() / 1000;
  const rangeEnd = Math.floor(parseYmd(until).getTime() / 1000) + 86400 - 1;

  try {
    const creds = await getValidShopeeCreds(connectionId);
    const apiOpts = {
      accessToken: creds.access_token,
      shopId: creds.shop_id,
      sandbox: creds.sandbox === true,
    };

    const daily = new Map<string, { revenue: number; orders: number }>();
    let cursor = "";
    let recordedSchema = false;

    for (;;) {
      if (opts.lease) {
        await heartbeatConnectionSyncLease(opts.lease);
      }
      const listData = await shopeeDataClient.getOrderList(
        apiOpts,
        rangeStart,
        rangeEnd,
        cursor,
        100,
        "ALL",
      );
      const rawList = listData.response?.order_list ?? listData.order_list ?? [];
      if (!rawList.length) break;

      const orderSnList = rawList.map((o: { order_sn?: string }) => o.order_sn).filter(Boolean) as string[];

      const chunks: string[][] = [];
      for (let i = 0; i < orderSnList.length; i += 50) {
        chunks.push(orderSnList.slice(i, i + 50));
      }

      for (const sns of chunks) {
        const detailData = await shopeeDataClient.getOrderDetail(apiOpts, sns, [
          "order_status",
          "total_amount",
          "currency",
          "create_time",
        ]);
        const orders =
          detailData.response?.order_list ?? detailData.order_list ?? [];
        for (const o of orders) {
          if (!recordedSchema) {
            recordedSchema = true;
            void recordPayloadSchemaDiscovery({
              workspaceId,
              connectionId,
              provider: "shopee",
              sample: o,
            });
          }
          const ct = o.create_time as number | undefined;
          if (ct == null) continue;
          if (ct < rangeStart || ct > rangeEnd) continue;
          const day = dayKeyFromUnixSeconds(ct);
          const amt = Number(o.total_amount ?? 0) || 0;
          const cur = daily.get(day) ?? { revenue: 0, orders: 0 };
          cur.orders += 1;
          cur.revenue += amt;
          daily.set(day, cur);
        }
      }

      const next = listData.response?.next_cursor ?? listData.next_cursor ?? "";
      if (!next || next === cursor) break;
      cursor = next;
    }

    const accountId = String(creds.shop_id);
    const jobId = `shopee-warehouse-${Date.now()}`;
    let upserted = 0;

    for (const [dayStr, agg] of daily) {
      const d = parseYmd(dayStr);
      await upsertCampaignMetric({
        workspaceId,
        connectionId,
        platform: "shopee",
        accountId,
        accountName: `Shopee shop ${accountId}`,
        level: "campaign",
        entityId: `shopee-orders-daily`,
        campaignId: "shopee-orders-daily",
        campaignName: "Shopee orders (daily rollup)",
        adsetId: "",
        adsetName: undefined,
        date: d,
        breakdownHash: "day_orders",
        impressions: 0,
        clicks: 0,
        spend: 0,
        reach: 0,
        cpc: 0,
        ctr: 0,
        conversions: agg.orders,
        revenue: agg.revenue,
        roas: agg.orders > 0 ? agg.revenue / agg.orders : 0,
        currency: undefined,
        rawData: { source: "shopee_order_rollup", day: dayStr },
        syncJobId: jobId,
        lease: opts.lease,
      });
      upserted += 1;
    }

    await prisma.connection.update({
      where: { id: connectionId },
      data: { lastSyncAt: new Date() },
    });
    await refreshConnectionLastDataThrough(workspaceId, connectionId);

    logger.info(`[syncShopeeWarehouse] ${upserted} day rows for ${connectionId}`);
    return { success: true, rowsIngested: upserted };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Shopee warehouse sync failed";
    logger.error("[syncShopeeWarehouse]", e);
    return { success: false, rowsIngested: 0, error: msg };
  }
}

/** Lazada orders → daily rollup (best-effort; API shape varies by site). */
export async function syncLazadaWarehouseMetrics(opts: {
  connectionId: string;
  workspaceId: string;
  userPlan: string;
  since: string;
  until: string;
  lease?: ConnectionLease;
}): Promise<MarketplaceSyncResult> {
  const { connectionId, workspaceId } = opts;
  const range = { since: opts.since, until: opts.until };
  const since = range.since;
  const until = range.until;

  try {
    const conn = await prisma.connection.findFirst({
      where: { id: connectionId, workspaceId, provider: "lazada" },
      select: { credentials: true },
    });
    if (!conn) {
      return { success: false, rowsIngested: 0, error: "Lazada connection not found" };
    }
    const parsed = parseConnectionCredentialsJson(safeDecrypt(conn.credentials)) as Record<string, unknown>;
    const accessToken = (parsed.accessToken as string) || "";
    if (!accessToken) {
      return { success: false, rowsIngested: 0, error: "Missing Lazada access token — reconnect Lazada." };
    }

    const extra = (parsed.extraFields as Record<string, unknown> | undefined) ?? {};
    const sellerId =
      (parsed.sellerId as string) ||
      (extra.sellerId as string) ||
      (extra.accountId as string) ||
      "";
    const accountId = sellerId || "lazada-seller";

    /** Lazada expects "YYYY-MM-DD HH:mm:ss" in local/seller timezone; UTC midnight is accepted by API in practice. */
    const createdAfter = `${since} 00:00:00`;
    const createdBefore = `${until} 23:59:59`;

    const daily = new Map<string, { revenue: number; orders: number }>();
    let offset = 0;
    const pageSize = 100;

    for (;;) {
      if (opts.lease) {
        await heartbeatConnectionSyncLease(opts.lease);
      }
      const page = await lazadaOrdersGet(accessToken, {
        created_after: createdAfter,
        created_before: createdBefore,
        offset: String(offset),
        limit: String(pageSize),
      });
      const orders = extractLazadaOrders(page);
      if (!orders.length) break;

      for (const o of orders) {
        const created =
          o.created_at ??
          o.create_time ??
          o.created_time ??
          o.order_created_time;
        const ts =
          typeof created === "number"
            ? created
            : typeof created === "string"
              ? Date.parse(created) / 1000
              : null;
        if (ts == null || Number.isNaN(ts)) continue;
        const day = dayKeyFromUnixSeconds(ts);
        if (day < since || day > until) continue;

        const price =
          num(o.price) ||
          num(o.total_amount) ||
          num(o.grand_total) ||
          num(o.order_amount) ||
          0;

        const cur = daily.get(day) ?? { revenue: 0, orders: 0 };
        cur.orders += 1;
        cur.revenue += price;
        daily.set(day, cur);
      }

      if (orders.length < pageSize) break;
      offset += pageSize;
      if (offset > 5000) break;
    }

    const jobId = `lazada-warehouse-${Date.now()}`;
    let upserted = 0;
    for (const [dayStr, agg] of daily) {
      const d = parseYmd(dayStr);
      await upsertCampaignMetric({
        workspaceId,
        connectionId,
        platform: "lazada",
        accountId,
        accountName: sellerId ? `Lazada seller ${sellerId}` : "Lazada",
        level: "campaign",
        entityId: "lazada-orders-daily",
        campaignId: "lazada-orders-daily",
        campaignName: "Lazada orders (daily rollup)",
        adsetId: "",
        adsetName: undefined,
        date: d,
        breakdownHash: "day_orders",
        impressions: 0,
        clicks: 0,
        spend: 0,
        reach: 0,
        cpc: 0,
        ctr: 0,
        conversions: agg.orders,
        revenue: agg.revenue,
        roas: agg.orders > 0 ? agg.revenue / agg.orders : 0,
        currency: undefined,
        rawData: { source: "lazada_order_rollup", day: dayStr },
        syncJobId: jobId,
        lease: opts.lease,
      });
      upserted += 1;
    }

    await prisma.connection.update({
      where: { id: connectionId },
      data: { lastSyncAt: new Date() },
    });
    await refreshConnectionLastDataThrough(workspaceId, connectionId);

    return { success: true, rowsIngested: upserted };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Lazada warehouse sync failed";
    logger.error("[syncLazadaWarehouse]", e);
    return { success: false, rowsIngested: 0, error: msg };
  }
}

function num(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function extractLazadaOrders(page: unknown): Record<string, unknown>[] {
  if (!page || typeof page !== "object") return [];
  const p = page as Record<string, unknown>;
  const data = p.data;
  if (Array.isArray(data)) {
    return data.filter((x): x is Record<string, unknown> => x != null && typeof x === "object");
  }
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const list =
    (d.orders as unknown[]) ||
    (d.order_list as unknown[]) ||
    ((d as { data?: unknown[] }).data as unknown[] | undefined);
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is Record<string, unknown> => x != null && typeof x === "object");
}
