import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import prisma from "@/lib/prisma";
import { isLazadaConnectEnabled } from "@/lib/integration-flags";
import { encrypt } from "@/lib/encryption";
import { exchangeLazadaAuthorizationCode } from "@/lib/lazada";
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
  if (!isLazadaConnectEnabled()) {
    return NextResponse.json(
      { error: "Lazada connection is disabled" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const base = publicBaseUrl(request);

  if (!code) {
    console.error("[LAZADA_OAUTH] Missing code in callback");
    return NextResponse.redirect(
      new URL(
        `/sources?lazada_error=${encodeURIComponent("Authorization failed — missing code")}`,
        base
      )
    );
  }

  const workspaceId = state || "";
  if (!workspaceId) {
    return NextResponse.redirect(
      new URL("/sources?lazada_error=invalid_state", base)
    );
  }

  const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });
  const userId = (token?.id ?? token?.sub) as string | undefined;
  if (!userId) {
    console.warn("[LAZADA_OAUTH] No session token in callback");
    return NextResponse.redirect(
      new URL("/sources?lazada_error=session_expired", base)
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
    console.warn("[LAZADA_OAUTH] User %s has no access to workspace %s", userId, workspaceId);
    return NextResponse.redirect(
      new URL(
        `/sources?lazada_error=${encodeURIComponent("workspace_access_denied")}`,
        base
      )
    );
  }

  try {
    const tokenData = await exchangeLazadaAuthorizationCode(code);
    const expiresAt = new Date(
      Date.now() + tokenData.expires_in * 1000
    ).toISOString();

    const label =
      tokenData.country ||
      tokenData.seller_id ||
      tokenData.account_id ||
      "seller";
    const newConn = await prisma.connection.create({
      data: {
        workspaceId,
        name: `Lazada Seller (${label})`,
        type: "source",
        provider: "lazada",
        status: "connected",
        credentials: encrypt(
          JSON.stringify({
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt,
            country: tokenData.country,
            sellerId: tokenData.seller_id,
            accountId: tokenData.account_id,
            product: "lazada",
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
      buildConsoleOauthSuccessUrl(base, "lazada", pipelineResult)
    );
  } catch (error: any) {
    console.error("[LAZADA_AUTH_ERROR]", error);
    return NextResponse.redirect(
      new URL(
        `/sources?lazada_error=${encodeURIComponent(
          error.message || "Failed to authenticate with Lazada"
        )}`,
        base
      )
    );
  }
}
