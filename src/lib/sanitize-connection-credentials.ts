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

function canonicalAccountId(provider: string, value: unknown): string {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (provider === "meta_ads") return trimmed.replace(/^act_/i, "");
    if (provider === "google_ads") return trimmed.replace(/\D/g, "");
    return trimmed;
}

/**
 * Project already-sanitized discovery metadata to an explicit client's exact
 * provider accounts. Root/manager display metadata remains available, but
 * sibling account ids and names are removed at the server boundary.
 */
export function sanitizeConnectionCredentialsForAccounts(
    raw: string,
    provider: string,
    assignedAccountIds: readonly string[],
): string {
    const safe = JSON.parse(sanitizeConnectionCredentials(raw)) as Record<string, unknown>;
    const allowed = new Set(assignedAccountIds.map((id) => canonicalAccountId(provider, id)).filter(Boolean));
    const filterIds = (value: unknown) => Array.isArray(value)
        ? value.filter((id) => allowed.has(canonicalAccountId(provider, id)))
        : [];

    safe.adAccountIds = filterIds(safe.adAccountIds);
    safe.advertiserIds = filterIds(safe.advertiserIds);
    safe.customerIds = filterIds(safe.customerIds);
    safe.adAccounts = Array.isArray(safe.adAccounts)
        ? safe.adAccounts.filter((account) => {
            if (!account || typeof account !== "object") return false;
            const row = account as Record<string, unknown>;
            return allowed.has(canonicalAccountId(provider, row.id ?? row.accountId));
        })
        : [];
    if (!allowed.has(canonicalAccountId(provider, safe.shopId))) delete safe.shopId;
    safe.discoveredCustomerCount = allowed.size;
    return JSON.stringify(safe);
}
