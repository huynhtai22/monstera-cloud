import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { googleAdsOAuthClient } from '@/lib/google-ads';
import prisma from '@/lib/prisma';
import { isGoogleAdsConnectEnabled } from '@/lib/integration-flags';
import { encrypt } from '@/lib/encryption';

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
  const state = searchParams.get('state'); // workspace id
  const err = searchParams.get('error');
  const errDesc = searchParams.get('error_description');

  if (err) {
    console.error('[GOOGLE_ADS_OAUTH]', err, errDesc);
    return NextResponse.redirect(
      new URL(`/console?google_ads_error=${encodeURIComponent(err)}`, base)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/console?google_ads_error=missing_code', base)
    );
  }

  const workspaceId = state || '';
  if (!workspaceId) {
    return NextResponse.redirect(
      new URL('/console?google_ads_error=invalid_state', base)
    );
  }

  // Verify the user belongs to the workspace (CSRF protection)
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', base));
  }

  const membership = await (prisma.workspaceMember as any).findFirst({
    where: { workspaceId, userId: session.user.id },
  });
  if (!membership) {
    console.warn('[GOOGLE_ADS_OAUTH] User %s not a member of workspace %s', session.user.id, workspaceId);
    return NextResponse.redirect(
      new URL('/console?google_ads_error=workspace_access_denied', base)
    );
  }

  try {
    const redirectUri =
      process.env.GOOGLE_ADS_REDIRECT_URI?.trim() ||
      `${base}/api/auth/google-ads/callback`;

    const tokenData = await googleAdsOAuthClient.exchangeCode(code, redirectUri);

    // Fetch accessible customer IDs (ad accounts)
    let customerIds: string[] = [];
    try {
      customerIds = await googleAdsOAuthClient.listAccessibleCustomers(tokenData.access_token);
    } catch (err) {
      // Dev token in test mode can't list customers beyond owned accounts — non-fatal
      console.warn('[GOOGLE_ADS_OAUTH] listAccessibleCustomers failed (likely test mode):', err);
    }

    const mccId = process.env.GOOGLE_ADS_MCC_ID?.trim() ?? '';

    await (prisma.connection as any).create({
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

    return NextResponse.redirect(new URL('/console', base));
  } catch (error: any) {
    console.error('[GOOGLE_ADS_AUTH_ERROR]', error);
    return NextResponse.redirect(
      new URL(`/console?google_ads_error=${encodeURIComponent(error.message || 'auth_failed')}`, base)
    );
  }
}
