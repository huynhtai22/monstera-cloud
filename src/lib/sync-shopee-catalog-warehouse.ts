/**
 * Shopee catalog discovery for the warehouse. Catalog identity is deliberately
 * stored outside CampaignMetric so no-performance sandbox campaigns never turn
 * into fake zero-performance records.
 */
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getValidShopeeCreds, shopeeAdsClient, shopeeDataClient, type ShopeeApiOptions } from "@/lib/shopee";

const PRODUCT_WATERMARK_OVERLAP_SECONDS = 5 * 60;

export type ShopeeCatalogSyncResult = {
  success: boolean;
  campaignsSuccess: boolean;
  productsSuccess: boolean;
  campaignsWritten: number;
  productsWritten: number;
  campaignsError?: string;
  productsError?: string;
  error?: string;
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function responseOf(value: unknown): RecordValue {
  const root = record(value) ?? {};
  return record(root.response) ?? root;
}

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result || null;
}

function dateFromUnix(value: unknown): Date | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

function environmentFor(sandbox: boolean): "sandbox" | "production" {
  return sandbox ? "sandbox" : "production";
}

export function shopeeProductUpdateWindow(
  productWatermarkAt: Date | null | undefined,
  now = new Date(),
): { updateTimeFrom?: number; updateTimeTo: number } {
  return {
    // An undefined start deliberately means full discovery for a new connection.
    updateTimeFrom: productWatermarkAt
      ? Math.max(0, Math.floor(productWatermarkAt.getTime() / 1000) - PRODUCT_WATERMARK_OVERLAP_SECONDS)
      : undefined,
    updateTimeTo: Math.floor(now.getTime() / 1000),
  };
}

function sanitizeProviderError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/\b(access[_-]?token|refresh[_-]?token|signature|sign|partner[_-]?key)\b(?:=|\s+)\S+/gi, "$1=[redacted]")
    .replace(/bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .slice(0, 1200);
}

function errorCategory(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("permission") || m.includes("unauthorized") || m.includes("error_auth")) return "authorization";
  if (m.includes("error_param") || m.includes("validation")) return "validation";
  if (m.includes("429") || m.includes("rate limit")) return "rate_limit";
  if (m.includes("network") || m.includes("timeout") || m.includes("5")) return "transport";
  return "provider";
}

async function writeRun(input: {
  workspaceId: string;
  connectionId: string;
  environment: string;
  shopId: string;
  endpoint: string;
  status: "success" | "error";
  rowsReceived?: number;
  rowsWritten?: number;
  providerRequestId?: string | null;
  error?: unknown;
  startedAt: Date;
}): Promise<void> {
  const error = input.error ? sanitizeProviderError(input.error) : null;
  try {
    await (prisma as any).providerSyncRun.create({
      data: {
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        provider: "shopee",
        environment: input.environment,
        shopId: input.shopId,
        endpoint: input.endpoint,
        status: input.status,
        rowsReceived: input.rowsReceived ?? 0,
        rowsWritten: input.rowsWritten ?? 0,
        providerRequestId: input.providerRequestId ?? null,
        errorCategory: error ? errorCategory(error) : null,
        errorMessage: error,
        startedAt: input.startedAt,
        completedAt: new Date(),
      },
    });
  } catch (writeError) {
    // Diagnostics must never hide the actual provider/configuration outcome.
    // This also leaves the original error actionable if a preview database has
    // not yet applied the repository-managed catalog migration.
    logger.warn("[syncShopeeCatalogWarehouse] Could not persist source sync activity", {
      connectionId: input.connectionId,
      endpoint: input.endpoint,
      error: sanitizeProviderError(writeError),
    });
  }
}

