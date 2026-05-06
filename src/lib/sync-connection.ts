/**
 * Internal sync connection library - extracts data from ad platforms to CampaignMetric
 * Called directly from pipeline run (no HTTP overhead, no auth issues)
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getValidOAuthToken } from "@/lib/oauth-framework/token-refresh";
import { encrypt } from "@/lib/encryption";

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

interface SyncOptions {
  connectionId: string;
  provider: string;
  credentials: any;
  workspaceId: string;
}

interface SyncResult {
  success: boolean;
  rowsIngested: number;
  error?: string;
}

export async function syncConnectionData(opts: SyncOptions): Promise<SyncResult> {
  const { connectionId, provider, credentials, workspaceId } = opts;
  
  logger.info(`[syncConnectionData] Starting sync for ${provider} connection ${connectionId}`);

  try {
    if (provider === "meta_ads") {
      return await syncMetaAds({ connectionId, credentials, workspaceId });
    } else if (provider === "google_ads") {
      return await syncGoogleAds({ connectionId, credentials, workspaceId });
    } else if (provider === "tiktok_business") {
      return await syncTikTok({ connectionId, credentials, workspaceId });
    } else {
      return { success: false, rowsIngested: 0, error: `Unsupported provider: ${provider}` };
    }
  } catch (error: any) {
    logger.error(`[syncConnectionData] Sync failed for ${provider}:`, error);
    return { success: false, rowsIngested: 0, error: error.message };
  }
}

async function syncMetaAds(opts: {
  connectionId: string;
  credentials: any;
  workspaceId: string;
}): Promise<SyncResult> {
  const { connectionId, credentials, workspaceId } = opts;

  // Get valid token
  const accessToken = await getValidOAuthToken({
    id: connectionId,
    credentials: encrypt(JSON.stringify(credentials)),
    provider: "meta_ads",
  });

  if (!accessToken) {
    return { success: false, rowsIngested: 0, error: "Failed to get valid token" };
  }

  // Get ad accounts
  let adAccounts = credentials.adAccounts || 
    (credentials.adAccountIds || []).map((id: string) => ({ id, name: id }));

  // Filter to selected if specified
  if (credentials.selectedAdAccountIds?.length > 0) {
    adAccounts = adAccounts.filter((acc: any) => 
      credentials.selectedAdAccountIds.includes(acc.id)
    );
  }

  if (!adAccounts?.length) {
    return { success: false, rowsIngested: 0, error: "No ad accounts selected" };
  }

  const jobId = `pipeline-${Date.now()}`;
  let totalRows = 0;

  for (const account of adAccounts) {
    const accountId = account.id;
    const accountName = account.name;

    // Acquire sync lock
    const lockResult = await acquireMetaSyncLock({
      workspaceId,
      connectionId,
      adAccountId: accountId,
      jobId,
    });

    if (!lockResult.acquired) {
      logger.warn(`[Meta Sync] Could not acquire lock for ${accountId}`);
      continue;
    }

    const lock = lockResult as { scope: string; leaseId: string; fencingToken: bigint };

    try {
      // Fetch insights from Meta API
      const rows = await metaReportClient.getInsights(accessToken, {
        adAccountId: accountId.replace("act_", ""),
        fields: META_DEFAULT_FIELDS,
        level: "campaign",
        datePreset: "last_30d",
        timeIncrement: 1,
      });

      if (rows.length > 0) {
        // Ingest to CampaignMetric
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

        totalRows += result.upserted;
      }

      await releaseMetaSyncLock({ scope: lock.scope, leaseId: lock.leaseId, success: true });
    } catch (error) {
      await releaseMetaSyncLock({ scope: lock.scope, leaseId: lock.leaseId, success: false });
      logger.error(`[Meta Sync] Failed for account ${accountId}:`, error);
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
}): Promise<SyncResult> {
  const { connectionId, credentials, workspaceId } = opts;

  const accessToken = await getValidOAuthToken({
    id: connectionId,
    credentials: encrypt(JSON.stringify(credentials)),
    provider: "google_ads",
  });

  if (!accessToken) {
    return { success: false, rowsIngested: 0, error: "Failed to get valid token" };
  }

  let customerIds = credentials.customerIds || [];
  
  if (credentials.selectedCustomerIds?.length > 0) {
    customerIds = customerIds.filter((id: string) => 
      credentials.selectedCustomerIds.includes(id)
    );
  }

  if (!customerIds.length) {
    return { success: false, rowsIngested: 0, error: "No customer accounts selected" };
  }

  const jobId = `pipeline-${Date.now()}`;
  let totalRows = 0;

  for (const customerId of customerIds) {
    try {
      const rows = await googleAdsReportClient.getCampaignPerformance(
        accessToken,
        customerId,
        "LAST_30_DAYS",
        credentials.mccId
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
      logger.error(`[Google Ads Sync] Failed for customer ${customerId}:`, error);
    }
  }

  await prisma.connection.update({
    where: { id: connectionId },
    data: { lastSyncAt: new Date() },
  });

  return { success: true, rowsIngested: totalRows };
}

async function syncTikTok(opts: {
  connectionId: string;
  credentials: any;
  workspaceId: string;
}): Promise<SyncResult> {
  const { connectionId, credentials, workspaceId } = opts;

  const accessToken = await getValidOAuthToken({
    id: connectionId,
    credentials: encrypt(JSON.stringify(credentials)),
    provider: "tiktok_business",
  });

  if (!accessToken) {
    return { success: false, rowsIngested: 0, error: "Failed to get valid token" };
  }

  let advertiserIds = credentials.advertiserIds || [];
  
  if (credentials.selectedAdvertiserIds?.length > 0) {
    advertiserIds = advertiserIds.filter((id: string) => 
      credentials.selectedAdvertiserIds.includes(id)
    );
  }

  if (!advertiserIds.length) {
    return { success: false, rowsIngested: 0, error: "No advertisers selected" };
  }

  const jobId = `pipeline-${Date.now()}`;
  let totalRows = 0;

  const endDate = new Date().toISOString().split("T")[0];
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

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
