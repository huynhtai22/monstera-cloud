/**
 * OAuth Framework - Account Extraction Bridge
 * Bridges between encrypted credentials and UI display
 */

import { safeDecrypt } from "@/lib/encryption";
import { getProvider } from "./registry";
import type { ConnectedAccount } from "./types";

/**
 * Extract displayable accounts from a connection's encrypted credentials
 * Uses the provider adapter if available, falls back to legacy parsing
 */
export function extractAccountsFromConnection(
    providerId: string,
    encryptedCredentials: string | unknown
): ConnectedAccount[] {
    // Decrypt if needed
    const credsString =
        typeof encryptedCredentials === "string"
            ? encryptedCredentials
            : JSON.stringify(encryptedCredentials);

    let parsed: unknown;
    try {
        const decrypted = safeDecrypt(credsString);
        parsed = JSON.parse(decrypted);
    } catch {
        // If decryption/parsing fails, try parsing raw
        try {
            parsed = JSON.parse(credsString);
        } catch {
            return [];
        }
    }

    // Try provider adapter first
    try {
        const provider = getProvider(providerId);
        return provider.extractAccounts(parsed);
    } catch {
        // Fall back to legacy parsing
        return legacyExtractAccounts(providerId, parsed);
    }
}

/**
 * Legacy account extraction - mirrors the logic in sources/page.tsx
 * @deprecated Use provider adapter instead
 */
function legacyExtractAccounts(
    providerId: string,
    credentials: unknown
): ConnectedAccount[] {
    const creds = credentials as Record<string, unknown>;

    switch (providerId) {
        case "meta_ads": {
            const list: Array<{ id: string; name?: string }> =
                (creds.adAccounts as Array<{ id: string; name?: string }>) ??
                ((creds.adAccountIds as string[]) ?? []).map((id: string) => ({ id }));
            return list.map((a) => ({
                id: a.id,
                name: a.name && a.name !== a.id ? a.name : a.id.replace(/^act_/, ""),
                type: "ad-account" as const,
            }));
        }
        case "google_ads": {
            const ids = (creds.customerIds as string[]) ?? [];
            return ids.map((id) => ({
                id,
                name: `Customer ${id}`,
                type: "customer" as const,
            }));
        }
        case "tiktok_business": {
            const ids = (creds.advertiserIds as string[]) ?? [];
            return ids.map((id) => ({
                id,
                name: `Advertiser ${id}`,
                type: "advertiser" as const,
            }));
        }
        case "shopee": {
            const shopId = creds.shopId as string | number;
            if (!shopId) return [];
            return [
                {
                    id: String(shopId),
                    name: `Shop ${shopId}`,
                    type: "shop" as const,
                },
            ];
        }
        case "tiktok_shop": {
            const sellerId = creds.sellerId as string;
            const sellerName = creds.sellerName as string;
            if (!sellerId) return [];
            return [
                {
                    id: sellerId,
                    name: sellerName || `Seller ${sellerId}`,
                    type: "seller-center" as const,
                },
            ];
        }
        case "lazada": {
            const sellerId = (creds.sellerId as string) || (creds.seller_id as string);
            const country = creds.country as string;
            if (!sellerId) return [];
            return [
                {
                    id: sellerId,
                    name: `Seller ${sellerId}${country ? ` (${country})` : ""}`,
                    type: "seller-center" as const,
                },
            ];
        }
        case "shopify": {
            const shop = creds.shop as string;
            if (!shop) return [];
            return [
                {
                    id: shop,
                    name: shop.replace(".myshopify.com", ""),
                    type: "shop" as const,
                },
            ];
        }
        case "amazon": {
            return [
                {
                    id: "sp-api",
                    name: "Selling Partner API",
                    type: "seller-center" as const,
                },
            ];
        }
        default:
            return [];
    }
}

/**
 * Format account tags for display in the sources list
 */
export function formatAccountTags(accounts: ConnectedAccount[]): string[] {
    return accounts.map((a) => a.name || a.id);
}
