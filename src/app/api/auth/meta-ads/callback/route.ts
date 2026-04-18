import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { metaAdsClient } from '@/lib/meta-ads';
import prisma from '@/lib/prisma';
import { isMetaAdsConnectEnabled } from '@/lib/integration-flags';
import { encrypt, safeDecrypt } from '@/lib/encryption';
import {
  buildConsoleOauthSuccessUrl,
  ensureDefaultPipelineAfterSourceConnect,
} from '@/lib/oauth-pipeline';

function publicBaseUrl(request: Request): string {
  const explicit = process.env.NEXTAUTH_URL?.replace(/\/$/, '');
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  if (!isMetaAdsConnectEnabled()) {
    return NextResponse.json({ error: 'Meta Ads connection is disabled' }, { status: 403 });
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
      console.error('[META_ADS_OAUTH]', err, errDesc);
      return NextResponse.redirect(
        new URL(`/sources?meta_ads_error=${encodeURIComponent(err)}`, base)
      );
    }

    return NextResponse.redirect(
      new URL('/sources?meta_ads_error=missing_code', base)
    );
  }

  if (!userId) {
    // Fallback: Read JWT directly from Cookie header
    const { getToken } = await import('next-auth/jwt');
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });
    userId = (token?.id ?? token?.sub) as string;
    
    if (!userId) {
      console.warn('[META_ADS_OAUTH] No session token in callback');
      return NextResponse.redirect(
        new URL(`/sources?meta_ads_error=session_expired`, base)
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
    console.warn('[META_ADS_OAUTH] User %s has no access to workspace %s', userId, workspaceId);
    return NextResponse.redirect(
      new URL('/sources?meta_ads_error=workspace_access_denied', base)
    );
  }

  try {
    const redirectUri =
      process.env.META_ADS_REDIRECT_URI?.trim() ||
      `${base}/api/auth/meta-ads/callback`;

    const tokenData = await metaAdsClient.exchangeCode(code, redirectUri);

    const adAccounts = await metaAdsClient.getAdAccounts(tokenData.access_token);
    const primaryAccount = adAccounts[0];
    const adAccountIds = adAccounts.map((a) => a.id);

    const newConn = await prisma.connection.create({
      data: {
        workspaceId,
        name: primaryAccount
          ? `Meta Ads (${primaryAccount.name})`
          : 'Meta Ads',
        type: 'source',
        provider: 'meta_ads',
        status: 'connected',
        credentials: encrypt(JSON.stringify({
          accessToken: tokenData.access_token,
          adAccountIds,
          adAccounts,
          expiresAt: new Date(
            Date.now() + (tokenData.expires_in ?? 5183944) * 1000
          ).toISOString(),
          product: 'meta_ads',
        })),
      },
    });

    const pipelineResult = await ensureDefaultPipelineAfterSourceConnect({
      workspaceId,
      sourceConnectionId: newConn.id,
      actingUserId: userId,
    });

    return NextResponse.redirect(
      buildConsoleOauthSuccessUrl(base, 'meta_ads', pipelineResult)
    );
  } catch (error: any) {
    console.error('[META_ADS_AUTH_ERROR]', error);
    return NextResponse.redirect(
      new URL(`/sources?meta_ads_error=${encodeURIComponent(error.message || 'auth_failed')}`, base)
    );
  }
}