async function syncCampaigns(input: {
  workspaceId: string;
  connectionId: string;
  environment: string;
  shopId: string;
  api: ShopeeApiOptions;
}): Promise<number> {
  const startedAt = new Date();
  const endpoint = "v2.ads.get_product_level_campaign_id_list";
  let campaignListLogged = false;
  try {
    const pages = await shopeeAdsClient.getAllProductLevelCampaignIds(input.api);
    const discovered = pages.flatMap((page) => {
      const payload = responseOf(page);
      return Array.isArray(payload.campaign_list) ? payload.campaign_list : [];
    }).flatMap((value) => record(value) ? [record(value)!] : []);
    const firstPayload = responseOf(pages[0]);
    const region = text(firstPayload.region) ?? "unknown";
    const requestId = text((record(pages.at(-1)) ?? {}).request_id);
    const ids = discovered.map((campaign) => text(campaign.campaign_id)).filter((id): id is string => Boolean(id));
    const settingEndpoint = "v2.ads.get_product_level_campaign_setting_info";
    campaignListLogged = true;
    let settings: unknown[] = [];
    try {
      settings = ids.length ? await shopeeAdsClient.getProductLevelCampaignSettings(input.api, ids) : [];
    } catch (error) {
      // The list endpoint is the required identity source. Settings enriches the
      // row, but must not discard a discovered sandbox campaign when its optional
      // metadata request is unavailable.
      await writeRun({ ...input, endpoint: settingEndpoint, status: "error", error, startedAt: new Date() });
    }
    const settingsById = new Map<string, RecordValue>();
    for (const page of settings) {
      for (const item of responseOf(page).campaign_list as unknown[] ?? []) {
        const setting = record(item);
        const id = setting && text(setting.campaign_id);
        if (id) settingsById.set(id, setting);
      }
    }
    let written = 0;
    for (const campaign of discovered) {
      const externalCampaignId = text(campaign.campaign_id);
      if (!externalCampaignId) continue;
      const setting = settingsById.get(externalCampaignId) ?? {};
      const common = record(setting.common_info) ?? {};
      const manual = record(setting.manual_bidding_info) ?? {};
      const auto = record(setting.auto_bidding_info) ?? {};
      const biddingStrategy = text(manual.bidding_method ?? manual.bidding_strategy ?? auto.bidding_method ?? auto.bidding_strategy);
      await (prisma as any).shopeeCampaign.upsert({
        where: { connectionId_environment_shopId_externalCampaignId: {
          connectionId: input.connectionId, environment: input.environment, shopId: input.shopId, externalCampaignId,
        } },
        create: {
          workspaceId: input.workspaceId, connectionId: input.connectionId, environment: input.environment,
          shopId: input.shopId, region, externalCampaignId,
          adType: text(campaign.ad_type) ?? "unknown", biddingStrategy,
          campaignName: text(common.campaign_name), campaignStatus: text(common.campaign_status),
          sourceRequestId: requestId, syncedAt: new Date(),
        },
        update: {
          workspaceId: input.workspaceId, region, adType: text(campaign.ad_type) ?? "unknown", biddingStrategy,
          campaignName: text(common.campaign_name), campaignStatus: text(common.campaign_status),
          sourceRequestId: requestId, syncedAt: new Date(),
        },
      });
      written += 1;
    }
    await writeRun({
      ...input,
      endpoint,
      status: "success",
      rowsReceived: discovered.length,
      rowsWritten: written,
      providerRequestId: requestId,
      startedAt,
    });
    if (settings.length) {
      await writeRun({ ...input, endpoint: settingEndpoint, status: "success", rowsReceived: ids.length, providerRequestId: text((record(settings.at(-1)) ?? {}).request_id), startedAt: new Date() });
    }
    return written;
  } catch (error) {
    if (!campaignListLogged) await writeRun({ ...input, endpoint, status: "error", error, startedAt });
    throw error;
  }
}

