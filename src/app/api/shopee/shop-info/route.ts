import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getValidShopeeCreds, shopeeDataClient } from "@/lib/shopee";
import { isShopeeRegionEligible, PROVIDER_MARKET_POLICIES } from "@/lib/provider-market-policy";
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

  const connection = await prisma.connection.findFirst({
    where: {
      id: connectionId,
      provider: "shopee",
      workspace: { members: { some: { userId: session.user.id } } },
    },
    select: { id: true },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  try {
    const creds = await getValidShopeeCreds(connection.id);
    const shopInfo = await shopeeDataClient.getShopInfo({
      accessToken: creds.access_token,
      shopId: creds.shop_id,
      sandbox: creds.sandbox === true,
    });

    const isAdsEligible = isShopeeRegionEligible(shopInfo.region, "ads_reporting");
    return NextResponse.json({
      ...shopInfo,
      isAdsEligible,
      supportedMarkets: PROVIDER_MARKET_POLICIES.shopee,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
