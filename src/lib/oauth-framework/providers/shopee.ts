/**
 * Shopee OAuth Provider Adapter
 * Implements OAuthProviderAdapter for Shopee Open Platform v2
 */

import {
    OAuthProviderAdapter,
    OAuthCredentials,
    ConnectionMetadata,
    ConnectedAccount,
    OAuthError,
} from "../types";
import { shopeeClient } from "@/lib/shopee";

export class ShopeeOAuthAdapter implements OAuthProviderAdapter {
    readonly id = "shopee";
    readonly name = "Shopee";
    readonly authType = "oauth" as const;

    buildAuthorizeUrl({
        redirectUri,
        state,
    }: {
        workspaceId: string;
        redirectUri: string;
        state: string;
    }): string {
        return shopeeClient.getAuthorizeUrl(redirectUri, state);
    }

    async exchangeCode({
        code,
        metadata,
    }: {
        code: string;
        redirectUri: string;
        metadata: { workspaceId: string; userId: string };
    }): Promise<{ credentials: OAuthCredentials; metadata: ConnectionMetadata }> {
        // Shopee callback includes shop_id in query params
        // The code string here should include shop_id or we need to parse it
        const [authCode, shopIdStr] = code.split("|");
        const shopId = Number(shopIdStr);

        if (!shopId || isNaN(shopId)) {
            throw new OAuthError(
                "provider_error",
                "Shopee authorization missing shop_id",
                this.id
            );
        }

        const tokenData = await shopeeClient.exchangeCode(authCode, shopId);

        const credentials: OAuthCredentials = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: new Date(
                Date.now() + (tokenData.expire_in ?? 14400) * 1000
            ),
            shopId: tokenData.shop_id,
        };

        const connectionMetadata: ConnectionMetadata = {
            name: `Shopee Shop (${tokenData.shop_id})`,
            accountIdentifiers: [String(tokenData.shop_id)],
            extraFields: {
                refreshExpiresAt: new Date(
                    Date.now() + 30 * 24 * 60 * 60 * 1000
                ).toISOString(),
                product: "shopee",
            },
        };

        return { credentials, metadata: connectionMetadata };
    }

    validateCredentials(credentials: unknown): boolean {
        const creds = credentials as Record<string, unknown> | undefined;
        if (!creds) return false;

        const hasAccessToken =
            typeof creds.accessToken === "string" && creds.accessToken.length > 0;
        const hasShopId =
            typeof creds.shopId === "number" || typeof creds.shopId === "string";

        return hasAccessToken && hasShopId;
    }

    extractAccounts(credentials: unknown): ConnectedAccount[] {
        const creds = credentials as Record<string, unknown> | undefined;
        if (!creds) return [];

        const shopId = creds.shopId;
        if (!shopId) return [];

        return [
            {
                id: String(shopId),
                name: `Shop ${shopId}`,
                type: "shop",
            },
        ];
    }

    async refreshCredentials(
        credentials: unknown
    ): Promise<OAuthCredentials> {
        const creds = credentials as {
            refreshToken?: string;
            shopId?: number;
        };

        if (!creds.refreshToken || !creds.shopId) {
            throw new OAuthError(
                "provider_error",
                "Missing refresh token or shop ID",
                this.id
            );
        }

        const refreshed = await shopeeClient.refreshAccessToken(
            creds.refreshToken,
            creds.shopId
        );

        return {
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token,
            expiresAt: new Date(
                Date.now() + (refreshed.expire_in ?? 14400) * 1000
            ),
            shopId: refreshed.shop_id,
        };
    }
}
