import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { metaAdsClient } from '@/lib/meta-ads';
import { getValidMetaToken } from '@/lib/meta-refresh';
import prisma from '@/lib/prisma';
import { safeDecrypt } from '@/lib/encryption';

/**
 * GET /api/meta-ads/accounts?connectionId=
 * Returns the ad accounts available for this connection.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const connectionId = searchParams.get('connectionId');

  if (!connectionId) {
    return NextResponse.json({ error: 'connectionId is required' }, { status: 400 });
  }

  const conn = await (prisma.connection as any).findFirst({
    where: {
      id: connectionId,
      provider: 'meta_ads',
      status: 'connected',
      workspace: { members: { some: { userId: session.user.id } } },
    },
  });
  if (!conn) {
    return NextResponse.json({ error: 'Meta Ads connection not found' }, { status: 404 });
  }

  try {
    const creds = JSON.parse(safeDecrypt(conn.credentials)) as { adAccounts?: Array<{ id: string; name: string; currency: string }> };

    // Return cached account list from credentials first; refresh from API if not available
    if (creds.adAccounts?.length) {
      return NextResponse.json({ accounts: creds.adAccounts });
    }

    const accessToken = await getValidMetaToken(conn);
    const accounts = await metaAdsClient.getAdAccounts(accessToken);
    return NextResponse.json({ accounts });
  } catch (err: any) {
    console.error('[META_ADS_ACCOUNTS]', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch ad accounts' }, { status: 500 });
  }
}
