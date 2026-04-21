/**
 * Shopify OAuth Provider Adapter
 * 
 * Note: Shopify requires a shop domain for OAuth, which must be
 * collected from the user before starting the flow.
 */

import {
    OAuthProviderAdapter,
    OAuthCredentials,
    ConnectionMetadata,
    ConnectedAccount,
    OAuthError,
} from "../types";
import { ShopifyOAuthClient } from "@/lib/shopify";

export class ShopifyOAuthAdapter implements OAuthProviderAdapter {
    readonly id = "shopify";
    readonly name = "Shopify";
    readonly authType = "oauth" as const;

    // Shopify requires shop domain - we'll encode it in state
    buildAuthorizeUrl({
        redirectUri,
        state,
    }: {
        workspaceId: string;
        redirectUri: string;
        state: string;
    }): string {
        // State encodes: {workspaceId, userId, shop}
        const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
        const shop = parsed.shop;
        
        if (!shop) {
            throw new OAuthError(
                "configuration_error",
                "Shopify requires shop domain",
                this.id
            );
        }

        const client = new ShopifyOAuthClient();
        return client.getAuthorizeUrl(shop, redirectUri, state);
    }

    async exchangeCode({
        code,
        metadata,
    }: {
        code: string;
        redirectUri: string;
        metadata: { workspaceId: string; userId: string };
    }): Promise<{ credentials: OAuthCredentials; metadata: ConnectionMetadata }> {
        // Need shop from state for token exchange
        // State is base64 JSON: {workspaceId, userId, shop}
        const stateStr = Buffer.from(metadata.workspaceId, "base64url").toString();
        const stateData = JSON.parse(stateStr);
        const shop = stateData.shop;

        if (!shop) {
            throw new OAuthError(
                "provider_error",
                "Shopify connection missing shop domain",
                this.id
            );
        }

        const client = new ShopifyOAuthClient();
        const tokenData = await client.exchangeCode(shop, code);

        const credentials: OAuthCredentials = {
            accessToken: tokenData.access_token,
            shop,
            scope: tokenData.scope,
        };

        const connMetadata: ConnectionMetadata = {
            name: `Shopify — ${shop}`,
            accountIdentifiers: [shop],
            extraFields: {
                shop,
                scope: tokenData.scope,
            },
        };

        return { credentials, metadata: connMetadata };
    }

    validateCredentials(credentials: unknown): boolean {
        const creds = credentials as Record<string, unknown> | undefined;
        if (!creds) return false;
        return (
            typeof creds.accessToken === "string" &&
            creds.accessToken.length > 0 &&
            typeof creds.shop === "string"
        );
    }

    extractAccounts(credentials: unknown): ConnectedAccount[] {
        const creds = credentials as {
            shop?: string;
        };
        if (!creds?.shop) return [];

        return [
            {
                id: creds.shop,
                name: creds.shop.replace(".myshopify.com", ""),
                type: "shop" as const,
            },
        ];
    }
}
