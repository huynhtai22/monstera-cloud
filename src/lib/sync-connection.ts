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
import { syncShopeeCatalogWarehouse } from "@/lib/sync-shopee-catalog-warehouse";

// Meta imports
import { ingestMetaRows } from "@/lib/meta-ingest";
import { MetaOAuthRevokedError } from "@/lib/meta-ads";
import { handleMetaRevocation } from "@/lib/ingestion/meta-campaign-metrics";
import { metaAdsClient, metaReportClient, META_DEFAULT_FIELDS } from "@/lib/meta-ads";
import {
  acquireMetaSyncLock,
  releaseMetaSyncLock,
} from "@/lib/meta-sync-lock";
import {
  acquireConnectionSyncLease,
  assertConnectionSyncLease,
  releaseConnectionSyncLease,
  type ConnectionLease,
} from "@/lib/connection-sync-lease";

// Google imports
import { googleAdsReportClient, isGoogleAdsDeveloperTokenBlocked } from "@/lib/google-ads";
import { ingestGoogleAdsRows } from "@/lib/ad-platform-ingest";

// TikTok imports
import {
  tiktokReportClient,
  TIKTOK_CAMPAIGN_REPORT_DIMENSIONS,
  TIKTOK_CAMPAIGN_REPORT_METRICS,
  type CreateReportTaskParams,
} from "@/lib/tiktok-business";
import {
  normalizeTikTokAdvertiserIds,
  TIKTOK_ADVERTISER_RECONNECT_MESSAGE,
} from "@/lib/tiktok-advertiser-id";
import { ingestTiktokRows } from "@/lib/ad-platform-ingest";
import { recordAccountOutcome, getSkippedAccountIds } from "@/lib/provider-account-health";
import { computeStaleRowStats } from "@/lib/provider-row-reconciliation";
import {
  type SyncChildResult,
  type SyncResult,
  isRetryableSyncError,
  makeFailedSyncResult,
  type ProviderRetryState,
  summarizeSyncOutcome,
} from "@/lib/sync-outcome";
import { refreshConnectionLastDataThrough, shouldRefreshLastDataThrough } from "@/lib/connection-data-through";

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
  /** Internal durable-worker continuation state; never accepted from public input. */
  providerState?: ProviderRetryState;
}

export async function syncConnectionData(opts: SyncOptions): Promise<SyncResult> {
  const { connectionId, provider, credentials, workspaceId } = opts;
  const plan = opts.userPlan ?? "free";

  logger.info(`[syncConnectionData] Starting sync for ${provider} connection ${connectionId} in workspace ${workspaceId}`);

  // Connection-level lease: serialize all execution paths (manual sync, cron
  // warehouse-refresh, batch import, OAuth backfill) per connection. A lease
  // refusal is not a sync outcome of this connection — it means another worker
  // owns the connection, so we return retryable WITHOUT persisting state that
  // could overwrite the owner's outcome.
  const leaseAttempt = await acquireConnectionSyncLease({ provider, workspaceId, connectionId });
  if (!leaseAttempt.acquired) {
    logger.warn(`[syncConnectionData] ${leaseAttempt.reason} lease for ${provider} connection ${connectionId}; deferring`);
    return makeFailedSyncResult(
      leaseAttempt.reason === "active"
        ? "Another sync is already running for this connection"
        : "Connection lease contention; retry shortly",
      true,
    );
  }
  const lease = leaseAttempt.lease;

  try {
    const result = await syncConnectionDataInner(opts, lease);
    await releaseConnectionSyncLease(lease, result.outcome !== "failed");
    return result;
  } catch (error: any) {
    await releaseConnectionSyncLease(lease, false);
    throw error;
  }
}

