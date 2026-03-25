/**
 * Ensures a Google Ads connection's access token is valid.
 *
 * Google access tokens expire in ~1 hour.
 * Refresh tokens don't expire unless the user revokes access.
 *
 * Refreshes automatically when token expires within 5 minutes.
 */

import prisma from '@/lib/prisma';
import { googleAdsOAuthClient } from '@/lib/google-ads';

export async function getValidGoogleAdsToken(conn: {
  id: string;
  credentials: string;
}): Promise<string> {
  const creds = JSON.parse(conn.credentials) as {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
    [key: string]: unknown;
  };

  const expiresAt = creds.expiresAt ? new Date(creds.expiresAt) : null;

  // Refresh if token expires within the next 5 minutes
  const needsRefresh =
    expiresAt === null || expiresAt.getTime() - Date.now() < 5 * 60 * 1000;

  if (!needsRefresh) {
    return creds.accessToken;
  }

  if (!creds.refreshToken) {
    throw new Error(
      'Google Ads access token has expired and no refresh token is stored. Please reconnect your Google Ads account.'
    );
  }

  const newToken = await googleAdsOAuthClient.refreshAccessToken(creds.refreshToken);

  const updatedCreds = {
    ...creds,
    accessToken: newToken.access_token,
    expiresAt: new Date(Date.now() + (newToken.expires_in ?? 3600) * 1000).toISOString(),
  };

  await (prisma.connection as any).update({
    where: { id: conn.id },
    data: { credentials: JSON.stringify(updatedCreds) },
  });

  return newToken.access_token;
}
