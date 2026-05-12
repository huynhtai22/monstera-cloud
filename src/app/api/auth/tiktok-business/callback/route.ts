import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { tiktokBusinessClient } from '@/lib/tiktok-business';
import prisma from '@/lib/prisma';
import { isTikTokBusinessConnectEnabled } from '@/lib/integration-flags';
import { encrypt } from '@/lib/encryption';
import {
  buildConsoleOauthSuccessUrl,
  ensureDefaultPipelineAfterSourceConnect,
} from '@/lib/oauth-pipeline';
import { logger } from "@/lib/logger";
import { upsertSourceConnection } from "@/lib/connection-upsert";

function publicBaseUrl(request: Request): string {
  const explicit = process.env.NEXTAUTH_URL?.replace(/\/$/, '');
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  if (!isTikTokBusinessConnectEnabled()) {
    return NextResponse.json({ error: 'TikTok Business connection is disabled' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const base = publicBaseUrl(request);

  const authCode = searchParams.get('auth_code');
  const state = searchParams.get('state');
  const err = searchParams.get('error');
  const errDesc = searchParams.get('error_description');

  if (err) {
    logger.error('[TIKTOK_BUSINESS_OAUTH]', err, errDesc);
    return NextResponse.redirect(
      new URL(`/sources?tiktok_business_error=${encodeURIComponent(err)}`, base)
    );
  }

  if (!authCode) {
    return NextResponse.redirect(
      new URL('/sources?tiktok_business_error=missing_auth_code', base)
    );
  }

  const workspaceId = state || '';
  if (!workspaceId) {
    return NextResponse.redirect(
      new URL('/sources?tiktok_business_error=invalid_state', base)
    );
  }

  const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });
  const userId = (token?.id ?? token?.sub) as string | undefined;

  if (!userId) {
    logger.warn('[TIKTOK_BUSINESS_OAUTH] No session token in callback');
    return NextResponse.redirect(
      new URL('/sources?tiktok_business_error=session_expired', base)
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
    select: { id: true },
  });

  if (!workspace) {
    logger.warn('[TIKTOK_BUSINESS_OAUTH] User %s has no access to workspace %s', userId, workspaceId);
    return NextResponse.redirect(
      new URL('/sources?tiktok_business_error=workspace_access_denied', base)
    );
  }

  try {
    const tokenData = await tiktokBusinessClient.exchangeCode(authCode);
    const advertiserIds: string[] = tokenData.advertiser_ids ?? [];

    const remoteAccountId = advertiserIds[0] ?? 'tiktok_business';
    const connection = await upsertSourceConnection({
      workspaceId,
      provider: 'tiktok_business',
      remoteAccountId,
      name: `TikTok Ads (${advertiserIds[0] ?? 'account'})`,
      type: 'source',
      credentials: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        advertiserIds,
        scope: tokenData.scope,
        expiresAt: new Date(
          Date.now() + (tokenData.expires_in ?? 86400) * 1000
        ).toISOString(),
        refreshExpiresAt: new Date(
          Date.now() + (tokenData.refresh_token_expires_in ?? 2592000) * 1000
        ).toISOString(),
        product: 'tiktok_business',
      },
      status: 'connected',
    });

    const pipelineResult = await ensureDefaultPipelineAfterSourceConnect({
      workspaceId,
      sourceConnectionId: connection.id,
      actingUserId: userId,
    });

    return NextResponse.redirect(
      buildConsoleOauthSuccessUrl(base, 'tiktok_business', pipelineResult)
    );
  } catch (error: any) {
    logger.error('[TIKTOK_BUSINESS_AUTH_ERROR]', error);
    return NextResponse.redirect(
      new URL(`/sources?tiktok_business_error=${encodeURIComponent(error.message || 'auth_failed')}`, base)
    );
  }
}