async function syncConnectionDataInner(opts: SyncOptions, lease: ConnectionLease): Promise<SyncResult> {
  const { connectionId, provider, credentials, workspaceId } = opts;
  const plan = opts.userPlan ?? "free";
  logger.info(`[syncConnectionData] Starting requested sync scope`, {
    provider,
    connectionId,
    workspaceId,
    since: opts.since ?? null,
    until: opts.until ?? null,
  });

  try {
    if (provider === "meta_ads") {
      return await syncMetaAds({
        connectionId,
        credentials,
        workspaceId,
        since: opts.since,
        until: opts.until,
        userPlan: plan,
        lease,
      });
    } else if (provider === "google_ads") {
      return await syncGoogleAds({
        connectionId,
        credentials,
        workspaceId,
        since: opts.since,
        until: opts.until,
        userPlan: plan,
        lease,
      });
    } else if (provider === "tiktok_business") {
      return await syncTikTok({
        connectionId,
        credentials,
        workspaceId,
        since: opts.since,
        until: opts.until,
        userPlan: plan,
        providerState: opts.providerState,
        lease,
      });
    } else if (provider === "shopee") {
      const r = defaultRollingRange(plan);
      const range = {
        since: opts.since ?? r.since,
        until: opts.until ?? r.until,
      };
      const catalog = await syncShopeeCatalogWarehouse({ connectionId, workspaceId });
      const orders = await syncShopeeWarehouseMetrics({
        connectionId,
        workspaceId,
        userPlan: plan,
        lease,
        ...range,
      });
      const ads = await syncShopeeAdsWarehouseMetrics({
        connectionId,
        workspaceId,
        userPlan: plan,
        lease,
        ...range,
      });
      if (!ads.success) {
        logger.warn(
          `[syncConnectionData] Shopee Ads warehouse failed (orders still ok): ${ads.error ?? ""}`
        );
      }

      const children: SyncChildResult[] = [
        { id: "campaign_catalog", kind: "connection", ok: catalog.campaignsSuccess, rowsIngested: catalog.campaignsWritten, error: catalog.campaignsError, retryable: !catalog.campaignsSuccess && isRetryableSyncError(catalog.campaignsError) },
        { id: "product_catalog", kind: "connection", ok: catalog.productsSuccess, rowsIngested: catalog.productsWritten, error: catalog.productsError, retryable: !catalog.productsSuccess && isRetryableSyncError(catalog.productsError) },
        { id: "orders", kind: "connection", ok: orders.success, rowsIngested: orders.rowsIngested, error: orders.error, retryable: !orders.success && isRetryableSyncError(orders.error) },
        { id: "ads_performance", kind: "connection", ok: ads.success, rowsIngested: ads.rowsIngested, error: ads.error, retryable: !ads.success && isRetryableSyncError(ads.error) },
      ];
      const summary = summarizeSyncOutcome(children);
      await persistConnectionSyncOutcome(connectionId, summary, lease);
      return { ...summary, children };
    } else if (provider === "lazada") {
      const r = defaultRollingRange(plan);
      const result = await syncLazadaWarehouseMetrics({
        connectionId,
        workspaceId,
        userPlan: plan,
        lease,
        since: opts.since ?? r.since,
        until: opts.until ?? r.until,
      });
      const children: SyncChildResult[] = [{ id: "orders", kind: "connection", ok: result.success, rowsIngested: result.rowsIngested, error: result.error, retryable: !result.success && isRetryableSyncError(result.error) }];
      const summary = summarizeSyncOutcome(children);
      await persistConnectionSyncOutcome(connectionId, summary, lease);
      return { ...summary, children };
    } else {
      logger.error(`[syncConnectionData] Unsupported provider: ${provider}`);
      const result = makeFailedSyncResult(`Unsupported provider: ${provider}`, false);
      await persistConnectionSyncOutcome(connectionId, result, lease);
      return result;
    }
  } catch (error: any) {
    logger.error(`[syncConnectionData] Sync failed for ${provider}:`, error);
    const result = makeFailedSyncResult(error instanceof Error ? error.message : "Sync failed");
    try {
      await persistConnectionSyncOutcome(connectionId, result, lease);
    } catch (persistError) {
      logger.error("[syncConnectionData] Failed to persist failed sync outcome", persistError);
    }
    return result;
  }
}

/**
 * `lastSyncAt` is the last fully successful requested sync, never a partial attempt.
 * The write is lease-fenced: a worker whose connection lease was stolen must not
 * advance lastSyncAt, mark the connection healthy, or overwrite the newer
 * owner's error state.
 */
