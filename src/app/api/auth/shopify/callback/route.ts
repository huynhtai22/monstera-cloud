import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { ShopifyOAuthClient } from "@/lib/shopify";
import prisma from "@/lib/prisma";
import { isShopifyConnectEnabled } from "@/lib/integration-flags";
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
  if (!isShopifyConnectEnabled()) {
    return NextResponse.json({ error: "Shopify connection is disabled" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const shop = searchParams.get("shop");
  const state = searchParams.get("state"); // workspaceId:shop
  const base = publicBaseUrl(request);

  if (!code || !shop) {
    return NextResponse.redirect(
      new URL(
        `/sources?shopify_error=${encodeURIComponent("Authorization failed — missing code or shop")}`,
        base
      )
    );
  }

  const workspaceId = state?.split(":")[0] ?? "";
  if (!workspaceId) {
    return NextResponse.redirect(new URL("/sources?shopify_error=invalid_state", base));
  }

  // Verify HMAC signature from Shopify
  const client = new ShopifyOAuthClient();
  if (!client.verifyCallback(searchParams)) {
    return NextResponse.redirect(
      new URL(
        `/sources?shopify_error=${encodeURIComponent("HMAC verification failed")}`,
        base
      )
    );
  }

  const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });
  const userId = (token?.id ?? token?.sub) as string | undefined;
  if (!userId) {
    return NextResponse.redirect(new URL("/sources?shopify_error=session_expired", base));
  }

  const workspace = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    select: { id: true, ownerId: true },
  });
  if (!workspace) {
    return NextResponse.redirect(
      new URL(
        `/sources?shopify_error=${encodeURIComponent("workspace_access_denied")}`,
        base
      )
    );
  }

  try {
    const tokenData = await client.exchangeCode(shop, code);

    const newConn = await prisma.connection.create({
      data: {
        workspaceId,
        name: `Shopify (${shop})`,
        type: "source",
        provider: "shopify",
        status: "connected",
        credentials: encrypt(
          JSON.stringify({
            accessToken: tokenData.access_token,
            shop,
            scope: tokenData.scope,
            product: "shopify",
          })
        ),
      },
    });

    const pipelineResult = await ensureDefaultPipelineAfterSourceConnect({
      workspaceId,
      sourceConnectionId: newConn.id,
      actingUserId: workspace.ownerId,
    });

    return NextResponse.redirect(
      buildConsoleOauthSuccessUrl(base, "shopify", pipelineResult)
    );
  } catch (error: any) {
    console.error("[SHOPIFY_AUTH_ERROR]", error);
    return NextResponse.redirect(
      new URL(
        `/sources?shopify_error=${encodeURIComponent(
          error.message || "Failed to authenticate with Shopify"
        )}`,
        base
      )
    );
  }
}