async function syncProducts(input: {
  workspaceId: string;
  connectionId: string;
  environment: string;
  shopId: string;
  api: ShopeeApiOptions;
}): Promise<number> {
  const startedAt = new Date();
  const endpoint = "v2.product.get_item_list";
  try {
    const state = await (prisma as any).shopeeCatalogSyncState.findUnique({ where: { connectionId: input.connectionId } });
    const window = shopeeProductUpdateWindow(state?.productWatermarkAt ?? null);
    let offset = 0;
    let received = 0;
    let written = 0;
    let lastRequestId: string | null = null;
    for (;;) {
      const listPage = await shopeeDataClient.getItemList(input.api, offset, 100, "NORMAL", window.updateTimeFrom, window.updateTimeTo);
      const listPayload = responseOf(listPage);
      lastRequestId = text((record(listPage) ?? {}).request_id);
      const listed = Array.isArray(listPayload.item) ? listPayload.item : [];
      const items = listed.flatMap((value) => record(value) ? [record(value)!] : []);
      received += items.length;
      if (items.length === 0) break;
      const itemIds = items.map((item) => Number(item.item_id)).filter(Number.isSafeInteger);
      const details: unknown = itemIds.length ? await shopeeDataClient.getItemBaseInfo(input.api, itemIds) : {};
      const detailList: unknown[] = Array.isArray(responseOf(details).item_list)
        ? responseOf(details).item_list as unknown[]
        : [];
      const detailRows: RecordValue[] = detailList
        .flatMap((value: unknown) => record(value) ? [record(value)!] : []);
      const detailById = new Map(detailRows.map((item) => [text(item.item_id), item] as const));
      for (const listedItem of items) {
        const externalItemId = text(listedItem.item_id);
        if (!externalItemId) continue;
        const detail: RecordValue = detailById.get(externalItemId) ?? {};
        const region = text(detail.region ?? listPayload.region) ?? "unknown";
        await (prisma as any).shopeeProduct.upsert({
          where: { connectionId_environment_shopId_externalItemId: {
            connectionId: input.connectionId, environment: input.environment, shopId: input.shopId, externalItemId,
          } },
          create: {
            workspaceId: input.workspaceId, connectionId: input.connectionId, environment: input.environment,
            shopId: input.shopId, region, externalItemId, itemName: text(detail.item_name),
            itemStatus: text(listedItem.item_status ?? detail.item_status), sourceUpdatedAt: dateFromUnix(detail.update_time ?? listedItem.update_time),
            sourceRequestId: lastRequestId, syncedAt: new Date(),
          },
          update: {
            workspaceId: input.workspaceId, region, itemName: text(detail.item_name),
            itemStatus: text(listedItem.item_status ?? detail.item_status), sourceUpdatedAt: dateFromUnix(detail.update_time ?? listedItem.update_time),
            sourceRequestId: lastRequestId, syncedAt: new Date(),
          },
        });
        written += 1;
      }
      const hasNext = listPayload.has_next_page === true;
      if (!hasNext) break;
      offset += items.length;
      if (offset > 100_000) throw new Error("Shopee product pagination exceeded safe limit");
    }
    await (prisma as any).shopeeCatalogSyncState.upsert({
      where: { connectionId: input.connectionId }, create: { connectionId: input.connectionId, productWatermarkAt: new Date() },
      update: { productWatermarkAt: new Date() },
    });
    await writeRun({ ...input, endpoint, status: "success", rowsReceived: received, rowsWritten: written, providerRequestId: lastRequestId, startedAt });
    return written;
  } catch (error) {
    await writeRun({ ...input, endpoint, status: "error", error, startedAt });
    throw error;
  }
}

export async function syncShopeeCatalogWarehouse(input: {
  workspaceId: string;
  connectionId: string;
}): Promise<ShopeeCatalogSyncResult> {
  let campaignsWritten = 0;
  let productsWritten = 0;
  let campaignsError: string | undefined;
  let productsError: string | undefined;
  try {
    const creds = await getValidShopeeCreds(input.connectionId);
    const environment = environmentFor(creds.sandbox === true);
    const context = {
      ...input, environment, shopId: String(creds.shop_id),
      api: { accessToken: creds.access_token, shopId: creds.shop_id, sandbox: creds.sandbox === true },
    };
    // Keep the endpoint outcomes independent. A product-catalog failure must
    // not erase a successfully normalized campaign identity (and vice versa).
    try {
      campaignsWritten = await syncCampaigns(context);
    } catch (error) {
      campaignsError = sanitizeProviderError(error);
    }
    try {
      productsWritten = await syncProducts(context);
    } catch (error) {
      productsError = sanitizeProviderError(error);
    }
    const campaignsSuccess = !campaignsError;
    const productsSuccess = !productsError;
    const error = [campaignsError && `campaigns: ${campaignsError}`, productsError && `products: ${productsError}`]
      .filter(Boolean)
      .join(" | ") || undefined;
    return { success: campaignsSuccess && productsSuccess, campaignsSuccess, productsSuccess, campaignsWritten, productsWritten, campaignsError, productsError, error };
  } catch (error) {
    const message = sanitizeProviderError(error);
    return {
      success: false,
      campaignsSuccess: false,
      productsSuccess: false,
      campaignsWritten,
      productsWritten,
      campaignsError: message,
      productsError: message,
      error: message,
    };
  }
}
