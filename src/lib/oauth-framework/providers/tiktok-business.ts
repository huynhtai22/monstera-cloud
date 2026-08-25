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

        const isLongLivedAdvertiserToken = !tokenData.refresh_token && !tokenData.expires_in;
        const credentials: OAuthCredentials = isLongLivedAdvertiserToken
            ? {
                  accessToken: tokenData.access_token,
                  tokenMode: "long_lived_advertiser",
              }
            : {
                  accessToken: tokenData.access_token,
                  refreshToken: tokenData.refresh_token,
                  expiresAt: new Date(Date.now() + Number(tokenData.expires_in) * 1000),
                  tokenMode: "refreshable",
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
        const creds = credentials as { refreshToken?: string; tokenMode?: string };
        if (creds.tokenMode === "long_lived_advertiser") {
            throw new OAuthError(
                "provider_error",
                "TikTok advertiser authorization uses a long-lived token and must not be refreshed",
                this.id
            );
        }
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

        const expiresIn = Number(refreshed.expires_in);
        if (!refreshed.refresh_token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
            throw new OAuthError(
                "provider_error",
                "TikTok returned an invalid refresh-token response",
                this.id
            );
        }

        return {
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token,
            expiresAt: new Date(Date.now() + expiresIn * 1000),
            tokenMode: "refreshable",
        };
    }
}
