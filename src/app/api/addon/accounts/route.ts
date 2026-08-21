import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { safeDecrypt } from '@/lib/encryption';
import { logger } from "@/lib/logger";
import { getGoogleIdTokenAudienceAllowlist, verifyGoogleIdToken } from "@/lib/google-id-token";
import { parseConnectionCredentialsJson } from "@/lib/parse-connection-credentials";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) {
      return NextResponse.json({ error: 'Missing token' }, { status: 401 });
    }

    const verification = await verifyGoogleIdToken(idToken, {
      audiences: getGoogleIdTokenAudienceAllowlist(),
    });
    if (!verification) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }
    const email = verification.email;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: 'No account found', code: 'NO_ACCOUNT' }, { status: 404 });
    }

    const workspaceId = req.nextUrl.searchParams.get('workspaceId')?.trim();
    if (!workspaceId) return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        members: { some: { userId: user.id } },
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
        creds = parseConnectionCredentialsJson(raw);
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
          // Return the same identifier persisted by the current Meta sync path.
          // The warehouse query uses this value as an exact accountId filter.
          accountId: a.id,
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

      if (conn.provider === 'shopee') {
        const shopId = String(creds.shopId || conn.remoteAccountId || conn.id);
        const shopName = creds.shopName || conn.name || `Shopee Shop ${shopId}`;
        return [{
          connectionId: conn.id,
          connectionName: conn.name,
          platform: conn.provider,
          accountId: shopId,
          accountName: shopName,
        }];
      }

      if (conn.provider === 'lazada') {
        const sellerId = String(creds.sellerId || conn.remoteAccountId || conn.id);
        const sellerName = creds.sellerName || conn.name || `Lazada Shop ${sellerId}`;
        return [{
          connectionId: conn.id,
          connectionName: conn.name,
          platform: conn.provider,
          accountId: sellerId,
          accountName: sellerName,
        }];
      }

      return [];
    });

    return NextResponse.json({ accounts });
  } catch (error) {
    logger.error('[ADDON_ACCOUNTS]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
