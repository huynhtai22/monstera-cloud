import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { queryWarehouse } from "@/lib/warehouse-query";
import { getGoogleIdTokenAudienceAllowlist, verifyGoogleIdToken } from "@/lib/google-id-token";

const HEADERS = [
  "date",
  "platform",
  "account_id",
  "account_name",
  "campaign_id",
  "campaign_name",
  "impressions",
  "clicks",
  "spend",
  "reach",
  "conversions",
  "revenue",
  "roas",
  "currency",
];

const PLATFORM_BY_SOURCE: Record<string, string> = {
  meta_ads: "meta_ads",
  google_ads: "google_ads",
  tiktok_ads: "tiktok_business",
  tiktok_business: "tiktok_business",
  tiktok_gmv_max: "tiktok_gmv_max",
  shopee: "shopee",
};

const GMV_MAX_HEADERS = [
  "date",
  "store_id",
  "campaign_id",
  "item_id",
  "gmv_max_cost",
  "gmv_max_gross_revenue",
  "gmv_max_orders",
  "gmv_max_roi",
];

function parseDate(value: unknown, endOfDay = false): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { googleToken, workspaceId, source, connectionId, start_date, end_date, cursor } = body;
    if (!googleToken) return NextResponse.json({ error: "Missing Google token" }, { status: 400 });
    if (!workspaceId || typeof workspaceId !== "string") {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const verification = await verifyGoogleIdToken(googleToken, {
      audiences: getGoogleIdTokenAudienceAllowlist(),
    });
    if (!verification) {
      return NextResponse.json({ error: "invalid_token", message: "Google token expired. Reopen the add-on." }, { status: 401 });
    }

    const membership = await prisma.workspaceMember.findFirst({
      where: { workspaceId, user: { email: verification.email } },
      select: { userId: true },
    });
    if (!membership) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    // Handle dedicated TikTok GMV Max delivery
    if (source === "tiktok_gmv_max") {
      if (connectionId) {
        const connection = await prisma.connection.findFirst({
          where: { id: connectionId, workspaceId },
          select: { id: true },
        });
        if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
      }

      const startDate = parseDate(start_date);
      const endDate = parseDate(end_date, true);

      const where: any = { workspaceId };
      if (connectionId) where.connectionId = connectionId;
      if (startDate || endDate) {
        where.date = {
          ...(startDate ? { gte: startDate } : {}),
          ...(endDate ? { lte: endDate } : {}),
        };
      }

      const gmvRows = await prisma.tikTokGmvMaxMetric.findMany({
        where,
        orderBy: [{ date: "desc" }, { id: "asc" }],
        take: 100_000,
      });

      const rows = gmvRows.map((row) => [
        row.date.toISOString().slice(0, 10),
        row.storeId,
        row.campaignId,
        row.itemId || row.liveRoomId || "",
        row.gmvMaxCost,
        row.gmvMaxGrossRevenue,
        row.gmvMaxOrders,
        row.gmvMaxRoi,
      ]);

      return NextResponse.json({
        tabName: "TikTok GMV Max",
        disclaimer: "Product GMV Max uses 1-day blended attribution (paid + organic + affiliate). Do not compare with standard ad ROAS.",
        headers: GMV_MAX_HEADERS,
        rows,
        totalRows: rows.length,
        truncated: false,
        nextCursor: null,
        asOf: new Date().toISOString(),
        freshness: gmvRows[0]?.ingestedAt ? "fresh" : "never",
      });
    }

    const platform = typeof source === "string" ? PLATFORM_BY_SOURCE[source] : undefined;
    if (source && !platform) return NextResponse.json({ error: `Unsupported source: ${source}` }, { status: 400 });

    if (connectionId) {
      const connection = await prisma.connection.findFirst({
        where: { id: connectionId, workspaceId, ...(platform ? { provider: platform } : {}) },
        select: { id: true },
      });
      if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const result = await queryWarehouse({
      workspaceId,
      startDate: parseDate(start_date),
      endDate: parseDate(end_date, true),
      platforms: platform ? [platform] : undefined,
      accountIds: body.accountId ? [String(body.accountId)] : undefined,
      cursor: typeof cursor === "string" ? cursor : undefined,
      limit: 100_000,
      includeTotalCount: true,
    });

    const rows = result.rows.map((row) => [
      row.date.toISOString().slice(0, 10),
      row.platform,
      row.accountId,
      row.accountName ?? "",
      row.campaignId,
      row.campaignName,
      row.impressions,
      row.clicks,
      row.spend,
      row.reach,
      row.conversions,
      row.revenue,
      row.roas,
      row.currency ?? "",
    ]);

    return NextResponse.json({
      headers: HEADERS,
      rows,
      totalRows: result.totalCount ?? rows.length,
      truncated: result.pagination.hasMore,
      nextCursor: result.pagination.nextCursor,
      asOf: result.asOf,
      freshness: result.freshness,
    });
  } catch (error) {
    logger.error("[SHEETS_QUERY]", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
