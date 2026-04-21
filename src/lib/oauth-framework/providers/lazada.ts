/**
 * Lazada OAuth Provider Adapter
 */

import {
    OAuthProviderAdapter,
    OAuthCredentials,
    ConnectionMetadata,
    ConnectedAccount,
    OAuthError,
} from "../types";
import {
    getLazadaAuthorizeUrl,
    exchangeLazadaAuthorizationCode,
} from "@/lib/lazada";

export class LazadaOAuthAdapter implements OAuthProviderAdapter {
    readonly id = "lazada";
    readonly name = "Lazada";
    readonly authType = "oauth" as const;

    buildAuthorizeUrl({
        redirectUri,
        state,
    }: {
        workspaceId: string;
        redirectUri: string;
        state: string;
    }): string {
        return getLazadaAuthorizeUrl({
            redirectUri,
            state,
        });
    }

    async exchangeCode({
        code,
    }: {
        code: string;
        redirectUri: string;
        metadata: { workspaceId: string; userId: string };
    }): Promise<{ credentials: OAuthCredentials; metadata: ConnectionMetadata }> {
        const tokenData = await exchangeLazadaAuthorizationCode(code);

        const credentials: OAuthCredentials = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
            sellerId: tokenData.seller_id,
            country: tokenData.country,
        };

        const metadata: ConnectionMetadata = {
            name: `Lazada${tokenData.country ? ` (${tokenData.country})` : ""}${
                tokenData.seller_id ? ` — ${tokenData.seller_id}` : ""
            }`,
            accountIdentifiers: tokenData.seller_id ? [tokenData.seller_id] : [],
            extraFields: {
                sellerId: tokenData.seller_id,
                country: tokenData.country,
                accountId: tokenData.account_id,
            },
        };

        return { credentials, metadata };
    }

    validateCredentials(credentials: unknown): boolean {
        const creds = credentials as Record<string, unknown> | undefined;
        if (!creds) return false;
        return (
            typeof creds.accessToken === "string" &&
            creds.accessToken.length > 0
        );
    }

    extractAccounts(credentials: unknown): ConnectedAccount[] {
        const creds = credentials as {
            sellerId?: string;
            country?: string;
        };
        if (!creds?.sellerId) return [];

        return [
            {
                id: creds.sellerId,
                name: `Seller ${creds.sellerId}${
                    creds.country ? ` (${creds.country})` : ""
                }`,
                type: "seller-center" as const,
            },
        ];
    }

    // Note: Lazada refresh token implementation needed in lib/lazada.ts
    // For now, mark as optional - requires re-auth when token expires
    async refreshCredentials?(): Promise<OAuthCredentials> {
        throw new OAuthError(
            "provider_error",
            "Lazada token refresh not yet implemented - please reconnect",
            this.id
        );
    }
}
