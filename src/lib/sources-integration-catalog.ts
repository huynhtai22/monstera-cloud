import { logoPathForCatalogId } from "@/lib/integration-logos";
import { isPilotCertifiedProvider, isUncertifiedProvider } from "@/lib/integration-flags";

export type SourcesCatalogItem = {
    id: string;
    name: string;
    description: string;
    logoSrc: string;
};

/** Full source catalog for Sources UI and connect flows (order = ads & marketplaces first). */
export const SOURCES_CATALOG: readonly SourcesCatalogItem[] = [
    {
        id: "meta_ads",
        name: "Meta Ads",
        description: "Facebook & Instagram Ads — campaign, ad set, and ad performance via Marketing API.",
        logoSrc: logoPathForCatalogId("meta_ads"),
    },
    {
        id: "google_ads",
        name: "Google Ads",
        description: "Search, Shopping, and Performance Max reporting via Google Ads API.",
        logoSrc: logoPathForCatalogId("google_ads"),
    },
    {
        id: "tiktok_business",
        name: "TikTok Ads",
        description: "TikTok Marketing API — campaign and ad performance reporting.",
        logoSrc: logoPathForCatalogId("tiktok_business"),
    },
    {
        id: "shopee",
        name: "Shopee",
        description: "Orders, products, and shop analytics from Shopee Open Platform.",
        logoSrc: logoPathForCatalogId("shopee"),
    },
    {
        id: "tiktok_shop",
        name: "TikTok Shop",
        description: "Seller catalog, orders, and Shop analytics.",
        logoSrc: logoPathForCatalogId("tiktok_shop"),
    },
    {
        id: "lazada",
        name: "Lazada Seller",
        description: "Order fulfillments and finance.",
        logoSrc: logoPathForCatalogId("lazada"),
    },
    {
        id: "shopify",
        name: "Shopify",
        description: "E-commerce platform orders.",
        logoSrc: logoPathForCatalogId("shopify"),
    },
    {
        id: "amazon",
        name: "Amazon Selling Partner",
        description: "Seller Central — SP-API OAuth (orders sync pipeline coming next).",
        logoSrc: logoPathForCatalogId("amazon"),
    },
] as const;

export function catalogItemById(id: string): SourcesCatalogItem | undefined {
    return SOURCES_CATALOG.find((c) => c.id === id);
}

export type IntegrationsPublicConfig = {
    tiktokShop?: boolean;
    tiktokBusiness?: boolean;
    shopee?: boolean;
    metaAds?: boolean;
    googleAds?: boolean;
    amazon?: boolean;
    lazada?: boolean;
    shopify?: boolean;
};

/** Whether OAuth/env is enabled for this connector on the deployment (matches `/api/integrations/config`). */
export function isSourceEnvReady(
    catalogId: string,
    intConfig: IntegrationsPublicConfig | undefined
): boolean {
    if (isUncertifiedProvider(catalogId)) {
        if (!intConfig) return false;
        if (catalogId === "tiktok_shop") return intConfig.tiktokShop === true;
        if (catalogId === "amazon") return intConfig.amazon === true;
        if (catalogId === "lazada") return intConfig.lazada === true;
        if (catalogId === "shopify") return intConfig.shopify === true;
        return false;
    }
    if (!intConfig) return isPilotCertifiedProvider(catalogId);
    if (catalogId === "tiktok_business") return intConfig.tiktokBusiness !== false;
    if (catalogId === "shopee") return intConfig.shopee !== false;
    if (catalogId === "meta_ads") return intConfig.metaAds !== false;
    if (catalogId === "google_ads") return intConfig.googleAds !== false;
    return isPilotCertifiedProvider(catalogId);
}

/** Connect picker: certified sources always listed; uncertified only when explicitly enabled. */
export function visibleSourcesCatalog(
    intConfig: IntegrationsPublicConfig | undefined,
    enabledProviders?: Iterable<string>,
): SourcesCatalogItem[] {
    const enabled = enabledProviders ? new Set(enabledProviders) : null;
    return SOURCES_CATALOG.filter((item) => {
        if (enabled && !enabled.has(item.id)) return false;
        if (isPilotCertifiedProvider(item.id)) return true;
        return isSourceEnvReady(item.id, intConfig);
    });
}

/** Maps DB Connection.provider → console catalog card id (one connect slot per type). */
export function integrationCatalogId(provider: string): string {
    const p = (provider || "").toLowerCase();
    if (p === "tiktok") return "tiktok_shop";
    if (p === "tiktok_shop") return "tiktok_shop";
    if (p === "tiktok_business") return "tiktok_business";
    if (p === "shopee") return "shopee";
    if (p === "meta_ads") return "meta_ads";
    if (p === "google_ads") return "google_ads";
    if (p === "amazon") return "amazon";
    if (p === "lazada") return "lazada";
    return provider;
}
