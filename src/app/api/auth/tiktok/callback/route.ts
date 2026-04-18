import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { tiktokClient } from "@/lib/tiktok";
import prisma from "@/lib/prisma";
import { isTikTokShopConnectEnabled } from "@/lib/integration-flags";
import { encrypt } from "@/lib/encryption";
import {
  buildConsoleOauthSuccessUrl,
  ensureDefaultPipelineAfterSourceConnect,
} from "@/lib/oauth-pipeline";

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
  const state = searchParams.get("state"); // workspaceId passed in authorize URL
  const base = publicBaseUrl(request);

  if (!code) {
    return NextResponse.redirect(
      new URL("/sources?tiktok_error=missing_code", base)
    );
  }

  const workspaceId = state || "";
  if (!workspaceId) {
    return NextResponse.redirect(
      new URL("/sources?tiktok_error=invalid_state", base)
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", base));
  }

  const workspace = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      OR: [
        { ownerId: session.user.id },
        { members: { some: { userId: session.user.id } } },
      ],
    },
    select: { id: true, ownerId: true },
  });
  if (!workspace) {
    console.warn("[TIKTOK_OAUTH] User %s has no access to workspace %s", session.user.id, workspaceId);
    return NextResponse.redirect(
      new URL("/sources?tiktok_error=workspace_access_denied", base)
    );
  }

  try {
    const tokenData = await tiktokClient.getAccessToken(code);

    const newConn = await prisma.connection.create({
      data: {
        workspaceId,
        name: `TikTok Shop (${tokenData.seller_name})`,
        type: "source",
        provider: "tiktok_shop",
        status: "connected",
        credentials: encrypt(JSON.stringify({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          openId: tokenData.open_id,
          sellerId: tokenData.seller_id,
          expiresAt: new Date(Date.now() + tokenData.access_token_expire_in * 1000),
          refreshExpiresAt: new Date(Date.now() + tokenData.refresh_token_expire_in * 1000),
          product: "tiktok_shop",
        })),
      },
    });

    const pipelineResult = await ensureDefaultPipelineAfterSourceConnect({
      workspaceId,
      sourceConnectionId: newConn.id,
      actingUserId: workspace.ownerId,
    });

    return NextResponse.redirect(
      buildConsoleOauthSuccessUrl(base, "tiktok_shop", pipelineResult)
    );
  } catch (error: any) {
    console.error("[TIKTOK_AUTH_ERROR]", error);
    return NextResponse.redirect(
      new URL(`/sources?tiktok_error=${encodeURIComponent(error.message || "auth_failed")}`, base)
    );
  }
}
