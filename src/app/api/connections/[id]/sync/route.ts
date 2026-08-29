/**
 * POST /api/connections/[id]/sync
 * 
 * Manual sync trigger for data platforms (Meta Ads, Google Ads, TikTok, Shopee, Lazada).
 * Ingests recent metrics into CampaignMetric / RetailOrder warehouse tables.
 */

import { NextResponse, after } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plan-config";
import { logger } from "@/lib/logger";
import { safeDecrypt } from "@/lib/encryption";
import { parseConnectionCredentialsJson } from "@/lib/parse-connection-credentials";
import { syncConnectionData } from "@/lib/sync-connection";
import { requireWorkspaceAccess } from "@/lib/rbac";
import { assertWorkspaceProviderEnabled } from "@/lib/workspace-provider-access";
import { isConnectionSyncBlocked } from "@/lib/connection-lifecycle";
import { createImportJob, claimImportJob } from "@/lib/warehouse-import-job";
import { runDurableImportWorker } from "@/app/api/data-explorer/warehouse/import-batch/route";

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

    if (isConnectionSyncBlocked(connection.status)) {
      return NextResponse.json(
        {
          error: "This source is disconnected. Reconnect it to resume syncing.",
          code: "CONNECTION_DISCONNECTED",
        },
        { status: 409 }
      );
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

    const limits = getPlanLimits(connection.workspace.plan);

    // Check sync cooldown (bypass if force is true)
    if (!force && connection.lastSyncAt) {
      const msSinceLast = Date.now() - connection.lastSyncAt.getTime();
      if (msSinceLast < limits.syncIntervalMs) {
        const waitMin = Math.ceil((limits.syncIntervalMs - msSinceLast) / 60000);
        return NextResponse.json(
          {
            error: `Sync cooldown active. Wait ${waitMin} more minute(s) or use Force Sync.`,
            code: "SYNC_COOLDOWN",
          },
          { status: 429 }
        );
      }
    }

    // TikTok report generation is asynchronous and may legitimately remain
    // PROCESSING beyond one serverless request. Queue it in the durable worker
    // so the report task ID can be retained and resumed across bounded retries.
    if (connection.provider === "tiktok_business") {
      const until = new Date().toISOString().split("T")[0];
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const job = await createImportJob({
        workspaceId: connection.workspaceId,
        userId: session.user.id,
        plan: connection.workspace.plan,
        since,
        until,
        items: [{ connectionId }],
        // Keep one active manual job per connection for its entire lifetime.
        // The worker releases this key only when the job becomes terminal.
        idempotencyKey: `manual-tiktok:${connectionId}`,
        priority: limits.priority,
      });
      after(async () => {
        try {
          const claim = await claimImportJob(job.id);
          if (claim.claimed && claim.leaseId) {
            await runDurableImportWorker(job.id, claim.leaseId);
          }
        } catch (workerError) {
          logger.error("[TikTok Manual Sync] Durable worker failed", workerError);
        }
      });
      return NextResponse.json({
        success: true,
        outcome: "queued",
        code: "SYNC_QUEUED",
        jobId: job.id,
        message: "TikTok sync queued. Monstera will resume any report task that remains processing.",
      }, { status: 202 });
    }

    // Parse credentials
    const credentials = parseConnectionCredentialsJson(
      safeDecrypt(connection.credentials)
    ) as Record<string, unknown>;

    // Force unlock: expire any existing leases before starting. Rows are kept
    // (status flipped + expiry zeroed) so fencingToken stays monotonic across
    // unlock generations; the next claim increments it rather than restarting.
    if (force && connection.provider === "meta_ads") {
      logger.info(`[Sync Route] Force unlock requested for connection ${connectionId}`);
      const scopePrefix = `meta_ads:${connection.workspaceId}:${connectionId}:`;
      try {
        await prisma.syncLock.updateMany({
          where: { scope: { startsWith: scopePrefix } },
          data: {
            status: "released",
            heartbeatAt: new Date(),
            leaseExpiresAt: new Date(0),
          },
        });
      } catch (lockErr) {
        logger.warn(`[Sync Route] Failed to clear locks during force unlock:`, lockErr);
      }
    }

    // Execute unified sync runner with multi-tier dynamic account discovery
    const syncResult = await syncConnectionData({
      connectionId,
      provider: connection.provider,
      credentials,
      workspaceId: connection.workspaceId,
      userPlan: connection.workspace.plan,
    });

    if (syncResult.outcome === "partial") {
      return NextResponse.json({
        success: false,
        outcome: "partial",
        rowsIngested: syncResult.rowsIngested,
        failedTargets: syncResult.children.filter((child) => !child.ok).map((child) => child.id),
        error: syncResult.error || "One or more requested provider accounts failed to sync",
        code: "SYNC_PARTIAL",
      }, { status: 207 });
    }

    if (!syncResult.success) {
      return NextResponse.json(
        { error: syncResult.error || "Sync failed", code: "SYNC_FAILED", outcome: "failed" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      outcome: "success",
      rowsIngested: syncResult.rowsIngested,
      message: `Synced ${syncResult.rowsIngested} rows from ${connection.name || connection.provider}`,
    });
  } catch (error: any) {
    logger.error("[POST /api/connections/[id]/sync] Error:", error);
    return NextResponse.json(
      { error: error.message || "Sync failed" },
      { status: 500 }
    );
  }
}
