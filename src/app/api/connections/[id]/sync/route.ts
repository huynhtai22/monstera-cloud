/**
 * POST /api/connections/[id]/sync
 * 
 * Manual sync trigger for ad platforms (Meta Ads, Google Ads, TikTok).
 * Unlike e-commerce platforms that extract directly to Sheets, ad platforms:
 *   1. Fetch from API → Save to CampaignMetric (internal DB)
 *   2. Then pipeline reads from CampaignMetric → Sends to destination
 * 
 * This endpoint handles step 1 for manual syncs.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plan-config";
import { logger } from "@/lib/logger";
import { safeDecrypt } from "@/lib/encryption";
import { ingestMetaRows } from "@/lib/meta-ingest";
import { metaReportClient, META_DEFAULT_FIELDS } from "@/lib/meta-ads";
import { googleAdsReportClient } from "@/lib/google-ads";
import { tiktokReportClient } from "@/lib/tiktok-business";
import { ingestGoogleAdsRows, ingestTiktokRows } from "@/lib/ad-platform-ingest";
import { getValidOAuthToken } from "@/lib/oauth-framework/token-refresh";
import {
  acquireMetaSyncLock,
  releaseMetaSyncLock,
} from "@/lib/meta-sync-lock";
import { requireWorkspaceAccess } from "@/lib/rbac";
import { assertWorkspaceProviderEnabled } from "@/lib/workspace-provider-access";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check for force unlock parameter
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";

  try {
    const { id: connectionId } = await context.params;
    if (!connectionId) {
      return NextResponse.json({ error: "Missing connection id" }, { status: 400 });
    }

    const connection = await prisma.connection.findFirst({
      where: { id: connectionId, workspace: { members: { some: { userId: session.user.id } } } },
      include: { workspace: { select: { id: true, ownerId: true, plan: true } } },
    });

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId: connection.workspaceId,
      minimumRole: force ? "admin" : "member",
      operation: force ? "force_unlock_connection" : "manual_sync",
    });
    await assertWorkspaceProviderEnabled({
      workspaceId: connection.workspaceId,
      provider: connection.provider,
    });

    // Only for ad platforms that use CampaignMetric
    if (!["meta_ads", "google_ads", "tiktok_business"].includes(connection.provider)) {
      return NextResponse.json(
        { error: "Use pipeline sync for this connection type" },
        { status: 400 }
      );
    }

    const limits = getPlanLimits(connection.workspace.plan);

    // Check sync cooldown
    if (connection.lastSyncAt) {
      const msSinceLast = Date.now() - connection.lastSyncAt.getTime();
      if (msSinceLast < limits.syncIntervalMs) {
        const waitMin = Math.ceil((limits.syncIntervalMs - msSinceLast) / 60000);
        return NextResponse.json(
          {
            error: `Sync cooldown active. Wait ${waitMin} more minute(s).`,
            code: "SYNC_COOLDOWN",
          },
          { status: 429 }
        );
      }
    }

    // Parse credentials
    const credentials = JSON.parse(
      safeDecrypt(connection.credentials)
    );

    if (connection.provider === "meta_ads") {
      // Get valid token
      const accessToken = await getValidOAuthToken({
        id: connectionId,
        credentials: connection.credentials,
        provider: connection.provider,
      });
      if (!accessToken) {
        return NextResponse.json({ error: "Failed to get valid token" }, { status: 401 });
      }

      // Get ad accounts from extraFields (where OAuth adapter stores them)
      const extraFields = credentials.extraFields || {};
      let adAccounts = extraFields.adAccounts || 
        (extraFields.adAccountIds || []).map((id: string) => ({ id, name: id }));
      
      // Filter to selected accounts if selection exists
      const selectedIds = extraFields.selectedAdAccountIds || credentials.selectedAdAccountIds;
      if (selectedIds?.length > 0) {
        adAccounts = adAccounts.filter((acc: any) => selectedIds.includes(acc.id));
        logger.info(`[Meta Sync] Filtered to ${adAccounts.length} selected accounts`);
      }

      logger.info(`[Meta Sync] Will sync ${adAccounts.length} ad accounts`);

      if (!adAccounts?.length) {
        return NextResponse.json({ error: "No ad accounts configured" }, { status: 400 });
      }

      const jobId = `manual-${Date.now()}`;
      let totalRows = 0;

      // Force unlock: clear any existing locks before starting
      if (force) {
        logger.info(`[Meta Sync] Force unlock requested, clearing locks for ${adAccounts.length} accounts`);
        for (const account of adAccounts) {
          const scope = `meta_ads:${connection.workspaceId}:${connectionId}:${account.id}`;
          await prisma.$executeRaw`DELETE FROM "SyncLock" WHERE scope = ${scope}`;
          logger.info(`[Meta Sync] Cleared lock for ${scope}`);
        }
      }

      // Sync each ad account
      for (const account of adAccounts) {
        const accountId = account.id;
        const accountName = account.name;

        // Acquire sync lock
        const lockResult = await acquireMetaSyncLock({
          workspaceId: connection.workspaceId,
          connectionId,
          adAccountId: accountId,
          jobId,
        });

        if (!lockResult.acquired) {
          const reason = lockResult.reason === 'active' 
            ? 'A sync is already running for this account'
            : 'Database lock is busy';
          logger.warn(`[Meta Sync] Could not acquire lock for ${accountId}: ${reason}`);
          
          // Return error so user can force unlock
          if (lockResult.reason === 'active') {
            return NextResponse.json({
              error: `A sync is already queued or running for this account (${accountId}). Wait for it to complete or use Force Unlock.`,
              code: 'SYNC_ACTIVE',
              accountId,
            }, { status: 423 });
          }
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
            timeIncrement: 1, // Daily
          });

          if (rows.length > 0) {
            // Ingest to CampaignMetric
            const result = await ingestMetaRows({
              workspaceId: connection.workspaceId,
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
        } catch (error) {
          logger.error(`[Meta Sync] Failed for account ${accountId}:`, error);
          await releaseMetaSyncLock({ scope: lock.scope, leaseId: lock.leaseId, success: false });
          throw error;
        } finally {
          // Release lock on success
          await releaseMetaSyncLock({ scope: lock.scope, leaseId: lock.leaseId, success: true });
        }
      }

      // Update connection sync time
      await prisma.connection.updateMany({
        where: { id: connectionId, workspaceId: connection.workspaceId },
        data: { lastSyncAt: new Date() },
      });

      return NextResponse.json({
        success: true,
        rowsIngested: totalRows,
        message: `Synced ${totalRows} rows from Meta Ads`,
        jobId,
      });
    }

    // Handle Google Ads sync
    if (connection.provider === "google_ads") {
      const accessToken = await getValidOAuthToken({
        id: connectionId,
        credentials: connection.credentials,
        provider: connection.provider,
      });
      if (!accessToken) {
        return NextResponse.json({ error: "Failed to get valid token" }, { status: 401 });
      }

      // Get customer IDs from credentials - use selected or all if none selected
      let customerIds = credentials.customerIds || [];
      
      // Filter to selected customers if selection exists
      if (credentials.selectedCustomerIds?.length > 0) {
        customerIds = customerIds.filter((id: string) => 
          credentials.selectedCustomerIds.includes(id)
        );
      }
      
      if (!customerIds.length) {
        return NextResponse.json({ error: "No customer accounts selected for sync" }, { status: 400 });
      }

      const jobId = `manual-${Date.now()}`;
      let totalRows = 0;

      // Sync each customer account
      for (const customerId of customerIds) {
        try {
          // Fetch campaign performance from Google Ads API
          const rows = await googleAdsReportClient.getCampaignPerformance(
            accessToken,
            customerId,
            "LAST_30_DAYS",
            credentials.mccId
          );

          if (rows.length > 0) {
            // Transform to expected format
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

            // Ingest to CampaignMetric
            const result = await ingestGoogleAdsRows(transformedRows, {
              workspaceId: connection.workspaceId,
              connectionId,
              accountId: customerId,
              accountName: `Customer ${customerId}`,
              syncJobId: jobId,
            });

            totalRows += result.upserted;
          }
        } catch (error) {
          logger.error(`[Google Ads Sync] Failed for customer ${customerId}:`, error);
          // Continue with next account
        }
      }

      // Update connection sync time
      await prisma.connection.updateMany({
        where: { id: connectionId, workspaceId: connection.workspaceId },
        data: { lastSyncAt: new Date() },
      });

      return NextResponse.json({
        success: true,
        rowsIngested: totalRows,
        message: `Synced ${totalRows} rows from Google Ads`,
      });
    }

    // Handle TikTok sync
    if (connection.provider === "tiktok_business") {
      const accessToken = await getValidOAuthToken({
        id: connectionId,
        credentials: connection.credentials,
        provider: connection.provider,
      });
      if (!accessToken) {
        return NextResponse.json({ error: "Failed to get valid token" }, { status: 401 });
      }

      // Get advertiser IDs from credentials - use selected or all if none selected
      let advertiserIds = credentials.advertiserIds || [];
      
      // Filter to selected advertisers if selection exists
      if (credentials.selectedAdvertiserIds?.length > 0) {
        advertiserIds = advertiserIds.filter((id: string) => 
          credentials.selectedAdvertiserIds.includes(id)
        );
      }
      
      if (!advertiserIds.length) {
        return NextResponse.json({ error: "No advertisers selected for sync" }, { status: 400 });
      }

      const jobId = `manual-${Date.now()}`;
      let totalRows = 0;

      // Calculate date range (last 30 days)
      const endDate = new Date().toISOString().split("T")[0];
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      // Sync each advertiser
      for (const advertiserId of advertiserIds) {
        try {
          // Create async report task
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

          // Poll for completion (simple version - up to 30 seconds)
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
              // Ingest to CampaignMetric
              const result = await ingestTiktokRows(rows, {
                workspaceId: connection.workspaceId,
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
          // Continue with next advertiser
        }
      }

      // Update connection sync time
      await prisma.connection.updateMany({
        where: { id: connectionId, workspaceId: connection.workspaceId },
        data: { lastSyncAt: new Date() },
      });

      return NextResponse.json({
        success: true,
        rowsIngested: totalRows,
        message: `Synced ${totalRows} rows from TikTok Ads`,
      });
    }

    // Should not reach here
    return NextResponse.json(
      { error: `${connection.provider} sync not supported` },
      { status: 501 }
    );
  } catch (error: any) {
    logger.error("[POST /api/connections/[id]/sync] Error:", error);
    return NextResponse.json(
      { error: error.message || "Sync failed" },
      { status: 500 }
    );
  }
}
