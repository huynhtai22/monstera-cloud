/**
 * Internal sync connection library - extracts data from ad platforms to CampaignMetric
 * Called directly from pipeline run (no HTTP overhead, no auth issues)
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getValidOAuthToken } from "@/lib/oauth-framework/token-refresh";
import { encrypt } from "@/lib/encryption";
import {
  getPlanLimits,
  clampGoogleAdsDatePeriodForPlan,
} from "@/lib/plan-config";
import {
  syncShopeeWarehouseMetrics,
  syncLazadaWarehouseMetrics,
} from "@/lib/sync-marketplace-warehouse";

// Meta imports
import { ingestMetaRows } from "@/lib/meta-ingest";
import { metaReportClient, META_DEFAULT_FIELDS } from "@/lib/meta-ads";
import {
  acquireMetaSyncLock,
  releaseMetaSyncLock,
} from "@/lib/meta-sync-lock";

// Google imports
import { googleAdsReportClient } from "@/lib/google-ads";
import { ingestGoogleAdsRows } from "@/lib/ad-platform-ingest";

// TikTok imports
import { tiktokReportClient } from "@/lib/tiktok-business";
import { ingestTiktokRows } from "@/lib/ad-platform-ingest";

export interface SyncOptions {
  connectionId: string;
  provider: string;
  credentials: any;
  workspaceId: string;
  /**
   * When set together, Google Ads / TikTok / marketplaces use this window (\"free rewind\" — not clamped).
   * When omitted, Google uses a plan-aware preset window; TikTok uses last 30 days; Shopee/Lazada use a rolling window.
   */
  since?: string;
  until?: string;
  /** Used for marketplace defaults and any remaining plan-based behaviors. */
  userPlan?: string;
}

interface SyncResult {
  success: boolean;
  rowsIngested: number;
  error?: string;
}

export async function syncConnectionData(opts: SyncOptions): Promise<SyncResult> {
  const { connectionId, provider, credentials, workspaceId } = opts;
  const plan = opts.userPlan ?? "free";

  logger.info(`[syncConnectionData] Starting sync for ${provider} connection ${connectionId} in workspace ${workspaceId}`);
  logger.info(`[syncConnectionData] Credentials keys:`, Object.keys(credentials || {}));

  try {
    if (provider === "meta_ads") {
      return await syncMetaAds({ connectionId, credentials, workspaceId });
    } else if (provider === "google_ads") {
      return await syncGoogleAds({
        connectionId,
        credentials,
        workspaceId,
        since: opts.since,
        until: opts.until,
        userPlan: plan,
      });
    } else if (provider === "tiktok_business") {
      return await syncTikTok({
        connectionId,
        credentials,
        workspaceId,
        since: opts.since,
        until: opts.until,
        userPlan: plan,
      });
    } else if (provider === "shopee") {
      const r = defaultRollingRange(plan);
      return await syncShopeeWarehouseMetrics({
        connectionId,
        workspaceId,
        userPlan: plan,
        since: opts.since ?? r.since,
        until: opts.until ?? r.until,
      });
    } else if (provider === "lazada") {
      const r = defaultRollingRange(plan);
      return await syncLazadaWarehouseMetrics({
        connectionId,
        workspaceId,
        userPlan: plan,
        since: opts.since ?? r.since,
        until: opts.until ?? r.until,
      });
    } else {
      logger.error(`[syncConnectionData] Unsupported provider: ${provider}`);
      return { success: false, rowsIngested: 0, error: `Unsupported provider: ${provider}` };
    }
  } catch (error: any) {
    logger.error(`[syncConnectionData] Sync failed for ${provider}:`, error);
    return { success: false, rowsIngested: 0, error: error.message };
  }
}

function defaultRollingRange(plan: string): { since: string; until: string } {
  const days = Math.min(30, getPlanLimits(plan).explorerMaxDateRangeDays);
  const until = new Date();
  const since = new Date(until.getTime() - (days - 1) * 86400000);
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}

