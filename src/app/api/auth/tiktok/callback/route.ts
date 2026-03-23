import { NextResponse } from "next/server";
import { tiktokClient } from "@/lib/tiktok";
import prisma from "@/lib/prisma";
import { isTikTokShopConnectEnabled } from "@/lib/integration-flags";

function publicBaseUrl(request: Request): string {
  const explicit = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  if (!isTikTokShopConnectEnabled()) {
    return NextResponse.json({ error: "TikTok Shop connection is disabled" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state"); // This would be the workspaceId we passed

  if (!code) {
    return NextResponse.json({ error: "No authorization code provided" }, { status: 400 });
  }

  try {
    // 1. Exchange code for tokens
    const tokenData = await tiktokClient.getAccessToken(code);

    // 2. Map the state back to a workspace (in a real app, you'd verify the state)
    const workspaceId = state || ""; 

    if (!workspaceId) {
       return NextResponse.json({ error: "Invalid state/workspace session" }, { status: 400 });
    }

    // 3. Store the connection in the database
    await prisma.connection.create({
      data: {
        workspaceId,
        name: `TikTok Shop (${tokenData.seller_name})`,
        type: "source",
        provider: "tiktok_shop",
        status: "connected",
        credentials: JSON.stringify({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          openId: tokenData.open_id,
          sellerId: tokenData.seller_id,
          expiresAt: new Date(Date.now() + tokenData.access_token_expire_in * 1000),
          refreshExpiresAt: new Date(Date.now() + tokenData.refresh_token_expire_in * 1000),
          product: "tiktok_shop",
        }),
      },
    });

    // 4. Redirect back to dashboard connections
    return NextResponse.redirect(new URL("/dashboard", publicBaseUrl(request)));
  } catch (error: any) {
    console.error("[TIKTOK_AUTH_ERROR]", error);
    return NextResponse.json({ error: error.message || "Failed to authenticate with TikTok" }, { status: 500 });
  }
}
