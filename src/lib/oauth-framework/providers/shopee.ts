import {
    OAuthProviderAdapter,
    OAuthCredentials,
    ConnectionMetadata,
    ConnectedAccount,
    OAuthError,
} from "../types";
import { shopeeClient, shopeeDataClient } from "@/lib/shopee";
import { isShopeeSandboxEnabled } from "@/lib/shopee-env";
import { assertShopeeRegionEligible } from "@/lib/provider-market-policy";

const isSandbox = () => isShopeeSandboxEnabled();

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
        return shopeeClient.getAuthorizeUrl(redirectUri, state, isSandbox());
    }

    async exchangeCode({
        code,
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

        const tokenData = await shopeeClient.exchangeCode(authCode, shopId, isSandbox());

        // Step 1: Immediately fetch authoritative shop info to determine region eligibility
        let shopName = `Shopee Shop (${tokenData.shop_id})`;
        let region = "UNKNOWN";
        let isCb = false;
        let merchantId: number | undefined;

        try {
            const shopInfo = await shopeeDataClient.getShopInfo({
                accessToken: tokenData.access_token,
                shopId: tokenData.shop_id,
                sandbox: isSandbox(),
            });
            region = (shopInfo.region || "").toUpperCase().trim();
            shopName = shopInfo.shop_name || shopName;
            isCb = shopInfo.is_cb;
            merchantId = shopInfo.merchant_id;

            // Enforce Vietnam-only capability policy (shop.region === 'VN')
            assertShopeeRegionEligible(region, "ads_reporting");
        } catch (err: unknown) {
            if (err instanceof OAuthError) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("Shopee capability") || msg.includes("restricted to [VN]")) {
                throw new OAuthError(
                    "configuration_error",
                    msg,
                    this.id
                );
            }
            throw new OAuthError(
                "provider_error",
                `Failed to verify Shopee shop information: ${msg}`,
                this.id
            );
        }

        // Store sandbox flag and authoritative shop region in extra fields
        const credentials: OAuthCredentials = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: new Date(
                Date.now() + (tokenData.expire_in ?? 14400) * 1000
            ),
            shopId: tokenData.shop_id,
        };

        const connectionMetadata: ConnectionMetadata = {
            name: `${shopName} (${tokenData.shop_id})`,
            accountIdentifiers: [String(tokenData.shop_id)],
            extraFields: {
                refreshExpiresAt: new Date(
                    Date.now() + 30 * 24 * 60 * 60 * 1000
                ).toISOString(),
                product: "shopee",
                region,
                shopName,
                isCb,
                merchantId,
                sandbox: isSandbox(), // Store sandbox flag for refresh
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
            sandbox?: boolean;
        };

        if (!creds.refreshToken || !creds.shopId) {
            throw new OAuthError(
                "provider_error",
                "Missing refresh token or shop ID",
                this.id
            );
        }

        // P0 Fix: Pass sandbox flag from stored credentials
        const sandbox = creds.sandbox ?? isSandbox();

        const refreshed = await shopeeClient.refreshAccessToken(
            creds.refreshToken,
            creds.shopId,
            sandbox
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