export async function persistConnectionSyncOutcome(
  connectionId: string,
  outcome: Pick<SyncResult, "outcome" | "error">,
  lease?: ConnectionLease,
): Promise<void> {
  if (lease) {
    try {
      await assertConnectionSyncLease(lease);
    } catch {
      logger.warn(
        `[syncConnectionData] Stale worker refusing to persist ${outcome.outcome} outcome for ${connectionId}`
      );
      return;
    }
  }
  const lastError = outcome.outcome === "success"
    ? null
    : `[${outcome.outcome}] ${outcome.error ?? "One or more requested accounts did not sync"}`.slice(0, 1900);
  // Never resurrect a disconnected connection: a sync that raced with Disconnect
  // must not flip status back to "connected".
  await prisma.connection.updateMany({
    where: { id: connectionId, status: { not: "disconnected" } },
    data: outcome.outcome === "success"
      ? { lastSyncAt: new Date(), lastError, status: "connected" }
      : { lastError },
  });
  if (shouldRefreshLastDataThrough(outcome.outcome)) {
    const conn = await prisma.connection.findUnique({
      where: { id: connectionId },
      select: { workspaceId: true },
    });
    if (conn) {
      await refreshConnectionLastDataThrough(conn.workspaceId, connectionId);
    }
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
  lease: ConnectionLease;
  since?: string;
  until?: string;
  userPlan?: string;
}): Promise<SyncResult> {
  const { connectionId, credentials, workspaceId, since, until, lease } = opts;
  
  logger.info(`[syncMetaAds] Starting. range=${since ?? "none"}..${until ?? "none"} adAccounts:`, credentials.adAccounts?.length || 0, 
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
    const result = makeFailedSyncResult(`Token failed: ${err.message}`, false);
    await persistConnectionSyncOutcome(connectionId, result, lease);
    return result;
  }

  if (!accessToken) {
    logger.error(`[syncMetaAds] No access token returned`);
    const result = makeFailedSyncResult("Failed to get valid token", false);
    await persistConnectionSyncOutcome(connectionId, result, lease);
    return result;
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

  // 3. Resolve currencies from Meta itself. Older connections were saved before
  // currency was included in OAuth metadata; never label their source amounts
  // as USD merely because the field is absent.
  if ((!adAccounts || adAccounts.length === 0 || adAccounts.some((account: any) => !account.currency)) && accessToken) {
    try {
      logger.info(`[syncMetaAds] Querying Meta Graph API dynamically for accessible ad accounts`);
      const apiAccounts = await metaAdsClient.getAdAccounts(accessToken);
      if (apiAccounts && apiAccounts.length > 0) {
        const byId = new Map(
          apiAccounts.map((account) => [String(account.id).replace(/^act_/, ""), account]),
        );
        adAccounts = adAccounts?.length
          ? adAccounts.map((account: any) => {
              const fresh = byId.get(String(account.id).replace(/^act_/, ""));
              return {
                ...account,
                name: account.name || fresh?.name || account.id,
                currency: account.currency || fresh?.currency,
              };
            })
          : apiAccounts.map((a) => ({ id: a.id, name: a.name || a.id, currency: a.currency }));
        logger.info(`[syncMetaAds] Resolved currency metadata for ${adAccounts.length} Meta ad accounts`);
      }
    } catch (apiErr) {
      logger.warn(`[syncMetaAds] Dynamic Meta API ad account discovery failed:`, apiErr);
    }
  }

  // 4. Filter to selected if specified (normalized matching without act_ prefix issues)
  const selectedIds: string[] | undefined = Array.isArray(extraFields.selectedAdAccountIds)
    ? extraFields.selectedAdAccountIds
    : Array.isArray(credentials.selectedAdAccountIds)
      ? credentials.selectedAdAccountIds
      : undefined;
  if (selectedIds !== undefined) {
    if (adAccounts?.length > 0) {
      const normSelected = new Set(selectedIds.map((s) => String(s).replace(/^act_/, "").trim()));
      const filtered = adAccounts.filter((acc: any) => {
        const normId = String(acc.id).replace(/^act_/, "").trim();
        return normSelected.has(normId) || selectedIds.includes(acc.id);
      });
      if (filtered.length > 0) {
        adAccounts = filtered;
      } else {
        adAccounts = selectedIds.map((id) => ({ id, name: id }));
      }
    } else {
      adAccounts = selectedIds.map((id) => ({ id, name: id }));
    }
    logger.info(`[syncMetaAds] Filtered to ${adAccounts.length} selected accounts`);
  }

  if (!adAccounts?.length) {
    logger.error(`[syncMetaAds] No ad accounts found to sync`);
    const result = makeFailedSyncResult("No ad accounts selected or found on connection", false);
    await persistConnectionSyncOutcome(connectionId, result, lease);
    return result;
  }

  const jobId = `pipeline-${Date.now()}`;
  const children: SyncChildResult[] = [];

  logger.info(`[syncMetaAds] Starting sync for ${adAccounts.length} accounts`);
  const skippedAccounts = await getSkippedAccountIds(connectionId, workspaceId);

  for (const account of adAccounts) {
    const accountId = account.id;
    const accountName = account.name;

    if (skippedAccounts.has(String(accountId))) {
      logger.info(`[syncMetaAds] Skipping quarantined/reconnect-required account ${accountId}`);
      children.push({ id: String(accountId), kind: "ad_account", ok: true, rowsIngested: 0, skipped: "account_health" });
      continue;
    }

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
      children.push({ id: String(accountId), kind: "ad_account", ok: false, error: "Another sync is already processing this ad account", retryable: true });
      continue;
    }

    const lock = lockResult as { scope: string; leaseId: string; fencingToken: bigint };

    try {
      // Fetch insights from Meta API
      logger.info(`[syncMetaAds] Fetching Meta API for ${accountId} with range=${since ?? "last_30d"}..${until ?? "today"}`);
      const insightsQuery: any = {
        adAccountId: accountId.replace("act_", ""),
        fields: META_DEFAULT_FIELDS,
        level: "ad",
        timeIncrement: 1,
      };

      if (since && until) {
        insightsQuery.timeRange = { since, until };
      } else {
        insightsQuery.datePreset = "last_30d";
      }

      const rows = await metaReportClient.getInsights(accessToken, insightsQuery);
      logger.info(`[syncMetaAds] Meta API returned ${rows.length} rows for ${accountId}`);

      if (rows.length > 0) {
        // Ingest to CampaignMetric
        const currency = account.currency ||
          credentials.adAccounts?.find((a: any) => a.id === accountId || a.id === `act_${accountId}`)?.currency;

        const result = await ingestMetaRows({
          workspaceId,
          connectionId,
          accountId,
          accountName,
          currency,
          level: "ad",
          rows,
          syncJobId: jobId,
          lockScope: lock.scope,
          leaseId: lock.leaseId,
          fencingToken: lock.fencingToken,
        });

        logger.info(`[syncMetaAds] Ingested ${result.upserted} rows, failed: ${result.failed}`);
        children.push({ id: String(accountId), kind: "ad_account", ok: result.failed === 0, rowsIngested: result.upserted, error: result.failed ? `${result.failed} row(s) could not be written` : undefined, retryable: result.failed > 0 });
        await recordAccountOutcome({
          workspaceId,
          connectionId,
          provider: "meta_ads",
          accountId: String(accountId),
          accountName,
          ok: result.failed === 0,
          retryable: result.failed > 0,
          error: result.failed ? `${result.failed} row(s) could not be written` : undefined,
        });

        // Stale-row detection (observability only, rows always retained).
        if (result.failed === 0 && since && until) {
          try {
            await computeStaleRowStats({
              workspaceId,
              connectionId,
              accountId: String(accountId),
              level: "ad",
              since: new Date(`${since}T00:00:00.000Z`),
              until: new Date(`${until}T23:59:59.999Z`),
              providerEntityIds: rows.map((row: any) => String(row.ad_id ?? row.id ?? "")).filter(Boolean),
              fetchComplete: true,
            });
          } catch (reconErr) {
            logger.warn("[syncMetaAds] Stale-row detection failed (non-fatal):", reconErr);
          }
        }

        // Earlier warehouse refreshes stored Meta results at campaign level.
        // Once a complete ad-level replacement is written, remove only those
        // legacy aggregates in the refreshed window so totals are not doubled.
        if (result.failed === 0 && since && until) {
          const startDate = new Date(`${since}T00:00:00.000Z`);
          const endDate = new Date(`${until}T23:59:59.999Z`);
          if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
            await prisma.campaignMetric.deleteMany({
              where: {
                workspaceId,
                connectionId,
                accountId,
                platform: "meta_ads",
                level: "campaign",
                date: { gte: startDate, lte: endDate },
              },
            });
          }
        }
      } else {
        logger.info(`[syncMetaAds] No rows to ingest for ${accountId}`);
        children.push({ id: String(accountId), kind: "ad_account", ok: true, rowsIngested: 0 });
        await recordAccountOutcome({
          workspaceId,
          connectionId,
          provider: "meta_ads",
          accountId: String(accountId),
          accountName,
          ok: true,
        });
      }

      await releaseMetaSyncLock({ scope: lock.scope, leaseId: lock.leaseId, success: true });
    } catch (error: any) {
      await releaseMetaSyncLock({ scope: lock.scope, leaseId: lock.leaseId, success: false });
      const msg = error instanceof Error ? error.message : String(error);
      const isRevoked = error instanceof MetaOAuthRevokedError;
      const isAuth = isRevoked || /error validating access token|token.*revoked|code 190|oauthexception/i.test(msg);
      const metaRetryable = isRetryableSyncError(error) && !isAuth;
      const childError = isRevoked ? `Meta authorization revoked — reconnect required. (${msg})` : msg;
      children.push({ id: String(accountId), kind: "ad_account", ok: false, error: childError, retryable: metaRetryable });
      await recordAccountOutcome({
        workspaceId,
        connectionId,
        provider: "meta_ads",
        accountId: String(accountId),
        accountName,
        ok: false,
        retryable: metaRetryable,
        authFailure: isAuth,
        error: childError,
      });

      if (isRevoked) {
        // OAuth revoked: a permanent connection-auth condition, not a per-account
        // failure. Route to the established revocation handler (disconnect +
        // ticket) so the connection does not look healthy and retrying stops.
        try {
          await handleMetaRevocation({ id: connectionId, name: accountName, remoteAccountId: accountId }, workspaceId, msg);
        } catch (revErr) {
          logger.error("[syncMetaAds] handleMetaRevocation failed:", revErr);
        }
        break; // token is revoked: remaining accounts share the same fate
      }
      logger.error(`[syncMetaAds] Failed for account ${accountId}:`, error);
      // Sibling isolation: continue with next account
    }
  }

  const summary = summarizeSyncOutcome(children);
  await persistConnectionSyncOutcome(connectionId, summary, lease);
  logger.info("[syncMetaAds] Sync outcome", { connectionId, outcome: summary.outcome, targets: children.length, failedTargets: children.filter((child) => !child.ok).map((child) => child.id), rowsIngested: summary.rowsIngested });
  return { ...summary, children };
}

