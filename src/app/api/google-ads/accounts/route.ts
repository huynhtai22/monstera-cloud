import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getValidOAuthToken } from '@/lib/oauth-framework/token-refresh';
import { googleAdsOAuthClient } from '@/lib/google-ads';
import prisma from '@/lib/prisma';
import { safeDecrypt } from '@/lib/encryption';
import { logger } from "@/lib/logger";

/**
 * GET /api/google-ads/accounts?connectionId=
 * Returns the Google Ads customer IDs for this connection.
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
      provider: 'google_ads',
      status: 'connected',
      workspace: { members: { some: { userId: session.user.id } } },
    },
  });
  if (!conn) {
    return NextResponse.json({ error: 'Google Ads connection not found' }, { status: 404 });
  }

  try {
    const creds = JSON.parse(safeDecrypt(conn.credentials)) as { customerIds?: string[] };

    if (creds.customerIds?.length) {
      return NextResponse.json({ customerIds: creds.customerIds });
    }

    // Refresh customer list from API
    const accessToken = await getValidOAuthToken(conn);
    const customerIds = await googleAdsOAuthClient.listAccessibleCustomers(accessToken);
    return NextResponse.json({ customerIds });
  } catch (err: any) {
    logger.error('[GOOGLE_ADS_ACCOUNTS]', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch customer accounts' }, { status: 500 });
  }
}
