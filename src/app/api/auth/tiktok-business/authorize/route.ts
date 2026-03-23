import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isTikTokBusinessConnectEnabled } from '@/lib/integration-flags';
import { tiktokBusinessClient } from '@/lib/tiktok-business';

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

  const base = publicBaseUrl(request);
  const redirectUri =
    process.env.TIKTOK_BUSINESS_REDIRECT_URI?.trim() ||
    `${base}/api/auth/tiktok-business/callback`;

  try {
    const url = tiktokBusinessClient.getAuthorizeUrl(state, redirectUri);
    return NextResponse.redirect(url);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'TikTok Business OAuth not configured' }, { status: 500 });
  }
}
