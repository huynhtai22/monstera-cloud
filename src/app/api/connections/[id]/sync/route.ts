/**
 * POST /api/connections/[id]/sync
 * 
 * Manual sync trigger for data platforms (Meta Ads, Google Ads, TikTok, Shopee, Lazada).
 * Ingests recent metrics into CampaignMetric / RetailOrder warehouse tables.
 */

import { NextResponse } from "next/server";
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

    // Parse credentials
    const credentials = parseConnectionCredentialsJson(
      safeDecrypt(connection.credentials)
    ) as Record<string, unknown>;

    // Force unlock: clear any existing locks before starting
    if (force && connection.provider === "meta_ads") {
      logger.info(`[Sync Route] Force unlock requested for connection ${connectionId}`);
      const scopePrefix = `meta_ads:${connection.workspaceId}:${connectionId}:`;
      try {
        await prisma.$executeRaw`DELETE FROM "SyncLock" WHERE scope LIKE ${scopePrefix + '%'}`;
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

    if (!syncResult.success) {
      return NextResponse.json(
        { error: syncResult.error || "Sync failed", code: "SYNC_FAILED" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
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
