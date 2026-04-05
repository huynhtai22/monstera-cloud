import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { effectiveSheetsPlan } from '@/lib/sheets-reviewer';
import { PRODUCT_SITE_URL } from '@/lib/site-url';

/**
 * POST /api/v1/sheets/auth
 * Body: { googleToken }
 *
 * Called by the Google Sheets Add-on. Verifies the user's Google OAuth token,
 * looks up their account in our DB, and returns subscription status.
 * No API key, no login — the token comes from ScriptApp.getOAuthToken().
 */
export async function POST(req: Request) {
  try {
    const { googleToken } = await req.json();
    if (!googleToken) {
      return NextResponse.json({ error: 'Missing Google token' }, { status: 400 });
    }

    // Verify token with Google and get user info
    const googleRes = await fetch(
      `https://www.googleapis.com/oauth2/v3/userinfo`,
      { headers: { Authorization: `Bearer ${googleToken}` } },
    );

    if (!googleRes.ok) {
      return NextResponse.json(
        { error: 'invalid_token', message: 'Google token is invalid or expired. Please reopen the add-on.' },
        { status: 401 },
      );
    }

    const googleUser = (await googleRes.json()) as { email?: string; name?: string; picture?: string };
    if (!googleUser.email) {
      return NextResponse.json({ error: 'Could not read email from Google token' }, { status: 401 });
    }

    // Find user in our DB
    const user = await (prisma.user as any).findUnique({
      where: { email: googleUser.email },
      select: { id: true, name: true, email: true, plan: true, image: true },
    });

    if (!user) {
      return NextResponse.json({
        error: 'no_account',
        message: `No Monstera Cloud account found for ${googleUser.email}. Sign up at ${PRODUCT_SITE_URL.replace('https://', '')} first.`,
      }, { status: 404 });
    }

    const plan = effectiveSheetsPlan(user.plan, googleUser.email);
    const isPaid = plan === 'starter' || plan === 'professional';

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        plan,
      },
      features: {
        canQuery: isPaid,
        maxRows: plan === 'professional' ? 100_000 : plan === 'starter' ? 10_000 : 0,
        refreshIntervals: isPaid ? ['manual', '1h', '3h', '6h', '12h', 'daily'] : [],
      },
      upgradeUrl: isPaid ? null : `${PRODUCT_SITE_URL}/pricing`,
    });
  } catch (err: any) {
    console.error('[SHEETS_AUTH]', err);
    return NextResponse.json({ error: err.message || 'Auth failed' }, { status: 500 });
  }
}
