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
import { syncShopeeAdsWarehouseMetrics } from "@/lib/sync-shopee-ads-warehouse";

// Meta imports
import { ingestMetaRows } from "@/lib/meta-ingest";
import { metaAdsClient, metaReportClient, META_DEFAULT_FIELDS } from "@/lib/meta-ads";
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
      const range = {
        since: opts.since ?? r.since,
        until: opts.until ?? r.until,
      };
      const orders = await syncShopeeWarehouseMetrics({
        connectionId,
        workspaceId,
        userPlan: plan,
        ...range,
      });
      if (!orders.success) {
        return orders;
      }

      const ads = await syncShopeeAdsWarehouseMetrics({
        connectionId,
        workspaceId,
        userPlan: plan,
        ...range,
      });
      if (!ads.success) {
        logger.warn(
          `[syncConnectionData] Shopee Ads warehouse failed (orders still ok): ${ads.error ?? ""}`
        );
      }

      return {
        success: true,
        rowsIngested: orders.rowsIngested + ads.rowsIngested,
      };
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

  // 1. Get ad accounts - stored in extraFields.adAccounts from OAuth
  const extraFields = credentials.extraFields || {};
  let adAccounts = extraFields.adAccounts || credentials.adAccounts ||
    (extraFields.adAccountIds || credentials.adAccountIds || []).map((id: string) => ({ id, name: id }));
  logger.info(`[syncMetaAds] Total ad accounts from credentials:`, adAccounts?.length || 0);

  // 2. Fallback to Connection row in database (remoteAccountId / name)
  if ((!adAccounts || adAccounts.length === 0) && connectionId) {
    try {
      const conn = await prisma.connection.findUnique({
        where: { id: connectionId },
        select: { remoteAccountId: true, name: true },
      });
      if (conn?.remoteAccountId && conn.remoteAccountId.trim().length > 0) {
        adAccounts = [{ id: conn.remoteAccountId, name: conn.name || conn.remoteAccountId }];
        logger.info(`[syncMetaAds] Resolved ad account from DB remoteAccountId: ${conn.remoteAccountId}`);
      }
    } catch (dbErr) {
      logger.warn(`[syncMetaAds] DB connection query failed:`, dbErr);
    }
  }

  // 3. Fallback: query Meta Graph API dynamically using the valid accessToken
  if ((!adAccounts || adAccounts.length === 0) && accessToken) {
    try {
      logger.info(`[syncMetaAds] Querying Meta Graph API dynamically for accessible ad accounts`);
      const apiAccounts = await metaAdsClient.getAdAccounts(accessToken);
      if (apiAccounts && apiAccounts.length > 0) {
        adAccounts = apiAccounts.map((a: any) => ({ id: a.id, name: a.name || a.id }));
        logger.info(`[syncMetaAds] Dynamically discovered ${adAccounts.length} Meta ad accounts from Graph API`);
      }
    } catch (apiErr) {
      logger.warn(`[syncMetaAds] Dynamic Meta API ad account discovery failed:`, apiErr);
    }
  }

  // 4. Filter to selected if specified (normalized matching without act_ prefix issues)
  const selectedIds: string[] = extraFields.selectedAdAccountIds || credentials.selectedAdAccountIds;
  if (selectedIds?.length > 0 && adAccounts?.length > 0) {
    const normSelected = new Set(selectedIds.map((s) => String(s).replace(/^act_/, "").trim()));
    const filtered = adAccounts.filter((acc: any) => {
      const normId = String(acc.id).replace(/^act_/, "").trim();
      return normSelected.has(normId) || selectedIds.includes(acc.id);
    });
    if (filtered.length > 0) {
      adAccounts = filtered;
    }
    logger.info(`[syncMetaAds] Filtered to ${adAccounts.length} selected accounts`);
  }

  if (!adAccounts?.length) {
    logger.error(`[syncMetaAds] No ad accounts found to sync`);
    return { success: false, rowsIngested: 0, error: "No ad accounts selected or found on connection" };
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
      ? `BETWEEN '${opts.since}' AND '${opts.until}'`
      : clampGoogleAdsDatePeriodForPlan(userPlan, "LAST_30_DAYS");

  logger.info(`[syncGoogleAds] dateSpec="${dateSpec}" rootCustomers=${customerIds.length}`);

  const jobId = `pipeline-${Date.now()}`;
  let totalRows = 0;
  const failures: Array<{ customerId: string; error: string }> = [];

  // ── Step 1: Resolve MCC hierarchy ──────────────────────────────────────────
  // listAccessibleCustomers returns ALL accessible accounts including MCC parent
  // accounts. Querying an MCC directly returns 0 rows because campaigns live on
  // leaf child accounts. We must use listCustomerClients() to find the true
  // leaf accounts and the correct login-customer-id for each.
  type LeafAccount = { customerId: string; mccId: string; descriptiveName: string };
  const leafAccounts: LeafAccount[] = [];
  const seenLeafIds = new Set<string>();

  for (const rootId of customerIds) {
    try {
      logger.info(`[syncGoogleAds] Resolving MCC hierarchy for root=${rootId}`);
      const clients = await googleAdsReportClient.listCustomerClients(accessToken, rootId);
      logger.info(`[syncGoogleAds] root=${rootId} resolved to ${clients.length} leaf client(s)`);
      for (const client of clients) {
        if (!seenLeafIds.has(client.customerId)) {
          seenLeafIds.add(client.customerId);
          leafAccounts.push({ customerId: client.customerId, mccId: client.mccId, descriptiveName: client.descriptiveName });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[syncGoogleAds] Could not resolve hierarchy for root=${rootId}: ${msg} — trying direct query`);
      // Fallback: treat root as leaf with itself as login-customer-id
      if (!seenLeafIds.has(rootId)) {
        seenLeafIds.add(rootId);
        leafAccounts.push({ customerId: rootId, mccId: rootId, descriptiveName: `Customer ${rootId}` });
      }
    }
  }

  logger.info(`[syncGoogleAds] Total leaf accounts to query: ${leafAccounts.length}`);

  // ── Step 2: Query each leaf account ────────────────────────────────────────
  for (const { customerId, mccId, descriptiveName } of leafAccounts) {
    try {
      logger.info(`[syncGoogleAds] Fetching campaigns for customerId=${customerId} login-customer-id=${mccId} (${descriptiveName})`);

      const rows = await googleAdsReportClient.getCampaignPerformance(
        accessToken,
        customerId,
        dateSpec,
        mccId,
      );

      logger.info(`[syncGoogleAds] customerId=${customerId} returned ${rows.length} campaign rows`);

      if (rows.length === 0) continue;

      // Log first row to diagnose key mapping
      logger.info(`[syncGoogleAds] sample row keys: ${Object.keys(rows[0]).join(", ")}`);
      logger.info(`[syncGoogleAds] sample row: ${JSON.stringify(rows[0]).slice(0, 400)}`);

      const transformedRows = rows.map((r: any) => {
        // The normalizer flattens nested objects using section_field naming:
        //   campaign.id          → campaign_id  (Number)
        //   campaign.name        → campaign_name
        //   metrics.cost_micros  → metrics_cost  (divided by 1M — micros suffix stripped)
        //   metrics.impressions  → metrics_impressions
        //   metrics.clicks       → metrics_clicks
        //   metrics.ctr          → metrics_ctr
        //   metrics.average_cpc  → metrics_average_cpc
        //   metrics.conversions  → metrics_conversions
        //   segments.date        → segments_date
        //   customer.currency_code → customer_currency_code
        const campaignId = String(r.campaign_id ?? r.campaign_name ?? "unknown");
        const date = r.segments_date ?? r.date ?? null;

        return {
          campaign_id:       campaignId,
          campaign_name:     String(r.campaign_name ?? ""),
          ad_group_id:       r.ad_group_id != null ? String(r.ad_group_id) : undefined,
          ad_group_name:     r.ad_group_name != null ? String(r.ad_group_name) : undefined,
          date,
          impressions:       Number(r.metrics_impressions ?? r.impressions ?? 0),
          clicks:            Number(r.metrics_clicks ?? r.clicks ?? 0),
          cost:              Number(r.metrics_cost ?? r.cost ?? 0),
          cpc:               Number(r.metrics_average_cpc ?? r.average_cpc ?? 0),
          ctr:               Number(r.metrics_ctr ?? r.ctr ?? 0),
          conversions:       Number(r.metrics_conversions ?? r.conversions ?? 0),
          conversion_value:  Number(r.metrics_conversion_value ?? r.conversion_value ?? 0),
          currency:          r.customer_currency_code ?? r.currency ?? undefined,
          raw:               r,
        };
      });

      const validRows = transformedRows.filter((r) => !!r.date);
      const skipped = transformedRows.length - validRows.length;
      if (skipped > 0) {
        logger.warn(`[syncGoogleAds] Skipped ${skipped} rows with missing date for customerId=${customerId}`);
      }

      if (validRows.length === 0) continue;

      const result = await ingestGoogleAdsRows(validRows, {
        workspaceId,
        connectionId,
        accountId: customerId,
        accountName: descriptiveName,
        syncJobId: jobId,
      });

      logger.info(`[syncGoogleAds] customerId=${customerId} upserted=${result.upserted} failed=${result.failed}`);
      totalRows += result.upserted;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Google Ads sync failed";
      failures.push({ customerId, error: msg });
      logger.error(`[syncGoogleAds] Failed for customerId=${customerId}: ${msg}`);
    }
  }

  await prisma.connection.update({
    where: { id: connectionId },
    data: { lastSyncAt: new Date() },
  });

  logger.info(`[syncGoogleAds] Done. totalRows=${totalRows} failures=${failures.length}/${leafAccounts.length}`);

  if (totalRows === 0 && failures.length > 0 && leafAccounts.length > 0) {
    const head = failures.slice(0, 2).map((f) => `${f.customerId}: ${f.error}`).join(" | ");
    const extra = failures.length > 2 ? ` (+${failures.length - 2} more)` : "";
    return {
      success: false,
      rowsIngested: 0,
      error: `Google Ads import failed. ${head}${extra}`,
    };
  }

  if (failures.length > 0) {
    logger.warn(`[syncGoogleAds] Partial failures: ${failures.length}/${leafAccounts.length}`);
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
  const { connectionId, credentials, workspaceId } = opts;

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
        const rows = await tiktokReportClient.downloadRows(status.url);

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
