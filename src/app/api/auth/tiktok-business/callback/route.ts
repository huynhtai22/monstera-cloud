import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { tiktokBusinessClient } from '@/lib/tiktok-business';
import prisma from '@/lib/prisma';
import { isTikTokBusinessConnectEnabled } from '@/lib/integration-flags';
import { encrypt } from '@/lib/encryption';

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

  // Marketing API returns auth_code (not code), plus state
  const authCode = searchParams.get('auth_code');
  const state = searchParams.get('state'); // workspace id we passed
  const err = searchParams.get('error');
  const errDesc = searchParams.get('error_description');

  if (err) {
    console.error('[TIKTOK_BUSINESS_OAUTH]', err, errDesc);
    return NextResponse.redirect(
      new URL(`/console?tiktok_business_error=${encodeURIComponent(err)}`, base)
    );
  }

  if (!authCode) {
    return NextResponse.redirect(
      new URL('/console?tiktok_business_error=missing_auth_code', base)
    );
  }

  const workspaceId = state || '';
  if (!workspaceId) {
    return NextResponse.redirect(
      new URL('/console?tiktok_business_error=invalid_state', base)
    );
  }

  // Verify the currently logged-in user actually belongs to the workspace in state.
  // This prevents an attacker from hijacking another user's OAuth flow.
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', base));
  }

  const membership = await (prisma.workspaceMember as any).findFirst({
    where: { workspaceId, userId: session.user.id },
  });
  if (!membership) {
    console.warn('[TIKTOK_BUSINESS_OAUTH] User %s is not a member of workspace %s', session.user.id, workspaceId);
    return NextResponse.redirect(
      new URL('/console?tiktok_business_error=workspace_access_denied', base)
    );
  }

  try {
    // Exchange auth_code → access_token using Marketing API endpoint
    const tokenData = await tiktokBusinessClient.exchangeCode(authCode);

    // advertiser_ids is the list of TikTok Ads accounts this user authorized
    const advertiserIds: string[] = tokenData.advertiser_ids ?? [];

    await (prisma.connection as any).create({
      data: {
        workspaceId,
        name: `TikTok Ads (${advertiserIds[0] ?? 'account'})`,
        type: 'source',
        provider: 'tiktok_business',
        status: 'connected',
        credentials: encrypt(JSON.stringify({
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
        })),
      },
    });

    return NextResponse.redirect(new URL('/console', base));
  } catch (error: any) {
    console.error('[TIKTOK_BUSINESS_AUTH_ERROR]', error);
    return NextResponse.redirect(
      new URL(`/console?tiktok_business_error=${encodeURIComponent(error.message || 'auth_failed')}`, base)
    );
  }
}
