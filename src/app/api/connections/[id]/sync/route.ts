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

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: connectionId } = await context.params;
    if (!connectionId) {
      return NextResponse.json({ error: "Missing connection id" }, { status: 400 });
    }

    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
      include: { workspace: { select: { id: true, ownerId: true } } },
    });

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // RBAC check
    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: connection.workspaceId,
          userId: session.user.id,
        },
      },
    });
    if (!membership) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Only for ad platforms that use CampaignMetric
    if (!["meta_ads", "google_ads", "tiktok_business"].includes(connection.provider)) {
      return NextResponse.json(
        { error: "Use pipeline sync for this connection type" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { plan: true },
    });
    const limits = getPlanLimits(user?.plan ?? "free");

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

      // Get ad accounts from credentials
      const adAccounts = credentials.adAccounts || 
        (credentials.adAccountIds || []).map((id: string) => ({ id, name: id }));

      if (!adAccounts?.length) {
        return NextResponse.json({ error: "No ad accounts configured" }, { status: 400 });
      }

      const jobId = `manual-${Date.now()}`;
      let totalRows = 0;

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
      await prisma.connection.update({
        where: { id: connectionId },
        data: { lastSyncAt: new Date() },
      });

      return NextResponse.json({
        success: true,
        rowsIngested: totalRows,
        message: `Synced ${totalRows} rows from Meta Ads`,
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

      // Get customer IDs from credentials
      const customerIds = credentials.customerIds || [];
      if (!customerIds.length) {
        return NextResponse.json({ error: "No customer accounts configured" }, { status: 400 });
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
      await prisma.connection.update({
        where: { id: connectionId },
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

      // Get advertiser IDs from credentials
      const advertiserIds = credentials.advertiserIds || [];
      if (!advertiserIds.length) {
        return NextResponse.json({ error: "No advertisers configured" }, { status: 400 });
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
            // Download and parse report
            const reportRes = await fetch(status.url);
            const reportText = await reportRes.text();
            const reportRows = reportText.split("\n").filter((l) => l.trim()).slice(1); // Skip header

            // Parse CSV-like format (simplified)
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
      await prisma.connection.update({
        where: { id: connectionId },
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
