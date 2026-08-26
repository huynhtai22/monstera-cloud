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
import { logger } from "@/lib/logger";

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
        const [authCode, shopIdStr] = code.includes("|") ? code.split("|") : [code, ""];
        const parsedShopId = shopIdStr ? Number(shopIdStr) : undefined;

        if (!parsedShopId || isNaN(parsedShopId)) {
            throw new OAuthError(
                "provider_error",
                "Shopee authorization missing shop_id",
                this.id
            );
        }

        const tokenData = await shopeeClient.exchangeCode(authCode, parsedShopId, isSandbox());
        const resolvedShopId = (tokenData.shop_id && Number.isFinite(tokenData.shop_id) && tokenData.shop_id > 0)
            ? tokenData.shop_id
            : (parsedShopId && Number.isFinite(parsedShopId) && parsedShopId > 0)
                ? parsedShopId
                : 0;

        if (!resolvedShopId) {
            throw new OAuthError(
                "provider_error",
                "Shopee authorization did not return a valid shop ID",
                this.id
            );
        }

        // Step 1: Fetch authoritative shop info to determine region eligibility
        let shopName = `Shopee Shop (${resolvedShopId})`;
        let region = isSandbox() ? "VN" : "UNKNOWN";
        let isCb = false;
        let merchantId: number | undefined;

        try {
            const shopInfo = await shopeeDataClient.getShopInfo({
                accessToken: tokenData.access_token,
                shopId: resolvedShopId,
                sandbox: isSandbox(),
            });
            region = (shopInfo.region || (isSandbox() ? "VN" : "UNKNOWN")).toUpperCase().trim();
            shopName = shopInfo.shop_name || shopName;
            isCb = shopInfo.is_cb;
            merchantId = shopInfo.merchant_id;

            // Enforce Vietnam-only capability policy (shop.region === 'VN' in production, bypass in sandbox)
            assertShopeeRegionEligible(region, "ads_reporting", isSandbox());
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
            // In sandbox mode, log warning and allow fallback if shopInfo is stubbed
            if (isSandbox()) {
                logger.warn(`[Shopee Sandbox] getShopInfo fallback: ${msg}`);
            } else {
                throw new OAuthError(
                    "provider_error",
                    `Failed to verify Shopee shop information: ${msg}`,
                    this.id
                );
            }
        }

        // Store sandbox flag and authoritative shop region with both camelCase and snake_case keys
        const credentials: OAuthCredentials = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: new Date(
                Date.now() + (tokenData.expire_in ?? 14400) * 1000
            ),
            shopId: resolvedShopId,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            shop_id: resolvedShopId,
            expire_in: tokenData.expire_in ?? 14400,
        };

        const connectionMetadata: ConnectionMetadata = {
            name: `${shopName} (${resolvedShopId})`,
            accountIdentifiers: [String(resolvedShopId)],
            extraFields: {
                refreshExpiresAt: new Date(
                    Date.now() + 30 * 24 * 60 * 60 * 1000
                ).toISOString(),
                product: "shopee",
                region,
                shopName,
                isCb,
                merchantId,
                shopId: resolvedShopId,
                shop_id: resolvedShopId,
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                sandbox: isSandbox(), // Store sandbox flag for refresh
            },
        };

        return { credentials, metadata: connectionMetadata };
    }

    validateCredentials(credentials: unknown): boolean {
        const creds = credentials as Record<string, unknown> | undefined;
        if (!creds) return false;

        const hasAccessToken =
            (typeof creds.accessToken === "string" && creds.accessToken.length > 0) ||
            (typeof creds.access_token === "string" && creds.access_token.length > 0);
        const shopIdVal = creds.shopId ?? creds.shop_id;
        const hasShopId =
            (typeof shopIdVal === "number" && shopIdVal > 0) ||
            (typeof shopIdVal === "string" && shopIdVal.length > 0);

        return Boolean(hasAccessToken && hasShopId);
    }

    extractAccounts(credentials: unknown): ConnectedAccount[] {
        const creds = credentials as Record<string, unknown> | undefined;
        if (!creds) return [];

        const shopId = creds.shopId ?? creds.shop_id;
        if (!shopId) return [];

        const name =
            (typeof creds.shopName === "string" && creds.shopName) ||
            `Shopee Shop (${shopId})`;

        return [
            {
                id: String(shopId),
                name,
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
