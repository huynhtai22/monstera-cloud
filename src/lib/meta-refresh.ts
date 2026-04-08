/**
 * Ensures a Meta Ads connection's access token is still valid.
 *
 * Token lifecycle:
 *   Long-lived token: ~60 days. Refresh when < 7 days remaining.
 *   System User Token: never expires — skip refresh.
 *
 * Returns the valid (possibly refreshed) access token.
 */

import prisma from '@/lib/prisma';
import { metaAdsClient } from '@/lib/meta-ads';
import { encrypt, safeDecrypt } from '@/lib/encryption';

export async function getValidMetaToken(conn: {
  id: string;
  credentials: string;
}): Promise<string> {
  const creds = JSON.parse(safeDecrypt(conn.credentials)) as {
    accessToken: string;
    expiresAt?: string;
    systemUser?: boolean;
    [key: string]: unknown;
  };

  // System User tokens never expire — skip refresh
  if (creds.systemUser === true) {
    return creds.accessToken;
  }

  const expiresAt = creds.expiresAt ? new Date(creds.expiresAt) : null;

  // Refresh if token expires within the next 7 days
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const needsRefresh = expiresAt !== null && expiresAt.getTime() - Date.now() < sevenDaysMs;

  if (!needsRefresh) {
    return creds.accessToken;
  }

  // Meta long-lived tokens are refreshed by exchanging them for a new long-lived token
  const newToken = await metaAdsClient.exchangeForLongLived(creds.accessToken);

  const updatedCreds = {
    ...creds,
    accessToken: newToken.access_token,
    expiresAt: new Date(
      Date.now() + (newToken.expires_in ?? 5183944) * 1000
    ).toISOString(),
  };

  await (prisma.connection as any).update({
    where: { id: conn.id },
    data: { credentials: encrypt(JSON.stringify(updatedCreds)) },
  });

  return newToken.access_token;
}
