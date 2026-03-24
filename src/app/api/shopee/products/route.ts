import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { shopeeDataClient } from "@/lib/shopee";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { connectionId, offset, pageSize, itemStatus } = body;

  if (!connectionId) {
    return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
  }

  const connection = await (prisma.connection as any).findUnique({
    where: { id: connectionId },
  });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  try {
    const creds = JSON.parse(connection.credentials);
    const opts = {
      accessToken: creds.accessToken,
      shopId: creds.shopId,
      sandbox: creds.sandbox === true,
    };

    const listRes = await shopeeDataClient.getItemList(
      opts,
      offset || 0,
      pageSize || 50,
      itemStatus || "NORMAL"
    );

    const itemIds: number[] = (listRes.response?.item || []).map(
      (i: any) => i.item_id
    );

    let items: any[] = [];
    if (itemIds.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < itemIds.length; i += batchSize) {
        const batch = itemIds.slice(i, i + batchSize);
        const detailRes = await shopeeDataClient.getItemBaseInfo(opts, batch);
        items.push(...(detailRes.response?.item_list || []));
      }
    }

    return NextResponse.json({
      items,
      total_count: listRes.response?.total_count || 0,
      has_next_page: listRes.response?.has_next_page || false,
      next_offset: (offset || 0) + itemIds.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
