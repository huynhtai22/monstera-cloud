/**
 * TikTok for Business (Marketing API) OAuth Provider Adapter
 */

import {
    OAuthProviderAdapter,
    OAuthCredentials,
    ConnectionMetadata,
    ConnectedAccount,
    OAuthError,
} from "../types";
import { tiktokBusinessClient } from "@/lib/tiktok-business";

export class TikTokBusinessOAuthAdapter implements OAuthProviderAdapter {
    readonly id = "tiktok_business";
    readonly name = "TikTok Ads";
    readonly authType = "oauth" as const;

    buildAuthorizeUrl({
        redirectUri,
        state,
    }: {
        workspaceId: string;
        redirectUri: string;
        state: string;
    }): string {
        const { url } = tiktokBusinessClient.getAuthorizeUrl(state, redirectUri);
        return url;
    }

    async exchangeCode({
        code,
    }: {
        code: string;
        redirectUri: string;
        metadata: { workspaceId: string; userId: string };
    }): Promise<{ credentials: OAuthCredentials; metadata: ConnectionMetadata }> {
        // TikTok returns `auth_code` not `code`
        const tokenData = await tiktokBusinessClient.exchangeCode(code);

        const credentials: OAuthCredentials = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
        };

        const metadata: ConnectionMetadata = {
            name: `TikTok Ads (${tokenData.advertiser_ids.length} advertiser${
                tokenData.advertiser_ids.length === 1 ? "" : "s"
            })`,
            accountIdentifiers: tokenData.advertiser_ids,
            extraFields: {
                advertiserIds: tokenData.advertiser_ids,
                scope: tokenData.scope,
            },
        };

        return { credentials, metadata };
    }

    validateCredentials(credentials: unknown): boolean {
        const creds = credentials as Record<string, unknown> | undefined;
        if (!creds) return false;
        return typeof creds.accessToken === "string" && creds.accessToken.length > 0;
    }

    extractAccounts(credentials: unknown): ConnectedAccount[] {
        const creds = credentials as {
            advertiserIds?: string[];
        };
        if (!creds?.advertiserIds?.length) return [];

        return creds.advertiserIds.map((id) => ({
            id,
            name: `Advertiser ${id}`,
            type: "advertiser" as const,
        }));
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

        const refreshed = await tiktokBusinessClient.refreshAccessToken(
            creds.refreshToken
        );

        return {
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token,
            expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
        };
    }
}
