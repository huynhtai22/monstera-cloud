import prisma from '@/lib/prisma';
import { getProvider } from './registry';
import { encrypt, safeDecrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import {
    normalizeStoredShopeeCreds,
    serializeShopeeStoredCreds,
    SHOPEE_DEFAULT_EXPIRE_IN_SEC,
} from '@/lib/shopee-credential-utils';

/**
 * Validates an OAuth connection's access token and refreshes it if necessary.
 * Replaces provider-specific refresh helpers.
 */
export async function getValidOAuthToken(conn: {
    id: string;
    credentials: string;
    provider: string;
}): Promise<string> {
    const adapter = getProvider(conn.provider);
    if (!adapter) {
        throw new Error(`OAuth provider not found for ${conn.provider}`);
    }

    const creds = JSON.parse(safeDecrypt(conn.credentials)) as {
        accessToken: string;
        expiresAt?: string;
        refreshToken?: string;
        tokenMode?: string;
        [key: string]: unknown;
    };

    // TikTok Ads advertiser authorization uses a long-lived access token. It
    // has no refresh token by design and becomes invalid only if the advertiser
    // revokes the app's authorization. Do not route it through refresh logic.
    const isTikTokLongLivedAdvertiserToken =
        conn.provider === "tiktok_business" &&
        (creds.tokenMode === "long_lived_advertiser" ||
            (!creds.refreshToken && !creds.expiresAt));
    if (isTikTokLongLivedAdvertiserToken) {
        if (!creds.accessToken) {
            throw new Error("TikTok long-lived access token is missing; reconnect TikTok Ads");
        }
        return creds.accessToken;
    }

    const expiresAt = creds.expiresAt ? new Date(creds.expiresAt) : null;

    // Define refresh window based on provider
    let refreshWindowMs = 5 * 60 * 1000; // default 5 minutes
    if (conn.provider === 'meta_ads') {
        refreshWindowMs = 7 * 24 * 60 * 60 * 1000; // 7 days for Meta
    } else if (conn.provider === 'shopee') {
        refreshWindowMs = 30 * 60 * 1000; // align with getValidShopeeCreds (~4h access token)
    }

    const needsRefresh =
        expiresAt === null || expiresAt.getTime() - Date.now() < refreshWindowMs;

    if (!needsRefresh) {
        return creds.accessToken;
    }

    if (!adapter.refreshCredentials) {
        logger.warn(`Provider ${conn.provider} does not support token refresh`);
        return creds.accessToken;
    }

    try {
        const refreshed = await adapter.refreshCredentials(creds);

        let stored: Record<string, unknown>;
        if (conn.provider === 'shopee') {
            const normalized = normalizeStoredShopeeCreds({
                ...creds,
                access_token: refreshed.accessToken,
                refresh_token: refreshed.refreshToken ?? creds.refreshToken,
                expire_in: refreshed.expiresAt
                    ? Math.max(
                          60,
                          Math.round(
                              (refreshed.expiresAt.getTime() - Date.now()) / 1000
                          )
                      )
                    : SHOPEE_DEFAULT_EXPIRE_IN_SEC,
                shop_id: (refreshed as { shopId?: number }).shopId ?? creds.shopId,
                sandbox: creds.sandbox,
            });
            stored = serializeShopeeStoredCreds(normalized, { markTokenFresh: true });
        } else {
            stored = {
                ...creds,
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken ?? creds.refreshToken,
                expiresAt: refreshed.expiresAt?.toISOString() ?? creds.expiresAt,
            };
        }

        await (prisma as any).connection.update({
            where: { id: conn.id },
            data: { credentials: encrypt(JSON.stringify(stored)) },
        });

        return refreshed.accessToken;
    } catch (e: any) {
        logger.error(`Failed to refresh token for connection ${conn.id}: ${e.message}`);
        // Throwing here so the downstream caller handles the auth failure (e.g., UI prompts reconnect)
        throw e;
    }
}