async function syncMetaAds(opts: {
  connectionId: string;
  credentials: any;
  workspaceId: string;
}): Promise<SyncResult> {
  const { connectionId, credentials, workspaceId } = opts;
  
  // DEBUG: Log full credentials structure
  logger.info(`[syncMetaAds] DEBUG Full credentials keys:`, Object.keys(credentials));
  logger.info(`[syncMetaAds] DEBUG extraFields keys:`, Object.keys(credentials.extraFields || {}));
  logger.info(`[syncMetaAds] DEBUG extraFields.adAccounts:`, JSON.stringify(credentials.extraFields?.adAccounts));
  logger.info(`[syncMetaAds] DEBUG extraFields.adAccountIds:`, credentials.extraFields?.adAccountIds);
  
  logger.info(`[syncMetaAds] Starting. adAccounts:`, credentials.adAccounts?.length || 0, 
    'adAccountIds:', credentials.adAccountIds?.length || 0);

  // Get valid token
  let accessToken: string;
  try {
    accessToken = await getValidOAuthToken({
      id: connectionId,
      credentials: encrypt(JSON.stringify(credentials)),
      provider: "meta_ads",
    });
  } catch (err: any) {
    logger.error(`[syncMetaAds] Token refresh failed:`, err);
    return { success: false, rowsIngested: 0, error: `Token failed: ${err.message}` };
  }

  if (!accessToken) {
    logger.error(`[syncMetaAds] No access token returned`);
    return { success: false, rowsIngested: 0, error: "Failed to get valid token" };
  }
  logger.info(`[syncMetaAds] Got access token`);

  // Get ad accounts - stored in extraFields.adAccounts from OAuth
  const extraFields = credentials.extraFields || {};
  let adAccounts = extraFields.adAccounts || 
    (extraFields.adAccountIds || credentials.adAccountIds || []).map((id: string) => ({ id, name: id }));
  logger.info(`[syncMetaAds] Total ad accounts from extraFields:`, adAccounts.length);
  logger.info(`[syncMetaAds] DEBUG adAccounts array:`, JSON.stringify(adAccounts));

  // Filter to selected if specified
  const selectedIds = extraFields.selectedAdAccountIds || credentials.selectedAdAccountIds;
  if (selectedIds?.length > 0) {
    adAccounts = adAccounts.filter((acc: any) => 
      selectedIds.includes(acc.id)
    );
    logger.info(`[syncMetaAds] Filtered to ${adAccounts.length} selected accounts`);
  }

  if (!adAccounts?.length) {
    logger.error(`[syncMetaAds] No ad accounts to sync`);
    return { success: false, rowsIngested: 0, error: "No ad accounts selected" };
  }

  const jobId = `pipeline-${Date.now()}`;
  let totalRows = 0;

  logger.info(`[syncMetaAds] Starting sync for ${adAccounts.length} accounts`);

  for (const account of adAccounts) {
    const accountId = account.id;
    const accountName = account.name;
    logger.info(`[syncMetaAds] Processing account ${accountId}`);

    // Acquire sync lock
    const lockResult = await acquireMetaSyncLock({
      workspaceId,
      connectionId,
      adAccountId: accountId,
      jobId,
    });

    if (!lockResult.acquired) {
      logger.warn(`[syncMetaAds] Could not acquire lock for ${accountId}`);
      continue;
    }

    const lock = lockResult as { scope: string; leaseId: string; fencingToken: bigint };

    try {
      // Fetch insights from Meta API
      logger.info(`[syncMetaAds] Fetching Meta API for ${accountId}`);
      const rows = await metaReportClient.getInsights(accessToken, {
        adAccountId: accountId.replace("act_", ""),
        fields: META_DEFAULT_FIELDS,
        level: "campaign",
        datePreset: "last_30d",
        timeIncrement: 1,
      });
      logger.info(`[syncMetaAds] Meta API returned ${rows.length} rows for ${accountId}`);

      if (rows.length > 0) {
        // Ingest to CampaignMetric
        logger.info(`[syncMetaAds] Ingesting ${rows.length} rows to CampaignMetric`);
        const result = await ingestMetaRows({
          workspaceId,
          connectionId,
          accountId,
          accountName,
          level: "campaign",
          rows,
          syncJobId: jobId,
          lockScope: lock.scope,
          leaseId: lock.leaseId,
          fencingToken: lock.fencingToken,
        });

        logger.info(`[syncMetaAds] Ingested ${result.upserted} rows, failed: ${result.failed}`);
        totalRows += result.upserted;
      } else {
        logger.info(`[syncMetaAds] No rows to ingest for ${accountId}`);
      }

      await releaseMetaSyncLock({ scope: lock.scope, leaseId: lock.leaseId, success: true });
    } catch (error) {
      await releaseMetaSyncLock({ scope: lock.scope, leaseId: lock.leaseId, success: false });
      logger.error(`[syncMetaAds] Failed for account ${accountId}:`, error);
      // Continue with next account
    }
  }

  // Update connection sync time
  await prisma.connection.update({
    where: { id: connectionId },
    data: { lastSyncAt: new Date() },
  });

  return { success: true, rowsIngested: totalRows };
}

