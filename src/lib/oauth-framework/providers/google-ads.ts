/**
 * Google Ads OAuth Provider Adapter
 */

import {
    OAuthProviderAdapter,
    OAuthCredentials,
    ConnectionMetadata,
    ConnectedAccount,
    OAuthError,
} from "../types";
import { googleAdsOAuthClient, googleAdsReportClient } from "@/lib/google-ads";

export class GoogleAdsOAuthAdapter implements OAuthProviderAdapter {
    readonly id = "google_ads";
    readonly name = "Google Ads";
    readonly authType = "oauth" as const;

    buildAuthorizeUrl({
        redirectUri,
        state,
    }: {
        workspaceId: string;
        redirectUri: string;
        state: string;
    }): string {
        return googleAdsOAuthClient.getAuthorizeUrl(state, redirectUri);
    }

    async exchangeCode({
        code,
        redirectUri,
    }: {
        code: string;
        redirectUri: string;
        metadata: { workspaceId: string; userId: string };
    }): Promise<{ credentials: OAuthCredentials; metadata: ConnectionMetadata }> {
        const tokenData = await googleAdsOAuthClient.exchangeCode(code, redirectUri);

        // Get customer IDs (MCC structure)
        const accessibleCustomerIds = await googleAdsOAuthClient.listAccessibleCustomers(
            tokenData.access_token
        );
        const { eligibleCustomerIds: customerIds, excludedCustomerIds } = await googleAdsReportClient.resolveEligibleCustomerRoots(
            tokenData.access_token,
            accessibleCustomerIds,
        );

        if (customerIds.length === 0) {
            throw new OAuthError(
                "provider_error",
                "No active Google Ads customer accounts are available. Activate an account in Google Ads, then reconnect.",
                this.id,
            );
        }

        const credentials: OAuthCredentials = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
        };

        const metadata: ConnectionMetadata = {
            name: `Google Ads (${customerIds.length} account${customerIds.length === 1 ? "" : "s"})`,
            accountIdentifiers: customerIds,
            extraFields: {
                customerIds,
                unavailableCustomerCount: excludedCustomerIds.length,
                // NOTE: the developer token is deliberately NOT stored here.
                // It is an app-level secret consumed from the environment at
                // call time (see google-ads.ts); persisting it would duplicate
                // the secret into every connection row.
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
            customerIds?: string[];
        };
        if (!creds?.customerIds?.length) return [];

        return creds.customerIds.map((id) => ({
            id,
            name: `Customer ${id}`,
            type: "customer" as const,
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

        const refreshed = await googleAdsOAuthClient.refreshAccessToken(
            creds.refreshToken
        );

        return {
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token,
            expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
        };
    }
}
