import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getValidShopeeCreds, shopeeDataClient } from "@/lib/shopee";
import { assertShopeeRegionEligible } from "@/lib/provider-market-policy";
import prisma from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get("connectionId");
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
  }

  const startDateStr = searchParams.get("startDate") || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const endDateStr = searchParams.get("endDate") || new Date().toISOString().slice(0, 10);

  const connection = await prisma.connection.findFirst({
    where: {
      id: connectionId,
      provider: "shopee",
      workspace: { members: { some: { userId: session.user.id } } },
    },
    select: { id: true, workspaceId: true, remoteAccountId: true, name: true },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  try {
    const creds = await getValidShopeeCreds(connection.id);
    const apiOpts = {
      accessToken: creds.access_token,
      shopId: creds.shop_id,
      sandbox: creds.sandbox === true,
    };

    // Verify Vietnam region eligibility
    const shopInfo = await shopeeDataClient.getShopInfo(apiOpts);
    assertShopeeRegionEligible(shopInfo.region, "ads_reporting");

    const start = new Date(`${startDateStr}T00:00:00.000Z`);
    const end = new Date(`${endDateStr}T23:59:59.999Z`);

    // Query CampaignMetric rows for this connection
    const metrics = await prisma.campaignMetric.findMany({
      where: {
        connectionId: connection.id,
        platform: "shopee",
        date: { gte: start, lte: end },
      },
      orderBy: [{ date: "desc" }, { campaignName: "asc" }],
    });

    let totalImpressions = 0;
    let totalClicks = 0;
    let totalSpend = 0;
    let totalBroadOrders = 0;
    let totalBroadUnits = 0;
    let totalBroadGmv = 0;
    let totalDirectOrders = 0;
    let totalDirectUnits = 0;
    let totalDirectGmv = 0;

    const formattedRows = metrics.map((m) => {
      totalImpressions += m.impressions;
      totalClicks += m.clicks;
      totalSpend += m.spend;

      let rawObj: any = {};
      if (m.rawData) {
        try {
          rawObj = typeof m.rawData === "string" ? JSON.parse(m.rawData) : m.rawData;
        } catch {
          rawObj = {};
        }
      }

      const broadMetrics = rawObj.broad_metrics || {};
      const directMetrics = rawObj.direct_metrics || {};

      const broadOrders = Number(broadMetrics.orders ?? m.conversions);
      const broadUnits = Number(broadMetrics.units_sold ?? broadOrders);
      const broadGmv = Number(broadMetrics.gmv ?? m.revenue);
      const directOrders = Number(directMetrics.orders ?? 0);
      const directUnits = Number(directMetrics.units_sold ?? 0);
      const directGmv = Number(directMetrics.gmv ?? 0);

      totalBroadOrders += broadOrders;
      totalBroadUnits += broadUnits;
      totalBroadGmv += broadGmv;
      totalDirectOrders += directOrders;
      totalDirectUnits += directUnits;
      totalDirectGmv += directGmv;

      return {
        id: m.id,
        date: m.date.toISOString().slice(0, 10),
        level: m.level,
        campaignId: m.campaignId,
        campaignName: m.campaignName,
        adId: m.adId,
        adName: m.adsetName,
        impressions: m.impressions,
        clicks: m.clicks,
        ctr: m.ctr,
        spend: m.spend,
        cpc: m.cpc,
        broadOrders,
        broadUnits,
        broadGmv,
        broadRoas: m.spend > 0 ? broadGmv / m.spend : 0,
        broadAcos: broadGmv > 0 ? m.spend / broadGmv : 0,
        broadCr: m.clicks > 0 ? broadOrders / m.clicks : 0,
        broadCostPerConversion: broadOrders > 0 ? m.spend / broadOrders : 0,
        directOrders,
        directUnits,
        directGmv,
        directRoas: m.spend > 0 ? directGmv / m.spend : 0,
        directAcos: directGmv > 0 ? m.spend / directGmv : 0,
        directCr: m.clicks > 0 ? directOrders / m.clicks : 0,
        directCostPerConversion: directOrders > 0 ? m.spend / directOrders : 0,
        currency: m.currency || "VND",
        keywordSettingsCount: rawObj.keyword_settings_count ?? 0,
      };
    });

    const summary = {
      impressions: totalImpressions,
      clicks: totalClicks,
      ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
      spend: totalSpend,
      cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
      broadOrders: totalBroadOrders,
      broadUnits: totalBroadUnits,
      broadGmv: totalBroadGmv,
      broadRoas: totalSpend > 0 ? totalBroadGmv / totalSpend : 0,
      broadAcos: totalBroadGmv > 0 ? totalSpend / totalBroadGmv : 0,
      broadCr: totalClicks > 0 ? totalBroadOrders / totalClicks : 0,
      broadCostPerConversion: totalBroadOrders > 0 ? totalSpend / totalBroadOrders : 0,
      directOrders: totalDirectOrders,
      directUnits: totalDirectUnits,
      directGmv: totalDirectGmv,
      directRoas: totalSpend > 0 ? totalDirectGmv / totalSpend : 0,
      directAcos: totalDirectGmv > 0 ? totalSpend / totalDirectGmv : 0,
      directCr: totalClicks > 0 ? totalDirectOrders / totalClicks : 0,
      directCostPerConversion: totalDirectOrders > 0 ? totalSpend / totalDirectOrders : 0,
      currency: "VND",
    };

    return NextResponse.json({
      shopId: creds.shop_id,
      shopName: shopInfo.shop_name,
      region: shopInfo.region,
      startDate: startDateStr,
      endDate: endDateStr,
      summary,
      rows: formattedRows,
      totalRows: formattedRows.length,
      keywordLimitationNote:
        "Shopee API exposes keyword configuration (selected keywords, bids, match types) but does not provide keyword-level performance metrics.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to fetch Shopee Ads performance" }, { status: 500 });
  }
}
