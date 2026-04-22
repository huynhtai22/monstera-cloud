import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { shopeeClient } from "@/lib/shopee";
import prisma from "@/lib/prisma";
import { isShopeeConnectEnabled } from "@/lib/integration-flags";
import { encrypt } from "@/lib/encryption";
import {
  buildConsoleOauthSuccessUrl,
  ensureDefaultPipelineAfterSourceConnect,
} from "@/lib/oauth-pipeline";

const isSandbox = () => process.env.SHOPEE_SANDBOX === "true";

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

  // Read JWT directly from Cookie header — reliable across App Router route handlers
  // and cross-site OAuth redirects (SameSite=Lax allows top-level GET navigations).
  const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });
  const userId = (token?.id ?? token?.sub) as string | undefined;
  if (!userId) {
    console.warn("[SHOPEE_OAUTH] No session token in callback");
    return NextResponse.redirect(
      new URL(`/sources?shopee_error=session_expired`, base)
    );
  }

  const workspace = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } },
      ],
    },
    select: { id: true, ownerId: true },
  });
  if (!workspace) {
    console.warn("[SHOPEE_OAUTH] User %s has no access to workspace %s", userId, workspaceId);
    return NextResponse.redirect(
      new URL(
        `/sources?shopee_error=${encodeURIComponent("workspace_access_denied")}`,
        base
      )
    );
  }

  try {
    const tokenData = await shopeeClient.exchangeCode(code, shopId, isSandbox());

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
          sandbox: isSandbox(),
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
