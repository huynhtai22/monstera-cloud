import { getValidOAuthToken } from "@/lib/oauth-framework/token-refresh";
import { encrypt } from "@/lib/encryption";
import { googleAdsReportClient } from "@/lib/google-ads";
import {
  tiktokReportClient,
  TIKTOK_CAMPAIGN_REPORT_DIMENSIONS,
  TIKTOK_CAMPAIGN_REPORT_METRICS,
} from "@/lib/tiktok-business";
import { ingestGoogleAdsRows, ingestTiktokRows } from "@/lib/ad-platform-ingest";
import { logger } from "@/lib/logger";
import {
  normalizeTikTokAdvertiserIds,
  TIKTOK_ADVERTISER_RECONNECT_MESSAGE,
} from "@/lib/tiktok-advertiser-id";

function gaqlBetween(since: string, until: string) {
  // GAQL requires single quotes around date literals.
  return `segments.date BETWEEN '${since}' AND '${until}'`;
}

export async function syncGoogleAdsIntoWarehouse(params: {
  workspaceId: string;
  connectionId: string;
  credentials: any;
  since: string;
  until: string;
  customerId?: string;
}): Promise<{ upserted: number; accounts: number; failed: number }> {
  const { workspaceId, connectionId, credentials, since, until, customerId } = params;

  const accessToken = await getValidOAuthToken({
    id: connectionId,
    credentials: encrypt(JSON.stringify(credentials)),
    provider: "google_ads",
  });

  if (!accessToken) throw new Error("Failed to get valid token");

  const extraFields = credentials.extraFields || {};
  let customerIds: string[] = extraFields.customerIds || credentials.customerIds || [];

  const selectedIds: string[] | undefined = Array.isArray(extraFields.selectedCustomerIds)
    ? extraFields.selectedCustomerIds
    : Array.isArray(credentials.selectedCustomerIds)
      ? credentials.selectedCustomerIds
      : undefined;
  if (selectedIds !== undefined) {
    customerIds = customerIds.filter((id) => selectedIds.includes(id));
  }

  if (customerId) {
    customerIds = customerIds.filter((id) => id === customerId);
  }

  if (!customerIds.length) throw new Error("No customer accounts selected");

  const jobId = `explorer-${Date.now()}`;
  let upserted = 0;
  let failed = 0;

  for (const cid of customerIds) {
    try {
      // Query with explicit date range for Explorer imports.
      const gaql = `
        SELECT
          campaign.name,
          campaign.status,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversion_value,
          metrics.ctr,
          metrics.average_cpc,
          segments.date
        FROM campaign
        WHERE ${gaqlBetween(since, until)}
          AND campaign.status != 'REMOVED'
      `;

      const rows = await googleAdsReportClient.searchStream(accessToken, cid, gaql, credentials.mccId);

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
        accountId: cid,
        accountName: `Customer ${cid}`,
        syncJobId: jobId,
      });

      upserted += result.upserted;
      failed += result.failed;
    } catch (e) {
      logger.error(`[Explorer Google Ads Import] failed for customer ${cid}:`, e);
      failed++;
    }
  }

  return { upserted, accounts: customerIds.length, failed };
}

export async function syncTikTokIntoWarehouse(params: {
  workspaceId: string;
  connectionId: string;
  credentials: any;
  since: string;
  until: string;
  advertiserId?: string;
}): Promise<{ upserted: number; accounts: number; failed: number }> {
  const { workspaceId, connectionId, credentials, since, until, advertiserId } = params;

  const accessToken = await getValidOAuthToken({
    id: connectionId,
    credentials: encrypt(JSON.stringify(credentials)),
    provider: "tiktok_business",
  });

  if (!accessToken) throw new Error("Failed to get valid token");

  const extraFields = credentials.extraFields || {};
  let advertiserIds = normalizeTikTokAdvertiserIds(
    extraFields.advertiserIds || credentials.advertiserIds,
  );

  const selectedIds: string[] | undefined = Array.isArray(extraFields.selectedAdvertiserIds)
    ? extraFields.selectedAdvertiserIds
    : Array.isArray(credentials.selectedAdvertiserIds)
      ? credentials.selectedAdvertiserIds
      : undefined;
  if (selectedIds !== undefined) {
    const selectedAdvertiserIds = new Set(normalizeTikTokAdvertiserIds(selectedIds));
    advertiserIds = advertiserIds.filter((id) => selectedAdvertiserIds.has(id));
  }

  if (advertiserId) {
    const requestedAdvertiserIds = new Set(normalizeTikTokAdvertiserIds([advertiserId]));
    advertiserIds = advertiserIds.filter((id) => requestedAdvertiserIds.has(id));
  }

  if (!advertiserIds.length) throw new Error(TIKTOK_ADVERTISER_RECONNECT_MESSAGE);

  const jobId = `explorer-${Date.now()}`;
  let upserted = 0;
  let failed = 0;

  for (const aid of advertiserIds) {
    try {
      const taskId = await tiktokReportClient.createTask(
        accessToken,
        {
          advertiser_id: aid,
          report_type: "BASIC",
          data_level: "AUCTION_CAMPAIGN",
          dimensions: [...TIKTOK_CAMPAIGN_REPORT_DIMENSIONS],
          metrics: [...TIKTOK_CAMPAIGN_REPORT_METRICS],
          start_date: since,
          end_date: until,
          page_size: 1000,
        },
        credentials.sandbox === true,
      );

      let status = await tiktokReportClient.checkTask(
        accessToken,
        aid,
        taskId,
        credentials.sandbox === true,
      );
      let attempts = 0;
      while (
        status.status !== "SUCCESS" &&
        status.status !== "COMPLETED" &&
        status.status !== "FAILED" &&
        status.status !== "CANCELED" &&
        attempts < 20
      ) {
        await new Promise((r) => setTimeout(r, 3000));
        status = await tiktokReportClient.checkTask(
          accessToken,
          aid,
          taskId,
          credentials.sandbox === true,
        );
        attempts++;
      }

      if (status.status !== "SUCCESS" && status.status !== "COMPLETED") {
        throw new Error(`TikTok report not ready (status=${status.status})`);
      }

      const downloadUrl = await tiktokReportClient.getDownloadUrl(
        accessToken,
        aid,
        taskId,
        credentials.sandbox === true,
      );
      const rows = await tiktokReportClient.downloadRows(downloadUrl);

      const result = await ingestTiktokRows(rows, {
        workspaceId,
        connectionId,
        accountId: aid,
        accountName: `Advertiser ${aid}`,
        syncJobId: jobId,
      });

      upserted += result.upserted;
      failed += result.failed;
    } catch (e) {
      logger.error(`[Explorer TikTok Import] failed for advertiser ${aid}:`, e);
      failed++;
    }
  }

  return { upserted, accounts: advertiserIds.length, failed };
}
