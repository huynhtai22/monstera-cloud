/**
 * Source UI Registry
 * Provider-specific UI configuration for the ConnectSourceModal
 * Part of the OAuth Framework architecture refactor
 */
export type SourceAuthType = "oauth" | "oauth-with-domain" | "api-key";

export interface SourceUIConfig {
    id: string;
    name: string;
    /** Auth flow type determines UI behavior */
    authType: SourceAuthType;
    /** Step 1: Authorization content */
    stepContent: {
        title: string;
        subtitle: string;
        permissions: string[];
        footnote: string;
    };
    /** Button styling */
    buttonStyle: "facebook" | "google" | "default";
    /** Whether to show additional input (e.g., shop domain for Shopify) */
    requiresDomainInput?: boolean;
    domainInputLabel?: string;
    domainInputPlaceholder?: string;
    /** Whether this source shows production vs session URL comparison */
    showCallbackComparison?: boolean;
}

/** UI configurations for all sources - centralized replacement for modal conditionals */
export const SOURCE_UI_REGISTRY: Record<string, SourceUIConfig> = {
    meta_ads: {
        id: "meta_ads",
        name: "Meta Ads",
        authType: "oauth",
        stepContent: {
            title: "Connect Meta Ads",
            subtitle: "Import Facebook and Instagram advertising performance into this workspace. You'll authorize read-only access using your Meta account.",
            permissions: [
                "Ad account structure (campaigns, ad sets, ads)",
                "Performance metrics and reporting",
                "Ad account information",
            ],
            footnote: "Monstera cannot edit, publish, pause, or modify your ads.",
        },
        buttonStyle: "facebook",
        showCallbackComparison: true,
    },
    google_ads: {
        id: "google_ads",
        name: "Google Ads",
        authType: "oauth",
        stepContent: {
            title: "Connect Google Ads",
            subtitle: "Import Google Ads campaign and performance data into this workspace. You'll authorize read-only access using your Google account.",
            permissions: [
                "Accessible Google Ads customer accounts",
                "Campaign and performance data for reporting",
                "Spend and conversion metrics",
            ],
            footnote: "Monstera cannot modify your Google Ads campaigns.",
        },
        buttonStyle: "google",
        showCallbackComparison: true,
    },
    lazada: {
        id: "lazada",
        name: "Lazada",
        authType: "oauth",
        stepContent: {
            title: "Connect Lazada",
            subtitle: "Import Lazada seller data into this workspace via the Open Platform.",
            permissions: [
                "Orders and fulfillment data",
                "Seller finance and payout data",
                "Shop performance metrics",
            ],
            footnote: "Monstera cannot modify your store or listings.",
        },
        buttonStyle: "default",
        showCallbackComparison: true,
    },
    amazon: {
        id: "amazon",
        name: "Amazon SP",
        authType: "oauth",
        stepContent: {
            title: "Connect Amazon",
            subtitle: "Import Amazon Selling Partner data into this workspace via the SP-API.",
            permissions: [
                "Selling partner account access via Amazon OAuth",
                "Order and inventory data for reporting",
            ],
            footnote: "Monstera cannot modify your Amazon listings or orders.",
        },
        buttonStyle: "default",
        showCallbackComparison: true,
    },
    shopify: {
        id: "shopify",
        name: "Shopify",
        authType: "oauth-with-domain",
        stepContent: {
            title: "Connect Shopify",
            subtitle: "Import Shopify store data into this workspace. Enter your store domain to begin.",
            permissions: [
                "Read orders and customer data",
                "Read product catalog and inventory",
            ],
            footnote: "You'll be redirected to Shopify to approve access. Monstera cannot modify your store.",
        },
        buttonStyle: "default",
        requiresDomainInput: true,
        domainInputLabel: "Store Domain",
        domainInputPlaceholder: "your-store.myshopify.com",
    },
    // Marketplace sources with default content
    shopee: {
        id: "shopee",
        name: "Shopee",
        authType: "oauth",
        stepContent: {
            title: "Connect Shopee",
            subtitle: "Import Shopee seller data into this workspace via Shopee Open Platform.",
            permissions: [
                "Orders and fulfillment status",
                "Product inventory and performance",
                "Shop sales metrics",
            ],
            footnote: "Monstera cannot modify your store or listings.",
        },
        buttonStyle: "default",
    },
    tiktok_shop: {
        id: "tiktok_shop",
        name: "TikTok Shop",
        authType: "oauth",
        stepContent: {
            title: "Connect TikTok Shop",
            subtitle: "Import TikTok Shop seller data into this workspace.",
            permissions: [
                "Orders and fulfillment data",
                "Product and inventory information",
                "Shop performance metrics",
            ],
            footnote: "Monstera cannot modify your shop or listings.",
        },
        buttonStyle: "default",
    },
    tiktok_business: {
        id: "tiktok_business",
        name: "TikTok Ads",
        authType: "oauth",
        stepContent: {
            title: "Connect TikTok Ads",
            subtitle: "Import TikTok advertising performance into this workspace via the Marketing API.",
            permissions: [
                "Advertiser account structure",
                "Campaign and ad performance metrics",
                "Spend and engagement data",
            ],
            footnote: "Monstera cannot modify your TikTok ad campaigns.",
        },
        buttonStyle: "default",
    },
};

/** Get UI config for a source */
export function getSourceUIConfig(sourceId: string): SourceUIConfig | undefined {
    return SOURCE_UI_REGISTRY[sourceId];
}

/** Check if source requires domain input (Shopify-style) */
export function requiresDomainInput(sourceId: string): boolean {
    return SOURCE_UI_REGISTRY[sourceId]?.requiresDomainInput ?? false;
}

/** Build the unified OAuth URL for any source */
export function buildSourceAuthUrl(
    sourceId: string,
    workspaceId: string,
    options?: { domain?: string }
): string {
    const config = SOURCE_UI_REGISTRY[sourceId];
    if (!config) {
        throw new Error(`Unknown source: ${sourceId}`);
    }

    // Build state with optional domain for Shopify
    const stateData: Record<string, string> = {
        workspaceId,
        provider: sourceId,
    };
    
    if (config.requiresDomainInput && options?.domain) {
        stateData.shop = options.domain;
    }

    const state = Buffer.from(JSON.stringify(stateData)).toString("base64url");

    // Use new unified OAuth endpoint
    const params = new URLSearchParams({
        provider: sourceId,
        workspaceId,
        state,
    });

    return `/api/auth/connect?${params.toString()}`;
}

/** Get button class for source */
export function getSourceButtonClass(buttonStyle: string): string {
    const baseClasses =
        "inline-flex w-full items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

    switch (buttonStyle) {
        case "facebook":
            return `${baseClasses} bg-[#1877F2] hover:bg-[#166fe0] text-white`;
        case "google":
            return `${baseClasses} border border-line bg-white text-neutral-900 hover:bg-neutral-100`;
        default:
            return `${baseClasses} bg-primary hover:bg-primary-hover text-primary-foreground`;
    }
}
