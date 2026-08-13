import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from "@/lib/logger";
import { getGoogleIdTokenAudienceAllowlist, verifyGoogleIdToken } from "@/lib/google-id-token";

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

    const verification = await verifyGoogleIdToken(googleToken, {
      audiences: getGoogleIdTokenAudienceAllowlist(),
    });
    if (!verification) {
      return NextResponse.json(
        { error: 'invalid_token', message: 'Google token is invalid or expired. Please reopen the add-on.' },
        { status: 401 },
      );
    }

    // Find user in our DB
    const user = await (prisma.user as any).findUnique({
      where: { email: verification.email },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        memberships: {
          select: {
            role: true,
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
                plan: true,
                status: true,
                providerAccess: {
                  where: { enabled: true },
                  select: { provider: true },
                },
              },
            },
          },
          orderBy: { workspace: { name: 'asc' } },
        },
      },
    });

    if (!user) {
      return NextResponse.json({
        error: 'no_account',
        message: `No Monstera Cloud account found for ${verification.email}. Ask your agency owner for an invitation.`,
      }, { status: 404 });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
      workspaces: user.memberships.map(({ role, workspace }: any) => ({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        role,
        plan: workspace.plan,
        status: workspace.status,
        enabledProviders: workspace.providerAccess.map((access: any) => access.provider),
      })),
      requiresWorkspaceSelection: true,
      features: {
        canQuery: user.memberships.length > 0,
        maxRows: 100_000,
        refreshIntervals: ['manual', 'daily'],
      },
      upgradeUrl: null,
    });
  } catch (err: any) {
    logger.error('[SHEETS_AUTH]', err);
    return NextResponse.json({ error: err.message || 'Auth failed' }, { status: 500 });
  }
}
