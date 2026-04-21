/**
 * Amazon Selling Partner API OAuth Provider Adapter
 */

import {
    OAuthProviderAdapter,
    OAuthCredentials,
    ConnectionMetadata,
    ConnectedAccount,
    OAuthError,
} from "../types";
import {
    getAmazonSpConsentUrl,
    exchangeAmazonSpAuthorizationCode,
} from "@/lib/amazon-sp";

export class AmazonOAuthAdapter implements OAuthProviderAdapter {
    readonly id = "amazon";
    readonly name = "Amazon SP";
    readonly authType = "oauth" as const;

    buildAuthorizeUrl({
        state,
    }: {
        workspaceId: string;
        redirectUri: string;
        state: string;
    }): string {
        return getAmazonSpConsentUrl(state);
    }

    async exchangeCode({
        code,
        redirectUri,
    }: {
        code: string;
        redirectUri: string;
        metadata: { workspaceId: string; userId: string };
    }): Promise<{ credentials: OAuthCredentials; metadata: ConnectionMetadata }> {
        // Amazon sends `spapi_oauth_code` not `code`
        const tokenData = await exchangeAmazonSpAuthorizationCode(code, redirectUri);

        const credentials: OAuthCredentials = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
        };

        const metadata: ConnectionMetadata = {
            name: "Amazon Selling Partner",
            accountIdentifiers: ["sp-api"],
            extraFields: {
                sellingPartnerId: "pending_user_config", // Requires additional seller registration
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
            typeof creds.refreshToken === "string"
        );
    }

    extractAccounts(credentials: unknown): ConnectedAccount[] {
        const creds = credentials as {
            sellingPartnerId?: string;
        };
        
        if (!creds?.sellingPartnerId || creds.sellingPartnerId === "pending_user_config") {
            return [
                {
                    id: "sp-api",
                    name: "Selling Partner API",
                    type: "seller-center" as const,
                },
            ];
        }

        return [
            {
                id: creds.sellingPartnerId,
                name: `Seller ${creds.sellingPartnerId}`,
                type: "seller-center" as const,
            },
        ];
    }

    // Note: Amazon SP uses standard OAuth refresh - token exchange already
    // returns refresh_token. Re-auth required when refresh_token expires.
    async refreshCredentials?(): Promise<OAuthCredentials> {
        throw new OAuthError(
            "provider_error",
            "Amazon SP requires re-authentication when token expires",
            this.id
        );
    }
}
