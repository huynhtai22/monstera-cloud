import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { shopeeDataClient, getValidShopeeCreds } from "@/lib/shopee";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { connectionId, startDate, endDate, cursor, pageSize, orderStatus } = body;

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
    // getValidShopeeCreds refreshes the token inline if it's within 30 min of
    // expiry — so we never hit a 4h-TTL wall mid-session.
    const creds = await getValidShopeeCreds(connection.id);
    const opts = {
      accessToken: creds.access_token,
      shopId:      creds.shop_id,
      sandbox:     creds.sandbox === true,
    };

    const timeFrom = startDate
      ? Math.floor(new Date(startDate).getTime() / 1000)
      : Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60; // 7 days ago
    const rawTimeTo = endDate
      ? Math.floor(new Date(endDate).getTime() / 1000)
      : Math.floor(Date.now() / 1000);
    // Shopee enforces time_to - time_from <= 15 days
    const timeTo = Math.min(rawTimeTo, timeFrom + 14 * 24 * 60 * 60);

    const orderListRes = await shopeeDataClient.getOrderList(
      opts,
      timeFrom,
      timeTo,
      cursor || "",
      pageSize || 50,
      orderStatus || "ALL"
    );

    const orderSnList: string[] = (
      orderListRes.response?.order_list || []
    ).map((o: any) => o.order_sn);

    let orderDetails: any[] = [];
    if (orderSnList.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < orderSnList.length; i += batchSize) {
        const batch = orderSnList.slice(i, i + batchSize);
        const detailRes = await shopeeDataClient.getOrderDetail(opts, batch, [
          "buyer_user_id",
          "buyer_username",
          "item_list",
          "pay_time",
          "shipping_carrier",
          "order_income",
          "total_amount",
        ]);
        orderDetails.push(...(detailRes.response?.order_list || []));
      }
    }

    return NextResponse.json({
      orders: orderDetails,
      more: orderListRes.response?.more || false,
      next_cursor: orderListRes.response?.next_cursor || "",
      total_count: orderSnList.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
