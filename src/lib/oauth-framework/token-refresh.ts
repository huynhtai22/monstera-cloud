import prisma from '@/lib/prisma';
import { getProvider } from './registry';
import { encrypt, safeDecrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';

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
        [key: string]: unknown;
    };

    const expiresAt = creds.expiresAt ? new Date(creds.expiresAt) : null;

    // Define refresh window based on provider
    let refreshWindowMs = 5 * 60 * 1000; // default 5 minutes
    if (conn.provider === 'meta_ads') {
        refreshWindowMs = 7 * 24 * 60 * 60 * 1000; // 7 days for Meta
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

        const updatedCreds = {
            ...creds,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken ?? creds.refreshToken,
            expiresAt: refreshed.expiresAt?.toISOString() ?? creds.expiresAt,
        };

        await (prisma as any).connection.update({
            where: { id: conn.id },
            data: { credentials: encrypt(JSON.stringify(updatedCreds)) },
        });

        return refreshed.accessToken;
    } catch (e: any) {
        logger.error(`Failed to refresh token for connection ${conn.id}: ${e.message}`);
        // Throwing here so the downstream caller handles the auth failure (e.g., UI prompts reconnect)
        throw e;
    }
}
