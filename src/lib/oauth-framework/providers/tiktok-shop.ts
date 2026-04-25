/**
 * TikTok Shop OAuth Provider Adapter
 */

import {
    OAuthProviderAdapter,
    OAuthCredentials,
    ConnectionMetadata,
    ConnectedAccount,
    OAuthError,
} from "../types";
import { tiktokClient } from "@/lib/tiktok-shop";

export class TikTokShopOAuthAdapter implements OAuthProviderAdapter {
    readonly id = "tiktok_shop";
    readonly name = "TikTok Shop";
    readonly authType = "oauth" as const;

    buildAuthorizeUrl({
        state,
    }: {
        workspaceId: string;
        redirectUri: string;
        state: string;
    }): string {
        return tiktokClient.getAuthUrl(state);
    }

    async exchangeCode({
        code,
    }: {
        code: string;
        redirectUri: string;
        metadata: { workspaceId: string; userId: string };
    }): Promise<{ credentials: OAuthCredentials; metadata: ConnectionMetadata }> {
        const tokenData = await tiktokClient.getAccessToken(code);

        const credentials: OAuthCredentials = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: new Date(
                Date.now() + tokenData.access_token_expire_in * 1000
            ),
            sellerId: tokenData.seller_id,
            openId: tokenData.open_id,
        };

        const metadata: ConnectionMetadata = {
            name: tokenData.seller_name || `TikTok Shop (${tokenData.seller_id})`,
            accountIdentifiers: [tokenData.seller_id],
            extraFields: {
                sellerId: tokenData.seller_id,
                sellerName: tokenData.seller_name,
                openId: tokenData.open_id,
            },
        };

        return { credentials, metadata };
    }

    validateCredentials(credentials: unknown): boolean {
        const creds = credentials as Record<string, unknown> | undefined;
        if (!creds) return false;
        return (
            typeof creds.accessToken === "string" &&
            creds.accessToken.length > 0 &&
            typeof creds.sellerId === "string"
        );
    }

    extractAccounts(credentials: unknown): ConnectedAccount[] {
        const creds = credentials as {
            sellerId?: string;
            sellerName?: string;
        };
        if (!creds?.sellerId) return [];

        return [
            {
                id: creds.sellerId,
                name: creds.sellerName || `Seller ${creds.sellerId}`,
                type: "seller-center" as const,
            },
        ];
    }

    async refreshCredentials(
        credentials: unknown
    ): Promise<OAuthCredentials> {
        const creds = credentials as { refreshToken?: string };
        if (!creds.refreshToken) {
            throw new OAuthError(
                "provider_error",
                "No refresh token available",
                this.id
            );
        }

        const refreshed = await tiktokClient.refreshAccessToken(
            creds.refreshToken
        );

        return {
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token,
            expiresAt: new Date(
                Date.now() + refreshed.access_token_expire_in * 1000
            ),
            sellerId: refreshed.seller_id,
        };
    }
}
