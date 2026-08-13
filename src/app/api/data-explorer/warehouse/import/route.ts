import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { syncMetaInsightsIntoWarehouse } from "@/lib/ingestion/meta-campaign-metrics";
import { syncGoogleAdsIntoWarehouse, syncTikTokIntoWarehouse } from "@/lib/ingestion/ad-platform-warehouse";
import { logger } from "@/lib/logger";
import { decrypt } from "@/lib/encryption";
import { requireWorkspaceAccess } from "@/lib/rbac";

const WAREHOUSE_COLUMN_LIST = [
  "date",
  "platform",
  "accountId",
  "accountName",
  "campaignId",
  "campaignName",
  "impressions",
  "clicks",
  "spend",
  "cpc",
  "ctr",
  "conversions",
  "roas",
  "currency",
] as const;

/**
 * POST /api/data-explorer/warehouse/import
 * Body: { workspaceId, connectionId, since, until, adAccountId? }
 * Pulls Meta Insights into CampaignMetric (internal warehouse).
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    workspaceId?: string;
    connectionId?: string;
    since?: string;
    until?: string;
    adAccountId?: string; // meta
    accountId?: string; // google/tiktok
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { workspaceId, connectionId, since, until, adAccountId, accountId } = body;
  if (!workspaceId || !connectionId || !since || !until) {
    return NextResponse.json(
      { error: "workspaceId, connectionId, since, until are required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(since) || !dateRe.test(until)) {
    return NextResponse.json(
      { error: "since and until must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "member", operation: "import_warehouse" });
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  const plan = workspace?.plan ?? "pilot";

  try {
    const conn = await prisma.connection.findFirst({
      where: { id: connectionId, workspaceId, type: "source" },
      select: { provider: true, credentials: true },
    });
    if (!conn) {
      return NextResponse.json({ error: "Connection not found in workspace" }, { status: 404 });
    }

    const provider = conn.provider;

    if (provider === "meta_ads") {
      const result = await syncMetaInsightsIntoWarehouse({
        workspaceId,
        connectionId,
        since,
        until,
        userPlan: plan,
        adAccountId: adAccountId || undefined,
      });

      return NextResponse.json({
        success: true,
        provider,
        upserted: result.upserted,
        accounts: result.accounts,
        columns: [...WAREHOUSE_COLUMN_LIST],
        message: `Imported ${result.upserted} campaign-day rows from ${result.accounts} ad account(s).`,
      });
    }

    // Other ad platforms: decrypt credentials here and use simple upserts.
    const credentials = JSON.parse(decrypt(conn.credentials));

    if (provider === "google_ads") {
      const result = await syncGoogleAdsIntoWarehouse({
        workspaceId,
        connectionId,
        credentials,
        since,
        until,
        customerId: accountId || undefined,
      });

      return NextResponse.json({
        success: true,
        provider,
        upserted: result.upserted,
        accounts: result.accounts,
        failed: result.failed,
        columns: [...WAREHOUSE_COLUMN_LIST],
        message: `Imported ${result.upserted} campaign-day rows from ${result.accounts} customer account(s).`,
      });
    }

    if (provider === "tiktok_business") {
      const result = await syncTikTokIntoWarehouse({
        workspaceId,
        connectionId,
        credentials,
        since,
        until,
        advertiserId: accountId || undefined,
      });

      return NextResponse.json({
        success: true,
        provider,
        upserted: result.upserted,
        accounts: result.accounts,
        failed: result.failed,
        columns: [...WAREHOUSE_COLUMN_LIST],
        message: `Imported ${result.upserted} campaign-day rows from ${result.accounts} advertiser account(s).`,
      });
    }

    return NextResponse.json(
      { error: `Provider not supported for warehouse import: ${provider}` },
      { status: 400 },
    );
  } catch (e: any) {
    logger.error("[warehouse/import]", e);
    const msg =
      e instanceof Error ? e.message : typeof e === "string" ? e : "Import failed";
    const hint =
      msg.includes("credentials") || msg.includes("JSON") || msg.includes("parse")
        ? " If this persists, disconnect Meta under Sources and connect again."
        : "";
    return NextResponse.json({ error: `${msg}${hint}` }, { status: 500 });
  }
}
