import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { metaAdsClient } from '@/lib/meta-ads';
import prisma from '@/lib/prisma';
import { isMetaAdsConnectEnabled } from '@/lib/integration-flags';
import { encrypt } from '@/lib/encryption';
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
  const state = searchParams.get('state'); // workspace id
  const err = searchParams.get('error');
  const errDesc = searchParams.get('error_description');

  if (err) {
    console.error('[META_ADS_OAUTH]', err, errDesc);
    return NextResponse.redirect(
      new URL(`/sources?meta_ads_error=${encodeURIComponent(err)}`, base)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/sources?meta_ads_error=missing_code', base)
    );
  }

  const workspaceId = state || '';
  if (!workspaceId) {
    return NextResponse.redirect(
      new URL('/sources?meta_ads_error=invalid_state', base)
    );
  }

  // Verify the logged-in user belongs to the workspace in state (CSRF protection)
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', base));
  }

  const workspace = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      OR: [
        { ownerId: session.user.id },
        { members: { some: { userId: session.user.id } } },
      ],
    },
    select: { id: true },
  });
  if (!workspace) {
    console.warn('[META_ADS_OAUTH] User %s has no access to workspace %s', session.user.id, workspaceId);
    return NextResponse.redirect(
      new URL('/sources?meta_ads_error=workspace_access_denied', base)
    );
  }

  try {
    const redirectUri =
      process.env.META_ADS_REDIRECT_URI?.trim() ||
      `${base}/api/auth/meta-ads/callback`;

    // Exchange code for long-lived token (~60 days)
    const tokenData = await metaAdsClient.exchangeCode(code, redirectUri);

    // Fetch the ad accounts this token can access
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
      actingUserId: session.user.id,
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
