import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ShopifyOAuthClient } from "@/lib/shopify";
import { isShopifyConnectEnabled } from "@/lib/integration-flags";

export async function GET(request: Request) {
  try {
    if (!isShopifyConnectEnabled()) {
      return NextResponse.json({ error: "Shopify connection is disabled" }, { status: 403 });
    }

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const shop = searchParams.get("shop"); // e.g. mystore.myshopify.com

    if (!workspaceId || !shop) {
      return NextResponse.json(
        { error: "Missing workspaceId or shop parameter." },
        { status: 400 }
      );
    }

    const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
    const host = request.headers.get("host") || "localhost:3000";
    const redirectUri = `${protocol}://${host}/api/auth/shopify/callback`;

    const client = new ShopifyOAuthClient();
    const authUrl = client.getAuthorizeUrl(shop, redirectUri, `${workspaceId}:${shop}`);

    return NextResponse.json({ url: authUrl });
  } catch (error) {
    console.error("Error generating Shopify Auth URL:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
