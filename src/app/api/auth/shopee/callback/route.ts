import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { shopeeClient } from "@/lib/shopee";
import prisma from "@/lib/prisma";
import { isShopeeConnectEnabled } from "@/lib/integration-flags";
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
  if (!isShopeeConnectEnabled()) {
    return NextResponse.json(
      { error: "Shopee connection is disabled" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const shopIdRaw = searchParams.get("shop_id");
  const state = searchParams.get("state"); // workspaceId
  const base = publicBaseUrl(request);

  if (!code || !shopIdRaw) {
    console.error("[SHOPEE_OAUTH] Missing code or shop_id in callback");
    return NextResponse.redirect(
      new URL(
        `/sources?shopee_error=${encodeURIComponent("Authorization failed — missing code or shop_id")}`,
        base
      )
    );
  }

  const shopId = Number(shopIdRaw);
  const workspaceId = state || "";
  if (!workspaceId) {
    return NextResponse.redirect(
      new URL("/sources?shopee_error=invalid_state", base)
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
    console.warn("[SHOPEE_OAUTH] User %s has no access to workspace %s", session.user.id, workspaceId);
    return NextResponse.redirect(
      new URL(
        `/sources?shopee_error=${encodeURIComponent("workspace_access_denied")}`,
        base
      )
    );
  }

  try {
    const tokenData = await shopeeClient.exchangeCode(code, shopId);

    const newConn = await prisma.connection.create({
      data: {
        workspaceId,
        name: `Shopee Shop (${shopId})`,
        type: "source",
        provider: "shopee",
        status: "connected",
        credentials: encrypt(JSON.stringify({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          shopId: tokenData.shop_id,
          expiresAt: new Date(
            Date.now() + (tokenData.expire_in ?? 14400) * 1000
          ).toISOString(),
          refreshExpiresAt: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000
          ).toISOString(),
          product: "shopee",
        })),
      },
    });

    const pipelineResult = await ensureDefaultPipelineAfterSourceConnect({
      workspaceId,
      sourceConnectionId: newConn.id,
      actingUserId: workspace.ownerId,
    });

    return NextResponse.redirect(
      buildConsoleOauthSuccessUrl(base, "shopee", pipelineResult)
    );
  } catch (error: any) {
    console.error("[SHOPEE_AUTH_ERROR]", error);
    return NextResponse.redirect(
      new URL(
        `/sources?shopee_error=${encodeURIComponent(error.message || "Failed to authenticate with Shopee")}`,
        base
      )
    );
  }
}
