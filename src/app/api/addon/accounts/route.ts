import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { safeDecrypt } from '@/lib/encryption';

async function verifyGoogleIdToken(idToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.email || data.email_verified !== 'true') return null;
    if (data.exp && Number(data.exp) * 1000 < Date.now()) return null;
    return data.email as string;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) {
      return NextResponse.json({ error: 'Missing token' }, { status: 401 });
    }

    const email = await verifyGoogleIdToken(idToken);
    if (!email) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: 'No account found', code: 'NO_ACCOUNT' }, { status: 404 });
    }

    const workspace = await prisma.workspace.findFirst({
      where: {
        OR: [
          { ownerId: user.id },
          { members: { some: { userId: user.id } } },
        ],
      },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 });
    }

    const platform = req.nextUrl.searchParams.get('platform');

    const where: any = {
      workspaceId: workspace.id,
      type: 'source',
      status: 'connected',
    };
    if (platform) where.provider = platform;

    const connections = await prisma.connection.findMany({ where });

    const accounts = connections.flatMap((conn) => {
      let creds: any = {};
      try {
        const raw = safeDecrypt(conn.credentials);
        creds = JSON.parse(raw);
      } catch {
        return [];
      }

      if (conn.provider === 'meta_ads') {
        const list: Array<{ id: string; name: string }> =
          creds.adAccounts ??
          (creds.adAccountIds ?? []).map((id: string) => ({ id, name: id }));
        return list.map((a) => ({
          connectionId: conn.id,
          connectionName: conn.name,
          platform: conn.provider,
          accountId: a.id.replace(/^act_/, ''),
          accountName: a.name ?? a.id,
        }));
      }

      if (conn.provider === 'google_ads') {
        return (creds.customerIds ?? []).map((id: string) => ({
          connectionId: conn.id,
          connectionName: conn.name,
          platform: conn.provider,
          accountId: id,
          accountName: id,
        }));
      }

      if (conn.provider === 'tiktok_business') {
        return (creds.advertiserIds ?? []).map((id: string) => ({
          connectionId: conn.id,
          connectionName: conn.name,
          platform: conn.provider,
          accountId: id,
          accountName: id,
        }));
      }

      return [];
    });

    return NextResponse.json({ accounts });
  } catch (error) {
    console.error('[ADDON_ACCOUNTS]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
