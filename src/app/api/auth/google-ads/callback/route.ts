import { NextResponse } from 'next/server';
import { googleAdsOAuthClient } from '@/lib/google-ads';
import prisma from '@/lib/prisma';
import { isGoogleAdsConnectEnabled } from '@/lib/integration-flags';
import { encrypt, safeDecrypt } from '@/lib/encryption';
import {
  buildConsoleOauthSuccessUrl,
  ensureDefaultPipelineAfterSourceConnect,
} from '@/lib/oauth-pipeline';
import { logger } from "@/lib/logger";

function publicBaseUrl(request: Request): string {
  const explicit = process.env.NEXTAUTH_URL?.replace(/\/$/, '');
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  if (!isGoogleAdsConnectEnabled()) {
    return NextResponse.json({ error: 'Google Ads connection is disabled' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const base = publicBaseUrl(request);

  const code = searchParams.get('code');
  const secureState = searchParams.get('state'); // workspace id or encrypted payload

  let workspaceId = '';
  let userId = '';

  try {
    const payload = JSON.parse(safeDecrypt(secureState || ''));
    workspaceId = payload.workspaceId || secureState || '';
    userId = payload.userId || '';
  } catch (e) {
    workspaceId = secureState || '';
  }

  if (!code || !workspaceId) {
    const err = searchParams.get('error');
    const errDesc = searchParams.get('error_description');

    if (err) {
      logger.error('[GOOGLE_ADS_OAUTH]', err, errDesc);
      return NextResponse.redirect(
        new URL(`/sources?google_ads_error=${encodeURIComponent(err)}`, base)
      );
    }

    return NextResponse.redirect(
      new URL('/sources?google_ads_error=missing_code', base)
    );
  }

  if (!userId) {
    // Fallback: Read JWT directly from Cookie header
    const { getToken } = await import('next-auth/jwt');
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });
    userId = (token?.id ?? token?.sub) as string;
    
    if (!userId) {
      logger.warn('[GOOGLE_ADS_OAUTH] No session token in callback');
      return NextResponse.redirect(
        new URL(`/sources?google_ads_error=session_expired`, base)
      );
    }
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
    logger.warn('[GOOGLE_ADS_OAUTH] User %s has no access to workspace %s', userId, workspaceId);
    return NextResponse.redirect(
      new URL('/sources?google_ads_error=workspace_access_denied', base)
    );
  }

  try {
    const redirectUri =
      process.env.GOOGLE_ADS_REDIRECT_URI?.trim() ||
      `${base}/api/auth/google-ads/callback`;

    const tokenData = await googleAdsOAuthClient.exchangeCode(code, redirectUri);

    let customerIds: string[] = [];
    try {
      customerIds = await googleAdsOAuthClient.listAccessibleCustomers(tokenData.access_token);
    } catch (err) {
      logger.warn('[GOOGLE_ADS_OAUTH] listAccessibleCustomers failed (likely test mode):', err);
    }

    const mccId = process.env.GOOGLE_ADS_MCC_ID?.trim() ?? '';

    const newConn = await prisma.connection.create({
      data: {
        workspaceId,
        name: customerIds.length
          ? `Google Ads (${customerIds.length} account${customerIds.length > 1 ? 's' : ''})`
          : 'Google Ads',
        type: 'source',
        provider: 'google_ads',
        status: 'connected',
        credentials: encrypt(JSON.stringify({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt: new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString(),
          customerIds,
          mccId,
          product: 'google_ads',
        })),
      },
    });

    const pipelineResult = await ensureDefaultPipelineAfterSourceConnect({
      workspaceId,
      sourceConnectionId: newConn.id,
      actingUserId: userId,
    });

    return NextResponse.redirect(
      buildConsoleOauthSuccessUrl(base, 'google_ads', pipelineResult)
    );
  } catch (error: any) {
    logger.error('[GOOGLE_ADS_AUTH_ERROR]', error);
    return NextResponse.redirect(
      new URL(`/sources?google_ads_error=${encodeURIComponent(error.message || 'auth_failed')}`, base)
    );
  }
}
