import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { syncMetaInsightsIntoWarehouse } from "@/lib/ingestion/meta-campaign-metrics";
import { logger } from "@/lib/logger";

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
    adAccountId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { workspaceId, connectionId, since, until, adAccountId } = body;
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

  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId, userId: session.user.id },
    },
  });
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true },
  });
  const plan = user?.plan ?? "free";

  try {
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
      upserted: result.upserted,
      accounts: result.accounts,
      columns: [...WAREHOUSE_COLUMN_LIST],
      message: `Imported ${result.upserted} campaign-day rows from ${result.accounts} ad account(s).`,
    });
  } catch (e: any) {
    logger.error("[warehouse/import]", e);
    return NextResponse.json(
      { error: e?.message ?? "Import failed" },
      { status: 500 },
    );
  }
}
