import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isTikTokShopConnectEnabled } from '@/lib/integration-flags';

function publicBaseUrl(request: Request): string {
  const explicit = process.env.NEXTAUTH_URL?.replace(/\/$/, '');
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`;
  return new URL(request.url).origin;
}

/**
 * Starts TikTok Shop OAuth. Requires login. Query: ?state=<workspaceId>
 * Register the same redirect_uri in TikTok Developer Console (exact match).
 */
export async function GET(request: Request) {
  if (!isTikTokShopConnectEnabled()) {
    return NextResponse.json({ error: 'TikTok Shop connection is disabled' }, { status: 403 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    const login = new URL('/login', publicBaseUrl(request));
    login.searchParams.set('callbackUrl', '/dashboard');
    return NextResponse.redirect(login);
  }

  const { searchParams } = new URL(request.url);
  const state = searchParams.get('state');
  if (!state?.trim()) {
    return NextResponse.json({ error: 'Missing state (workspace id)' }, { status: 400 });
  }

  const appKey = process.env.TIKTOK_SHOP_APP_KEY?.trim();
  if (!appKey) {
    return NextResponse.json({ error: 'TIKTOK_SHOP_APP_KEY is not configured' }, { status: 500 });
  }

  const base = publicBaseUrl(request);
  const redirectUri =
    process.env.TIKTOK_SHOP_REDIRECT_URI?.trim() || `${base}/api/auth/tiktok/callback`;

  const url = new URL('https://services.tiktokshop.com/open/authorize');
  url.searchParams.set('service_id', appKey); // TikTok uses service_id (same value as app_key) for authorization
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);

  return NextResponse.redirect(url.toString());
}
