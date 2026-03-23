import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { tiktokBusinessClient } from '@/lib/tiktok-business';
import prisma from '@/lib/prisma';
import { isTikTokBusinessConnectEnabled } from '@/lib/integration-flags';

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
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const err = searchParams.get('error');
  const errDesc = searchParams.get('error_description');

  if (err) {
    console.error('[TIKTOK_BUSINESS_OAUTH]', err, errDesc);
    return NextResponse.redirect(
      new URL(`/dashboard?tiktok_business_error=${encodeURIComponent(err)}`, publicBaseUrl(request))
    );
  }

  if (!code) {
    return NextResponse.json({ error: 'No authorization code provided' }, { status: 400 });
  }

  // Retrieve the PKCE code_verifier from the cookie set during /authorize
  const cookieStore = await cookies();
  const codeVerifier = cookieStore.get('tiktok_pkce_verifier')?.value;

  const base = publicBaseUrl(request);
  const redirectUri =
    process.env.TIKTOK_BUSINESS_REDIRECT_URI?.trim() ||
    `${base}/api/auth/tiktok-business/callback`;

  try {
    const tokenData = await tiktokBusinessClient.exchangeCode(code, redirectUri, codeVerifier);

    const workspaceId = state || '';
    if (!workspaceId) {
      return NextResponse.json({ error: 'Invalid state/workspace session' }, { status: 400 });
    }

    await prisma.connection.create({
      data: {
        workspaceId,
        name: `TikTok Business (${tokenData.open_id?.slice(0, 8) || 'account'})`,
        type: 'source',
        provider: 'tiktok_business',
        status: 'connected',
        credentials: JSON.stringify({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          openId: tokenData.open_id,
          scope: tokenData.scope,
          expiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
          refreshExpiresAt: new Date(Date.now() + tokenData.refresh_expires_in * 1000).toISOString(),
          product: 'tiktok_business',
        }),
      },
    });

    // Clear the PKCE cookie
    const response = NextResponse.redirect(new URL('/dashboard', publicBaseUrl(request)));
    response.cookies.delete('tiktok_pkce_verifier');
    return response;
  } catch (error: any) {
    console.error('[TIKTOK_BUSINESS_AUTH_ERROR]', error);
    return NextResponse.json(
      { error: error.message || 'Failed to authenticate with TikTok Business' },
      { status: 500 }
    );
  }
}
