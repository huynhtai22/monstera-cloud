import { NextResponse } from "next/server";
import { MARKETPLACE_BUCKETING_TIMEZONE, resolveShopTimezoneOffsetMinutes } from "@/lib/sync-marketplace-warehouse";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getValidShopeeCreds, shopeeDataClient } from "@/lib/shopee";
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
    const data = await shopeeDataClient.getShopInfo({
      accessToken: creds.access_token,
      shopId: creds.shop_id,
      sandbox: creds.sandbox === true,
    });
    // Truthfulness: marketplace reporting is bucketed on UTC days. Surface the
    // bucketing timezone (and the shop's own offset when the provider exposes
    // one) so non-UTC shops can see why near-midnight orders may land on a
    // neighboring reporting date. Bucketing itself intentionally stays UTC.
    return NextResponse.json({
      ...data,
      monsteraBucketingTimezone: MARKETPLACE_BUCKETING_TIMEZONE,
      monsteraShopTimezoneOffsetMinutes: resolveShopTimezoneOffsetMinutes(data),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