async function syncGoogleAds(opts: {
  connectionId: string;
  credentials: any;
  workspaceId: string;
  since?: string;
  until?: string;
  userPlan: string;
}): Promise<SyncResult> {
  const { connectionId, credentials, workspaceId, userPlan } = opts;

  let accessToken: string;
  try {
    accessToken = await getValidOAuthToken({
      id: connectionId,
      credentials: encrypt(JSON.stringify(credentials)),
      provider: "google_ads",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to get valid token";
    return { success: false, rowsIngested: 0, error: msg };
  }

  if (!accessToken) {
    return { success: false, rowsIngested: 0, error: "Failed to get valid token" };
  }

  // Google stores customerIds in extraFields
  const extraFields = credentials.extraFields || {};
  let customerIds = extraFields.customerIds || credentials.customerIds || [];
  logger.info(`[syncGoogleAds] Total customer IDs:`, customerIds.length);

  const selectedIds = extraFields.selectedCustomerIds || credentials.selectedCustomerIds;
  if (selectedIds?.length > 0) {
    customerIds = customerIds.filter((id: string) => selectedIds.includes(id));
    logger.info(`[syncGoogleAds] Filtered to ${customerIds.length} selected customers`);
  }

  if (!customerIds.length) {
    return { success: false, rowsIngested: 0, error: "No customer accounts selected" };
  }

  const dateSpec =
    opts.since && opts.until
      ? (() => {
          return `BETWEEN '${opts.since}' AND '${opts.until}'`;
        })()
      : clampGoogleAdsDatePeriodForPlan(userPlan, "LAST_30_DAYS");

  const jobId = `pipeline-${Date.now()}`;
  let totalRows = 0;
  const failures: Array<{ customerId: string; error: string }> = [];

  for (const customerId of customerIds) {
    try {
      const rows = await googleAdsReportClient.getCampaignPerformance(
        accessToken,
        customerId,
        dateSpec,
        credentials.mccId,
      );

      if (rows.length > 0) {
        const transformedRows = rows.map((r: any) => ({
          campaign_id: r.campaign_id || r.campaign_name,
          campaign_name: r.campaign_name,
          ad_group_id: r.ad_group_id,
          ad_group_name: r.ad_group_name,
          date: r.date,
          impressions: r.impressions,
          clicks: r.clicks,
          cost: r.cost,
          cpc: r.average_cpc,
          ctr: r.ctr,
          conversions: r.conversions,
          conversion_value: r.conversion_value,
          currency: r.currency,
          raw: r,
        }));

        const result = await ingestGoogleAdsRows(transformedRows, {
          workspaceId,
          connectionId,
          accountId: customerId,
          accountName: `Customer ${customerId}`,
          syncJobId: jobId,
        });

        totalRows += result.upserted;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Google Ads sync failed";
      failures.push({ customerId, error: msg });
      logger.error(`[Google Ads Sync] Failed for customer ${customerId}:`, error);
    }
  }

  await prisma.connection.update({
    where: { id: connectionId },
    data: { lastSyncAt: new Date() },
  });

  // If every customer failed, surface the error so the UI shows it (instead of silent 0 rows).
  if (totalRows === 0 && failures.length > 0) {
    const head = failures.slice(0, 2).map((f) => `${f.customerId}: ${f.error}`).join(" | ");
    const extra = failures.length > 2 ? ` (+${failures.length - 2} more)` : "";
    return {
      success: false,
      rowsIngested: 0,
      error: `Google Ads import failed. ${head}${extra}`,
    };
  }

  // Partial success: return success but keep a short warning for logs.
  if (failures.length > 0) {
    logger.warn(`[Google Ads Sync] Partial failures: ${failures.length}/${customerIds.length}`);
  }
  return { success: true, rowsIngested: totalRows };
}

async function syncTikTok(opts: {
  connectionId: string;
  credentials: any;
  workspaceId: string;
  since?: string;
  until?: string;
  userPlan: string;
}): Promise<SyncResult> {
  const { connectionId, credentials, workspaceId, userPlan } = opts;

  const accessToken = await getValidOAuthToken({
    id: connectionId,
    credentials: encrypt(JSON.stringify(credentials)),
    provider: "tiktok_business",
  });

  if (!accessToken) {
    return { success: false, rowsIngested: 0, error: "Failed to get valid token" };
  }

  // TikTok stores advertiserIds in extraFields
  const extraFields = credentials.extraFields || {};
  let advertiserIds = extraFields.advertiserIds || credentials.advertiserIds || [];
  logger.info(`[syncTikTok] Total advertiser IDs:`, advertiserIds.length);

  const selectedIds = extraFields.selectedAdvertiserIds || credentials.selectedAdvertiserIds;
  if (selectedIds?.length > 0) {
    advertiserIds = advertiserIds.filter((id: string) => selectedIds.includes(id));
    logger.info(`[syncTikTok] Filtered to ${advertiserIds.length} selected advertisers`);
  }

  if (!advertiserIds.length) {
    return { success: false, rowsIngested: 0, error: "No advertisers selected" };
  }

  const jobId = `pipeline-${Date.now()}`;
  let totalRows = 0;

  let endDate: string;
  let startDate: string;
  if (opts.since && opts.until) {
    startDate = opts.since;
    endDate = opts.until;
  } else {
    endDate = new Date().toISOString().split("T")[0];
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  }

  for (const advertiserId of advertiserIds) {
    try {
      const taskId = await tiktokReportClient.createTask(accessToken, {
        advertiser_id: advertiserId,
        report_type: "BASIC",
        data_level: "AUCTION_CAMPAIGN",
        dimensions: ["campaign_id", "campaign_name", "adgroup_id", "adgroup_name", "stat_time_day"],
        metrics: ["impression", "click", "spend", "cpc", "ctr", "conversion", "revenue", "roas"],
        start_date: startDate,
        end_date: endDate,
        page_size: 1000,
      }, credentials.sandbox === true);

      // Poll for completion
      let status = await tiktokReportClient.checkTask(accessToken, advertiserId, taskId, credentials.sandbox === true);
      let attempts = 0;
      while (status.status !== "COMPLETED" && status.status !== "FAILED" && attempts < 10) {
        await new Promise((r) => setTimeout(r, 3000));
        status = await tiktokReportClient.checkTask(accessToken, advertiserId, taskId, credentials.sandbox === true);
        attempts++;
      }

      if (status.status === "COMPLETED" && status.url) {
        const reportRes = await fetch(status.url);
        const reportText = await reportRes.text();
        const reportRows = reportText.split("\n").filter((l) => l.trim()).slice(1);

        const rows = reportRows.map((line) => {
          const parts = line.split(",");
          return {
            dimensions: {
              campaign_id: parts[0],
              campaign_name: parts[1],
              adgroup_id: parts[2],
              adgroup_name: parts[3],
              stat_time_day: parts[4],
            },
            metrics: {
              impression: parts[5],
              click: parts[6],
              spend: parts[7],
              cpc: parts[8],
              ctr: parts[9],
              conversion: parts[10],
              revenue: parts[11],
              roas: parts[12],
            },
          };
        });

        if (rows.length > 0) {
          const result = await ingestTiktokRows(rows, {
            workspaceId,
            connectionId,
            accountId: advertiserId,
            accountName: `Advertiser ${advertiserId}`,
            syncJobId: jobId,
          });

          totalRows += result.upserted;
        }
      }
    } catch (error) {
      logger.error(`[TikTok Sync] Failed for advertiser ${advertiserId}:`, error);
    }
  }

  await prisma.connection.update({
    where: { id: connectionId },
    data: { lastSyncAt: new Date() },
  });

  return { success: true, rowsIngested: totalRows };
}