async function syncGoogleAds(opts: {
  connectionId: string;
  credentials: any;
  workspaceId: string;
  lease: ConnectionLease;
  since?: string;
  until?: string;
  userPlan: string;
}): Promise<SyncResult> {
  const { connectionId, credentials, workspaceId, userPlan, lease } = opts;

  let accessToken: string;
  try {
    accessToken = await getValidOAuthToken({
      id: connectionId,
      credentials: encrypt(JSON.stringify(credentials)),
      provider: "google_ads",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to get valid token";
    const result = makeFailedSyncResult(msg, false);
    await persistConnectionSyncOutcome(connectionId, result, lease);
    return result;
  }

  if (!accessToken) {
    const result = makeFailedSyncResult("Failed to get valid token", false);
    await persistConnectionSyncOutcome(connectionId, result, lease);
    return result;
  }

  // Google stores customerIds in extraFields
  const extraFields = credentials.extraFields || {};
  let customerIds = extraFields.customerIds || credentials.customerIds || [];

  if ((!customerIds || customerIds.length === 0) && connectionId) {
    try {
      const conn = await prisma.connection.findUnique({
        where: { id: connectionId },
        select: { remoteAccountId: true },
      });
      if (conn?.remoteAccountId && conn.remoteAccountId.trim().length > 0) {
        customerIds = [conn.remoteAccountId.trim()];
        logger.info(`[syncGoogleAds] Resolved customerId from DB remoteAccountId: ${conn.remoteAccountId}`);
      }
    } catch (dbErr) {
      logger.warn(`[syncGoogleAds] DB connection query failed:`, dbErr);
    }
  }

  logger.info(`[syncGoogleAds] Total customer IDs:`, customerIds.length);

  const selectedIds: string[] | undefined = Array.isArray(extraFields.selectedCustomerIds)
    ? extraFields.selectedCustomerIds
    : Array.isArray(credentials.selectedCustomerIds)
      ? credentials.selectedCustomerIds
      : undefined;
  if (selectedIds !== undefined) {
    customerIds = customerIds.filter((id: string) => selectedIds.includes(id));
    logger.info(`[syncGoogleAds] Filtered to ${customerIds.length} selected customers`);
  }

  if (!customerIds.length) {
    const result = makeFailedSyncResult("No customer accounts selected or found on connection", false);
    await persistConnectionSyncOutcome(connectionId, result, lease);
    return result;
  }

  const dateSpec =
    opts.since && opts.until
      ? `BETWEEN '${opts.since}' AND '${opts.until}'`
      : clampGoogleAdsDatePeriodForPlan(userPlan, "LAST_30_DAYS");

  logger.info(`[syncGoogleAds] dateSpec="${dateSpec}" rootCustomers=${customerIds.length}`);

  const jobId = `pipeline-${Date.now()}`;
  const children: SyncChildResult[] = [];

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
      if (isGoogleAdsDeveloperTokenBlocked(err)) {
        // Application-level blocker: the developer token is not approved for
        // this account. Every leaf query would fail identically — never mask
        // it as per-account errors via the leaf fallback below.
        const result = makeFailedSyncResult(
          `Google Ads rejected the configured developer token (DEVELOPER_TOKEN_NOT_APPROVED). Check the production deployment configuration and Google Ads API Center status — selecting a different customer account will not resolve this application-level rejection.`,
          false,
        );
        await persistConnectionSyncOutcome(connectionId, result, lease);
        return result;
      }
      if (isRetryableSyncError(err)) {
        // A quota/network failure while expanding an MCC means its child scope
        // is unknown; never substitute a zero-row root query for completion.
        children.push({ id: String(rootId), kind: "customer", ok: false, error: `Could not resolve customer hierarchy: ${msg}`, retryable: true });
        logger.warn(`[syncGoogleAds] Deferring root=${rootId} after retryable hierarchy failure: ${msg}`);
        continue;
      }
      logger.warn(`[syncGoogleAds] Could not resolve hierarchy for root=${rootId}: ${msg} — trying direct query`);
      // Fallback: treat root as leaf with itself as login-customer-id
      if (!seenLeafIds.has(rootId)) {
        seenLeafIds.add(rootId);
        leafAccounts.push({ customerId: rootId, mccId: rootId, descriptiveName: `Customer ${rootId}` });
      }
    }
  }

  if (leafAccounts.length === 0) {
    // All roots were manager accounts with no syncable client accounts —
    // requesting metrics on a manager fails (REQUESTED_METRICS_FOR_MANAGER).
    logger.info("[syncGoogleAds] No leaf customer accounts under any root; nothing to query");
  }

  logger.info(`[syncGoogleAds] Total leaf accounts to query: ${leafAccounts.length}`);
  const skippedCustomers = await getSkippedAccountIds(connectionId, workspaceId);

  // ── Step 2: Query each leaf account ────────────────────────────────────────
  for (const { customerId, mccId, descriptiveName } of leafAccounts) {
    if (skippedCustomers.has(customerId)) {
      logger.info(`[syncGoogleAds] Skipping quarantined/reconnect-required customer ${customerId}`);
      children.push({ id: customerId, kind: "customer", ok: true, rowsIngested: 0, skipped: "account_health" });
      continue;
    }

    try {
      logger.info(`[syncGoogleAds] Fetching campaigns for customerId=${customerId} login-customer-id=${mccId} (${descriptiveName})`);

      const rows = await googleAdsReportClient.getCampaignPerformance(
        accessToken,
        customerId,
        dateSpec,
        mccId,
      );

      logger.info(`[syncGoogleAds] customerId=${customerId} returned ${rows.length} campaign rows`);

      if (rows.length === 0) {
        children.push({ id: customerId, kind: "customer", ok: true, rowsIngested: 0 });
        await recordAccountOutcome({
          workspaceId,
          connectionId,
          provider: "google_ads",
          accountId: customerId,
          accountName: descriptiveName,
          ok: true,
        });
        continue;
      }

      // Log first row to diagnose key mapping
      logger.info(`[syncGoogleAds] sample row keys: ${Object.keys(rows[0]).join(", ")}`);
      logger.info(`[syncGoogleAds] sample row: ${JSON.stringify(rows[0]).slice(0, 400)}`);

      const transformedRows = rows.map((r: any) => {
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
          conversion_value:  Number(r.metrics_conversions_value ?? r.metrics_conversion_value ?? r.conversion_value ?? 0),
          currency:          r.customer_currency_code ?? r.currency ?? undefined,
          raw:               r,
        };
      });

      const validRows = transformedRows.filter((r) => !!r.date);
      const skipped = transformedRows.length - validRows.length;
      if (skipped > 0) {
        logger.warn(`[syncGoogleAds] Skipped ${skipped} rows with missing date for customerId=${customerId}`);
      }

      if (validRows.length === 0) {
        children.push({ id: customerId, kind: "customer", ok: true, rowsIngested: 0 });
        await recordAccountOutcome({
          workspaceId,
          connectionId,
          provider: "google_ads",
          accountId: customerId,
          accountName: descriptiveName,
          ok: true,
        });
        continue;
      }

      const result = await ingestGoogleAdsRows(validRows, {
        workspaceId,
        connectionId,
        accountId: customerId,
        accountName: descriptiveName,
        syncJobId: jobId,
        lease,
      });

      logger.info(`[syncGoogleAds] customerId=${customerId} upserted=${result.upserted} failed=${result.failed}`);
      children.push({ id: customerId, kind: "customer", ok: result.failed === 0, rowsIngested: result.upserted, error: result.failed ? `${result.failed} row(s) could not be written` : undefined, retryable: result.failed > 0 });
      await recordAccountOutcome({
        workspaceId,
        connectionId,
        provider: "google_ads",
        accountId: customerId,
        accountName: descriptiveName,
        ok: result.failed === 0,
        retryable: result.failed > 0,
        error: result.failed ? `${result.failed} row(s) could not be written` : undefined,
      });

      // Stale row detection for Google Ads
      if (result.failed === 0 && opts.since && opts.until) {
        try {
          await computeStaleRowStats({
            workspaceId,
            connectionId,
            accountId: customerId,
            level: "campaign",
            since: new Date(`${opts.since}T00:00:00.000Z`),
            until: new Date(`${opts.until}T23:59:59.999Z`),
            providerEntityIds: validRows.map((r) => r.campaign_id),
            fetchComplete: true,
          });
        } catch (reconErr) {
          logger.warn("[syncGoogleAds] Stale-row detection failed (non-fatal):", reconErr);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Google Ads sync failed";
      const isBlockedDevToken = isGoogleAdsDeveloperTokenBlocked(error);
      const isAuth = isBlockedDevToken || /developer.?token|unauthorized|permission.*denied/i.test(msg);
      const gRetryable = isRetryableSyncError(error) && !isAuth;
      children.push({ id: customerId, kind: "customer", ok: false, error: msg, retryable: gRetryable });
      await recordAccountOutcome({
        workspaceId,
        connectionId,
        provider: "google_ads",
        accountId: customerId,
        accountName: descriptiveName,
        ok: false,
        retryable: gRetryable,
        authFailure: isAuth,
        error: msg,
      });

      if (isBlockedDevToken) {
        break; // every remaining customer fails identically
      }
      logger.error(`[syncGoogleAds] Failed for customerId=${customerId}: ${msg}`);
      // Sibling isolation: continue with next account
    }
  }

  const summary = summarizeSyncOutcome(children);
  await persistConnectionSyncOutcome(connectionId, summary, lease);
  logger.info("[syncGoogleAds] Sync outcome", { connectionId, outcome: summary.outcome, targets: children.length, failedTargets: children.filter((child) => !child.ok).map((child) => child.id), rowsIngested: summary.rowsIngested });
  return { ...summary, children };
}

async function syncTikTok(opts: {
  connectionId: string;
  credentials: any;
  workspaceId: string;
  lease: ConnectionLease;
  since?: string;
  until?: string;
  userPlan: string;
  providerState?: ProviderRetryState;
}): Promise<SyncResult> {
  const { connectionId, credentials, workspaceId, lease } = opts;

  let accessToken: string;
  try {
    accessToken = await getValidOAuthToken({
      id: connectionId,
      credentials: encrypt(JSON.stringify(credentials)),
      provider: "tiktok_business",
    });
  } catch (error) {
    const result = makeFailedSyncResult(error instanceof Error ? error.message : "Failed to get valid token", false);
    await persistConnectionSyncOutcome(connectionId, result, lease);
    return result;
  }

  if (!accessToken) {
    const result = makeFailedSyncResult("Failed to get valid token", false);
    await persistConnectionSyncOutcome(connectionId, result, lease);
    return result;
  }

  // TikTok stores advertiserIds in extraFields. A legacy connection identity
  // may be used only when it is itself a valid numeric advertiser ID; opaque
  // UI/source labels must never reach TikTok as `advertiser_id`.
  const extraFields = credentials.extraFields || {};
  let advertiserIds = normalizeTikTokAdvertiserIds(
    extraFields.advertiserIds || credentials.advertiserIds,
  );

  if (!advertiserIds.length) {
    try {
      const connection = await prisma.connection.findUnique({
        where: { id: connectionId },
        select: { remoteAccountId: true },
      });
      const fallbackAdvertiserIds = normalizeTikTokAdvertiserIds([
        connection?.remoteAccountId,
      ]);
      if (fallbackAdvertiserIds.length) {
        advertiserIds = fallbackAdvertiserIds;
        logger.info("[syncTikTok] Resolved validated advertiser ID from the connection identity", {
          connectionId,
        });
      }
    } catch (error) {
      logger.warn("[syncTikTok] Unable to read legacy advertiser identity", { connectionId, error });
    }
  }

  logger.info(`[syncTikTok] Total advertiser IDs:`, advertiserIds.length);
  const skippedAdvertisers = await getSkippedAccountIds(connectionId, workspaceId);

  const selectedIds: string[] | undefined = Array.isArray(extraFields.selectedAdvertiserIds)
    ? extraFields.selectedAdvertiserIds
    : Array.isArray(credentials.selectedAdvertiserIds)
      ? credentials.selectedAdvertiserIds
      : undefined;
  if (selectedIds !== undefined) {
    const selectedAdvertiserIds = new Set(normalizeTikTokAdvertiserIds(selectedIds));
    advertiserIds = advertiserIds.filter((id: string) => selectedAdvertiserIds.has(id));
    logger.info(`[syncTikTok] Filtered to ${advertiserIds.length} selected advertisers`);
  }

  if (!advertiserIds.length) {
    const result = makeFailedSyncResult(TIKTOK_ADVERTISER_RECONNECT_MESSAGE, false);
    await persistConnectionSyncOutcome(connectionId, result, lease);
    return result;
  }

  const jobId = `pipeline-${Date.now()}`;
  const children: SyncChildResult[] = [];

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
    if (skippedAdvertisers.has(String(advertiserId))) {
      logger.info(`[syncTikTok] Skipping quarantined/reconnect-required advertiser ${advertiserId}`);
      children.push({ id: String(advertiserId), kind: "advertiser", ok: true, rowsIngested: 0, skipped: "account_health" });
      continue;
    }

    let reportTaskIdForRetry: string | undefined;
    try {
      const taskParams: CreateReportTaskParams = {
        advertiser_id: advertiserId,
        report_type: "BASIC",
        data_level: "AUCTION_CAMPAIGN",
        dimensions: [...TIKTOK_CAMPAIGN_REPORT_DIMENSIONS],
        metrics: [...TIKTOK_CAMPAIGN_REPORT_METRICS],
        start_date: startDate,
        end_date: endDate,
        page_size: 1000,
      };

      if (credentials.sandbox === true) {
        const rows = await tiktokReportClient.getSyncReport(accessToken, taskParams);
        const result = rows.length > 0
          ? await ingestTiktokRows(rows, { workspaceId, connectionId, accountId: advertiserId, accountName: `Advertiser ${advertiserId}`, syncJobId: jobId, lease })
          : { upserted: 0, failed: 0 };
        children.push({ id: String(advertiserId), kind: "advertiser", ok: result.failed === 0, rowsIngested: result.upserted, error: result.failed ? `${result.failed} row(s) could not be written` : undefined, retryable: result.failed > 0 });
        await recordAccountOutcome({
          workspaceId,
          connectionId,
          provider: "tiktok_business",
          accountId: String(advertiserId),
          accountName: `Advertiser ${advertiserId}`,
          ok: result.failed === 0,
          retryable: result.failed > 0,
          error: result.failed ? `${result.failed} row(s) could not be written` : undefined,
        });
        continue;
      }

      const resumableTaskId = opts.providerState?.provider === "tiktok_business" &&
        opts.providerState.advertiserId === advertiserId &&
        /^\d+$/.test(opts.providerState.reportTaskId)
        ? opts.providerState.reportTaskId
        : undefined;
      const taskId = resumableTaskId ?? await tiktokReportClient.createTask(accessToken, taskParams, false);
      reportTaskIdForRetry = taskId;
      logger.info(resumableTaskId ? "[syncTikTok] Resuming report task" : "[syncTikTok] Created report task", {
        connectionId,
        advertiserId,
        taskId,
      });

      // Poll for completion
      let status = await tiktokReportClient.checkTask(accessToken, advertiserId, taskId, credentials.sandbox === true);
      let attempts = 0;
      while (!isTikTokReportTerminal(status.status) && attempts < 10) {
        logger.info("[syncTikTok] Report task remains non-terminal", {
          connectionId,
          advertiserId,
          taskId,
          status: status.status,
          poll: attempts + 1,
        });
        await new Promise((r) => setTimeout(r, 3000));
        status = await tiktokReportClient.checkTask(accessToken, advertiserId, taskId, credentials.sandbox === true);
        attempts++;
      }

      if (isTikTokReportSuccess(status.status)) {
        const downloadUrl = await tiktokReportClient.getDownloadUrl(
          accessToken,
          advertiserId,
          taskId,
          credentials.sandbox === true,
        );
        const rows = await tiktokReportClient.downloadRows(downloadUrl);

        if (rows.length > 0) {
          const result = await ingestTiktokRows(rows, {
            workspaceId,
            connectionId,
            accountId: advertiserId,
            accountName: `Advertiser ${advertiserId}`,
            syncJobId: jobId,
            lease,
          });

          children.push({ id: String(advertiserId), kind: "advertiser", ok: result.failed === 0, rowsIngested: result.upserted, error: result.failed ? `${result.failed} row(s) could not be written` : undefined, retryable: result.failed > 0 });
          await recordAccountOutcome({
            workspaceId,
            connectionId,
            provider: "tiktok_business",
            accountId: String(advertiserId),
            accountName: `Advertiser ${advertiserId}`,
            ok: result.failed === 0,
            retryable: result.failed > 0,
            error: result.failed ? `${result.failed} row(s) could not be written` : undefined,
          });

          // Stale row detection for TikTok
          if (result.failed === 0 && startDate && endDate) {
            try {
              await computeStaleRowStats({
                workspaceId,
                connectionId,
                accountId: String(advertiserId),
                level: "campaign",
                since: new Date(`${startDate}T00:00:00.000Z`),
                until: new Date(`${endDate}T23:59:59.999Z`),
                providerEntityIds: rows.map((r: any) => String(r.campaign_id ?? r.id ?? "")).filter(Boolean),
                fetchComplete: true,
              });
            } catch (reconErr) {
              logger.warn("[syncTikTok] Stale-row detection failed (non-fatal):", reconErr);
            }
          }
        } else {
          children.push({ id: String(advertiserId), kind: "advertiser", ok: true, rowsIngested: 0 });
          await recordAccountOutcome({
            workspaceId,
            connectionId,
            provider: "tiktok_business",
            accountId: String(advertiserId),
            accountName: `Advertiser ${advertiserId}`,
            ok: true,
          });
        }
      } else if (isTikTokReportTerminal(status.status)) {
        throw new Error(`TikTok report task ${taskId} ended with status ${status.status}`);
      } else {
        const message = `TikTok report task ${taskId} is still ${status.status}; Monstera will resume this task automatically`;
        children.push({
          id: String(advertiserId),
          kind: "advertiser",
          ok: false,
          error: message,
          retryable: true,
          retryState: {
            provider: "tiktok_business",
            advertiserId: String(advertiserId),
            reportTaskId: taskId,
          },
        });
      }
    } catch (error) {
      logger.error(`[TikTok Sync] Failed for advertiser ${advertiserId}:`, error);
      const message = error instanceof Error ? error.message : "TikTok sync failed";
      const isAuth = /token|auth|unauthorized|permission/i.test(message);
      const retryable = (isRetryableSyncError(error) || /did not complete before/i.test(message)) && !isAuth;
      children.push({
        id: String(advertiserId),
        kind: "advertiser",
        ok: false,
        error: message,
        retryable,
        ...(retryable && reportTaskIdForRetry
          ? {
              retryState: {
                provider: "tiktok_business" as const,
                advertiserId: String(advertiserId),
                reportTaskId: reportTaskIdForRetry,
              },
            }
          : {}),
      });
      await recordAccountOutcome({
        workspaceId,
        connectionId,
        provider: "tiktok_business",
        accountId: String(advertiserId),
        accountName: `Advertiser ${advertiserId}`,
        ok: false,
        retryable,
        authFailure: isAuth,
        error: message,
      });
      // Sibling isolation: continue with next advertiser
    }
  }

  const summary = summarizeSyncOutcome(children);
  await persistConnectionSyncOutcome(connectionId, summary, lease);
  logger.info("[syncTikTok] Sync outcome", { connectionId, outcome: summary.outcome, targets: children.length, failedTargets: children.filter((child) => !child.ok).map((child) => child.id), rowsIngested: summary.rowsIngested });
  return { ...summary, children };
}

function isTikTokReportSuccess(status: string): boolean {
  // v1.3 uses SUCCESS; COMPLETED remains accepted for older task responses.
  return status === "SUCCESS" || status === "COMPLETED";
}

function isTikTokReportTerminal(status: string): boolean {
  return isTikTokReportSuccess(status) || status === "FAILED" || status === "CANCELED";
}
