import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { safeDecrypt } from '@/lib/encryption';
import { getGoogleIdTokenAudienceAllowlist, verifyGoogleIdToken } from '@/lib/google-id-token';

/**
 * POST /api/v1/sheets/connections
 * Body: { googleToken }
 * Returns the user's TikTok Business connections (id, name, advertiserIds).
 * Used by the add-on to populate the connection picker.
 */
export async function POST(req: Request) {
  try {
    const { googleToken, workspaceId } = await req.json();
    if (!googleToken) {
      return NextResponse.json({ error: 'Missing Google token' }, { status: 400 });
    }
    if (!workspaceId || typeof workspaceId !== 'string') {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
    }

    const verification = await verifyGoogleIdToken(googleToken, {
      audiences: getGoogleIdTokenAudienceAllowlist(),
    });
    if (!verification) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const user = await (prisma.user as any).findUnique({
      where: { email: verification.email },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'No account' }, { status: 404 });
    }

    const connections = await (prisma.connection as any).findMany({
      where: {
        workspaceId,
        provider: { in: ['meta_ads', 'google_ads', 'tiktok_business', 'shopee'] },
        status: 'connected',
        workspace: { members: { some: { userId: user.id } } },
      },
      select: { id: true, name: true, provider: true, credentials: true },
    });

    const result = connections.map((c: any) => {
      let advertiserIds: string[] = [];
      let sandbox = false;
      try {
        const creds = JSON.parse(safeDecrypt(c.credentials));
        advertiserIds = creds.advertiserIds ?? [];
        sandbox = creds.sandbox === true;
      } catch {}
      return { id: c.id, name: c.name, provider: c.provider, advertiserIds, sandbox };
    });

    return NextResponse.json({ connections: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
