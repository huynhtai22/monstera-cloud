import { safeDecrypt } from "@/lib/encryption";

/** Strip secrets from encrypted credentials JSON for API responses. */
export function sanitizeConnectionCredentials(raw: string): string {
    try {
        const parsed = JSON.parse(safeDecrypt(raw ?? "{}")) as Record<string, unknown>;
        const {
            spreadsheetId,
            shopId,
            advertiserIds,
            adAccountIds,
            adAccounts,
            customerIds,
            mccId,
            sandbox,
            product,
        } = parsed as Record<string, unknown>;
        return JSON.stringify({
            spreadsheetId,
            shopId,
            advertiserIds,
            adAccountIds,
            adAccounts,
            customerIds,
            mccId,
            sandbox,
            product,
        });
    } catch {
        return "{}";
    }
}
