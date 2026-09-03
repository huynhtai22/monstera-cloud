import { safeDecrypt } from "@/lib/encryption";

/** Strip secrets from encrypted credentials JSON for API responses. */
export function sanitizeConnectionCredentials(raw: string): string {
    try {
        const parsed = JSON.parse(safeDecrypt(raw ?? "{}")) as Record<string, unknown>;
        const {
            spreadsheetId,
            shopId,
            shopDomain,
            domain,
            sellerId,
            seller_id,
            sellingPartnerId,
            googleAdsRootType,
            advertiserIds,
            adAccountIds,
            adAccounts,
            customerIds,
            mccId,
            managerCustomerId,
            sandbox,
            product,
            accountEmail,
            accountName,
            mccName,
            managerName,
            discoveredCustomerCount,
        } = parsed as Record<string, unknown>;
        return JSON.stringify({
            spreadsheetId,
            shopId,
            shopDomain,
            domain,
            sellerId,
            seller_id,
            sellingPartnerId,
            googleAdsRootType,
            advertiserIds,
            adAccountIds,
            adAccounts,
            customerIds,
            mccId,
            managerCustomerId,
            sandbox,
            product,
            accountEmail,
            accountName,
            mccName,
            managerName,
            discoveredCustomerCount,
        });
    } catch {
        return "{}";
    }
}
