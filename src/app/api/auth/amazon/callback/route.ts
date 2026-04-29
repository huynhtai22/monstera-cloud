import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import prisma from "@/lib/prisma";
import { isAmazonConnectEnabled } from "@/lib/integration-flags";
import { encrypt } from "@/lib/encryption";
import { exchangeAmazonSpAuthorizationCode } from "@/lib/amazon-sp";
import {
  buildConsoleOauthSuccessUrl,
  ensureDefaultPipelineAfterSourceConnect,
} from "@/lib/oauth-pipeline";
import { logger } from "@/lib/logger";
import { upsertSourceConnection } from "@/lib/connection-upsert";

function publicBaseUrl(request: Request): string {
  const explicit = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  if (!isAmazonConnectEnabled()) {
    return NextResponse.json(
      { error: "Amazon Selling Partner connection is disabled" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const spapiOAuthCode = searchParams.get("spapi_oauth_code");
  const sellingPartnerId = searchParams.get("selling_partner_id");
  const state = searchParams.get("state");
  const base = publicBaseUrl(request);
  const redirectUri =
    process.env.AMAZON_REDIRECT_URI?.trim() ||
    `${base}/api/auth/amazon/callback`;

  if (!spapiOAuthCode || !sellingPartnerId) {
    logger.error("[AMAZON_SP_OAUTH] Missing spapi_oauth_code or selling_partner_id");
    return NextResponse.redirect(
      new URL(
        `/sources?amazon_error=${encodeURIComponent("Authorization failed — missing OAuth code or seller id")}`,
        base
      )
    );
  }

  const workspaceId = state || "";
  if (!workspaceId) {
    return NextResponse.redirect(
      new URL("/sources?amazon_error=invalid_state", base)
    );
  }

  const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });
  const userId = (token?.id ?? token?.sub) as string | undefined;
  if (!userId) {
    logger.warn("[AMAZON_SP_OAUTH] No session token in callback");
    return NextResponse.redirect(
      new URL("/sources?amazon_error=session_expired", base)
    );
  }

  const workspace = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    select: { id: true, ownerId: true },
  });
  if (!workspace) {
    logger.warn("[AMAZON_SP_OAUTH] User %s has no access to workspace %s", userId, workspaceId);
    return NextResponse.redirect(
      new URL(
        `/sources?amazon_error=${encodeURIComponent("workspace_access_denied")}`,
        base
      )
    );
  }

  try {
    const tokenData = await exchangeAmazonSpAuthorizationCode(
      spapiOAuthCode,
      redirectUri
    );

    const expiresAt = new Date(
      Date.now() + (tokenData.expires_in || 3600) * 1000
    ).toISOString();

    const connection = await upsertSourceConnection({
      workspaceId,
      provider: "amazon",
      remoteAccountId: sellingPartnerId ?? "amazon",
      name: `Amazon SP (${sellingPartnerId})`,
      type: "source",
      credentials: {
        refreshToken: tokenData.refresh_token,
        accessToken: tokenData.access_token,
        expiresAt,
        sellingPartnerId,
        product: "amazon",
      },
      status: "connected",
    });

    const pipelineResult = await ensureDefaultPipelineAfterSourceConnect({
      workspaceId,
      sourceConnectionId: connection.id,
      actingUserId: workspace.ownerId,
    });

    return NextResponse.redirect(
      buildConsoleOauthSuccessUrl(base, "amazon", pipelineResult)
    );
  } catch (error: any) {
    logger.error("[AMAZON_SP_AUTH_ERROR]", error);
    return NextResponse.redirect(
      new URL(
        `/sources?amazon_error=${encodeURIComponent(
          error.message || "Failed to authenticate with Amazon"
        )}`,
        base
      )
    );
  }
}
