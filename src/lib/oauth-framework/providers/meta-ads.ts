/**
 * Meta Ads OAuth Provider Adapter
 */

import {
    OAuthProviderAdapter,
    OAuthCredentials,
    ConnectionMetadata,
    ConnectedAccount,
    OAuthError,
} from "../types";
import { metaAdsClient } from "@/lib/meta-ads";

export class MetaAdsOAuthAdapter implements OAuthProviderAdapter {
    readonly id = "meta_ads";
    readonly name = "Meta Ads";
    readonly authType = "oauth" as const;

    buildAuthorizeUrl({
        redirectUri,
        state,
    }: {
        workspaceId: string;
        redirectUri: string;
        state: string;
    }): string {
        return metaAdsClient.getAuthorizeUrl(state, redirectUri);
    }

    async exchangeCode({
        code,
        redirectUri,
    }: {
        code: string;
        redirectUri: string;
        metadata: { workspaceId: string; userId: string };
    }): Promise<{ credentials: OAuthCredentials; metadata: ConnectionMetadata }> {
        // Exchange for long-lived token (client handles short→long internally)
        const longLived = await metaAdsClient.exchangeCode(code, redirectUri);

        // Get ad accounts for this user
        const accounts = await metaAdsClient.getAdAccounts(longLived.access_token);

        const credentials: OAuthCredentials = {
            accessToken: longLived.access_token,
            expiresAt: new Date(Date.now() + longLived.expires_in * 1000),
        };

        const accountIds = accounts.map((a) => a.id);

        const metadata: ConnectionMetadata = {
            name: `Meta (${accountIds.length} account${accountIds.length === 1 ? "" : "s"})`,
            accountIdentifiers: accountIds,
            extraFields: {
                adAccounts: accounts.map((a) => ({
                    id: a.id,
                    name: a.name,
                })),
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
            adAccounts?: Array<{ id: string; name: string }>;
        };
        if (!creds?.adAccounts) return [];

        return creds.adAccounts.map((a) => ({
            id: a.id,
            name: a.name || a.id,
            type: "ad-account" as const,
        }));
    }
}
