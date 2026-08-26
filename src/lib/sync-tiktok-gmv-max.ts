/**
 * TikTok GMV Max Warehouse Sync Worker (Sandbox Route)
 * 
 * Ingests store and product-level GMV Max performance metrics into
 * the dedicated TikTokGmvMaxMetric table.
 * 
 * Isolation Guarantees:
 * - Never writes to CampaignMetric.
 * - GMV Max ROI (1-day blended attribution) remains strictly isolated from standard ROAS.
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { encrypt, safeDecrypt } from "@/lib/encryption";
import { getValidOAuthToken } from "@/lib/oauth-framework/token-refresh";
import {
  tiktokGmvMaxClient,
} from "@/lib/tiktok-gmv-max";
import {
  heartbeatConnectionSyncLease,
  type ConnectionLease,
} from "@/lib/connection-sync-lease";
import { recordPayloadSchemaDiscovery } from "@/lib/payload-schema-discovery";

export interface TikTokGmvMaxSyncResult {
  success: boolean;
  rowsIngested: number;
  error?: string;
  children?: Array<{
    id: string;
    kind: string;
    ok: boolean;
    rowsIngested?: number;
    error?: string;
  }>;
}

export interface SyncTikTokGmvMaxOptions {
  connectionId: string;
  workspaceId: string;
  userPlan: string;
  since?: string;
  until?: string;
  lease?: ConnectionLease;
}

export async function syncTikTokGmvMaxWarehouseMetrics(
  opts: SyncTikTokGmvMaxOptions
): Promise<TikTokGmvMaxSyncResult> {
  const { connectionId, workspaceId, lease } = opts;

  const conn = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: { id: true, credentials: true, remoteAccountId: true },
  });

  if (!conn) {
    return { success: false, rowsIngested: 0, error: "Connection not found" };
  }

  let credentials: Record<string, unknown> = {};
  try {
    credentials = JSON.parse(safeDecrypt(conn.credentials)) as Record<string, unknown>;
  } catch {
    return { success: false, rowsIngested: 0, error: "Failed to decrypt credentials" };
  }

  let accessToken: string;
  try {
    accessToken = await getValidOAuthToken({
      id: connectionId,
      credentials: encrypt(JSON.stringify(credentials)),
      provider: "tiktok_business",
    });
  } catch (error) {
    return {
      success: false,
      rowsIngested: 0,
      error: error instanceof Error ? error.message : "Failed to obtain valid TikTok token",
    };
  }

  const extraFields = (credentials.extraFields as Record<string, unknown>) || {};
  let advertiserIds =
    (extraFields.advertiserIds as string[]) ||
    (credentials.advertiserIds as string[]) ||
    [];

  if (!advertiserIds.length && conn.remoteAccountId) {
    advertiserIds = [conn.remoteAccountId.trim()];
  }

  if (!advertiserIds.length) {
    return { success: false, rowsIngested: 0, error: "No TikTok advertiser ID found on connection" };
  }

  const storeIds: string[] =
    (extraFields.storeIds as string[]) ||
    (credentials.storeIds as string[]) ||
    [];

  const isSandbox = credentials.sandbox === true;
  const targetStoreIds = storeIds.length > 0 ? storeIds : (isSandbox ? ["sandbox_store_1"] : []);

  if (!targetStoreIds.length) {
    return { success: false, rowsIngested: 0, error: "No TikTok store IDs configured for GMV Max sync" };
  }

  const endDate = opts.until || new Date().toISOString().split("T")[0];
  const startDate =
    opts.since ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const syncJobId = `tiktok-gmv-max-${Date.now()}`;
  const children: Array<{
    id: string;
    kind: string;
    ok: boolean;
    rowsIngested?: number;
    error?: string;
  }> = [];
  let totalUpserted = 0;
  let recordedSchema = false;

  for (const advertiserId of advertiserIds) {
    for (const storeId of targetStoreIds) {
      const childId = `adv_${advertiserId}_store_${storeId}`;
      if (lease) {
        await heartbeatConnectionSyncLease(lease);
      }

      try {
        const productRows = await tiktokGmvMaxClient.getReport(
          accessToken,
          {
            advertiser_id: advertiserId,
            store_ids: [storeId],
            start_date: startDate,
            end_date: endDate,
            campaign_type: "PRODUCT",
          },
          isSandbox
        );

        let upserted = 0;
        let failed = 0;

        for (const row of productRows) {
          if (!recordedSchema) {
            recordedSchema = true;
            void recordPayloadSchemaDiscovery({
              workspaceId,
              connectionId,
              provider: "tiktok_gmv_max",
              sample: row,
            });
          }

          const dims = row.dimensions || {};
          const metrics = row.metrics || {};

          const dateStr = String(dims.stat_time_day ?? "");
          if (!dateStr) {
            failed++;
            continue;
          }
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) {
            failed++;
            continue;
          }

          const campaignId = String(dims.campaign_id ?? "");
          const campaignName = String(dims.campaign_name ?? "");
          const itemId = String(dims.item_id ?? "");
          const itemName = dims.item_name ? String(dims.item_name) : null;
          const itemGroupId = String(dims.item_group_id ?? "");
          const itemGroupName = dims.item_group_name ? String(dims.item_group_name) : null;
          const storeName = dims.store_name ? String(dims.store_name) : null;

          const gmvMaxCost = Number(metrics.gmv_max_cost ?? 0) || 0;
          const gmvMaxGrossRevenue = Number(metrics.gmv_max_gross_revenue ?? 0) || 0;
          const gmvMaxOrders = Math.floor(Number(metrics.gmv_max_orders ?? 0)) || 0;
          const gmvMaxRoi = Number(metrics.gmv_max_roi ?? 0) || 0;

          await prisma.tikTokGmvMaxMetric.upsert({
            where: {
              connectionId_storeId_campaignId_itemId_liveRoomId_date: {
                connectionId,
                storeId,
                campaignId,
                itemId,
                liveRoomId: "",
                date,
              },
            },
            update: {
              advertiserId,
              storeName,
              campaignType: "PRODUCT",
              campaignName,
              itemName,
              itemGroupId,
              itemGroupName,
              gmvMaxCost,
              gmvMaxGrossRevenue,
              gmvMaxOrders,
              gmvMaxRoi,
              currency: "USD",
              rawData: JSON.stringify(row),
              syncJobId,
              ingestedAt: new Date(),
            },
            create: {
              workspaceId,
              connectionId,
              advertiserId,
              storeId,
              storeName,
              date,
              campaignType: "PRODUCT",
              campaignId,
              campaignName,
              itemId,
              itemName,
              itemGroupId,
              itemGroupName,
              liveRoomId: "",
              gmvMaxCost,
              gmvMaxGrossRevenue,
              gmvMaxOrders,
              gmvMaxRoi,
              currency: "USD",
              rawData: JSON.stringify(row),
              syncJobId,
              ingestedAt: new Date(),
            },
          });

          upserted++;
        }

        totalUpserted += upserted;
        children.push({
          id: childId,
          kind: "store",
          ok: failed === 0,
          rowsIngested: upserted,
          error: failed > 0 ? `${failed} row(s) could not be written` : undefined,
        });
      } catch (err) {
        logger.error(`[syncTikTokGmvMax] Failed for ${childId}:`, err);
        const msg = err instanceof Error ? err.message : "GMV Max sync failed";
        children.push({
          id: childId,
          kind: "store",
          ok: false,
          error: msg,
        });
      }
    }
  }

  const allOk = children.length > 0 && children.every((c) => c.ok);
  const firstError = children.find((c) => !c.ok)?.error;

  logger.info("[syncTikTokGmvMax] Complete outcome", {
    connectionId,
    success: allOk,
    rowsIngested: totalUpserted,
  });

  return {
    success: allOk,
    rowsIngested: totalUpserted,
    error: allOk ? undefined : firstError,
    children,
  };
}
