/**
 * Ensures a TikTok Business connection's access token is still valid.
 * If the token expires within 10 minutes, it is automatically refreshed
 * and the new credentials are persisted to the database.
 *
 * Returns the valid (possibly refreshed) access token.
 */

import prisma from "@/lib/prisma";
import { tiktokBusinessClient } from "@/lib/tiktok-business";
import { encrypt, safeDecrypt } from "@/lib/encryption";

export async function getValidTikTokToken(conn: {
  id: string;
  credentials: string;
}): Promise<string> {
  const creds = JSON.parse(safeDecrypt(conn.credentials)) as {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
    refreshExpiresAt?: string;
    sandbox?: boolean;
    [key: string]: unknown;
  };

  // Sandbox tokens are manually generated and have no expiry tracked — skip refresh
  if (creds.sandbox === true) {
    return creds.accessToken;
  }

  const expiresAt = creds.expiresAt ? new Date(creds.expiresAt) : null;
  const refreshExpiresAt = creds.refreshExpiresAt
    ? new Date(creds.refreshExpiresAt)
    : null;

  // Refresh if the token expires within the next 10 minutes
  const needsRefresh =
    expiresAt !== null && expiresAt.getTime() - Date.now() < 10 * 60 * 1000;

  if (!needsRefresh) {
    return creds.accessToken;
  }

  if (!creds.refreshToken) {
    throw new Error(
      "TikTok access token has expired and no refresh token is stored. Please reconnect your TikTok account."
    );
  }

  if (refreshExpiresAt && refreshExpiresAt.getTime() < Date.now()) {
    throw new Error(
      "TikTok refresh token has expired. Please reconnect your TikTok account."
    );
  }

  const newToken = await tiktokBusinessClient.refreshAccessToken(
    creds.refreshToken
  );

  const updatedCreds = {
    ...creds,
    accessToken: newToken.access_token,
    refreshToken: newToken.refresh_token,
    expiresAt: new Date(
      Date.now() + (newToken.expires_in ?? 86400) * 1000
    ).toISOString(),
    refreshExpiresAt: new Date(
      Date.now() + (newToken.refresh_token_expires_in ?? 2592000) * 1000
    ).toISOString(),
  };

  await (prisma.connection as any).update({
    where: { id: conn.id },
    data: { credentials: encrypt(JSON.stringify(updatedCreds)) },
  });

  return newToken.access_token;
}
