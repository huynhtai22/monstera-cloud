import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { shopeeDataClient } from "@/lib/shopee";
import prisma from "@/lib/prisma";
import { safeDecrypt } from "@/lib/encryption";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get("connectionId");
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
    const creds = JSON.parse(safeDecrypt(connection.credentials));
    const data = await shopeeDataClient.getShopInfo({
      accessToken: creds.accessToken,
      shopId: creds.shopId,
      sandbox: creds.sandbox === true,
    });
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
