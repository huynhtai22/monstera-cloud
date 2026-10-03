import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth-session';
import { metaAdsClient } from '@/lib/meta-ads';
import { getValidOAuthToken } from '@/lib/oauth-framework/token-refresh';
import prisma from '@/lib/prisma';
import { safeDecrypt } from '@/lib/encryption';
import { logger } from "@/lib/logger";
import { runWithConnectorContext } from "@/lib/observability/connector-telemetry";

/**
 * GET /api/meta-ads/accounts?connectionId=
 * Returns the ad accounts available for this connection.
 */
export async function GET(req: Request) {
  const session = await getAuthSession();
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

    const accounts = await runWithConnectorContext(
      { workspaceId: conn.workspaceId, connectionId: conn.id, provider: "meta_ads" },
      async () => {
        const accessToken = await getValidOAuthToken(conn);
        return metaAdsClient.getAdAccounts(accessToken);
      }
    );
    return NextResponse.json({ accounts });
  } catch (err: any) {
    logger.error('[META_ADS_ACCOUNTS]', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch ad accounts' }, { status: 500 });
  }
}
