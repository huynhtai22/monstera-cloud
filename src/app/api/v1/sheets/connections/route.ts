import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/**
 * POST /api/v1/sheets/connections
 * Body: { googleToken }
 * Returns the user's TikTok Business connections (id, name, advertiserIds).
 * Used by the add-on to populate the connection picker.
 */
export async function POST(req: Request) {
  try {
    const { googleToken } = await req.json();
    if (!googleToken) {
      return NextResponse.json({ error: 'Missing Google token' }, { status: 400 });
    }

    const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${googleToken}` },
    });
    if (!googleRes.ok) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
    const googleUser = (await googleRes.json()) as { email?: string };
    if (!googleUser.email) {
      return NextResponse.json({ error: 'No email' }, { status: 401 });
    }

    const user = await (prisma.user as any).findUnique({
      where: { email: googleUser.email },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'No account' }, { status: 404 });
    }

    const connections = await (prisma.connection as any).findMany({
      where: {
        provider: 'tiktok_business',
        status: 'connected',
        workspace: { members: { some: { userId: user.id } } },
      },
      select: { id: true, name: true, credentials: true },
    });

    const result = connections.map((c: any) => {
      let advertiserIds: string[] = [];
      let sandbox = false;
      try {
        const creds = JSON.parse(c.credentials);
        advertiserIds = creds.advertiserIds ?? [];
        sandbox = creds.sandbox === true;
      } catch {}
      return { id: c.id, name: c.name, advertiserIds, sandbox };
    });

    return NextResponse.json({ connections: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
