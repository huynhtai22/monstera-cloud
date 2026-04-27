/**
 * Source UI Registry
 * Provider-specific UI configuration for the ConnectSourceModal
 * Part of the OAuth Framework architecture refactor
 */

import React from "react";
import { Facebook } from "lucide-react";

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
            title: "Sign in with Facebook",
            subtitle:
                "You'll use your Facebook account to authorize read-only access to Meta Ads (Facebook and Instagram) for reporting in Monstera Cloud.",
            permissions: [
                "Read ad account structure (campaigns, ad sets, ads)",
                "Read performance metrics and insights for reporting",
            ],
            footnote: "We never post to Facebook or change your ads on your behalf.",
        },
        buttonStyle: "facebook",
        showCallbackComparison: true,
    },
    google_ads: {
        id: "google_ads",
        name: "Google Ads",
        authType: "oauth",
        stepContent: {
            title: "Sign in with Google",
            subtitle:
                "You'll use your Google account to authorize read-only access to Google Ads data for reporting in Monstera Cloud.",
            permissions: [
                "Read accessible Google Ads customer accounts",
                "Read campaign and performance data for reporting",
            ],
            footnote: "We never modify your Google Ads campaigns.",
        },
        buttonStyle: "google",
        showCallbackComparison: true,
    },
    lazada: {
        id: "lazada",
        name: "Lazada",
        authType: "oauth",
        stepContent: {
            title: "Authorize with Lazada",
            subtitle:
                "You will sign in to Lazada Open Platform and approve Monstera Cloud to access seller data allowed by your app registration.",
            permissions: [
                "Read orders and fulfillment data you authorize",
                "Store encrypted tokens for scheduled sync to your destinations",
            ],
            footnote: "Redirect URL must match your Lazada app callback exactly.",
        },
        buttonStyle: "default",
        showCallbackComparison: true,
    },
    amazon: {
        id: "amazon",
        name: "Amazon SP",
        authType: "oauth",
        stepContent: {
            title: "Authorize in Seller Central",
            subtitle:
                "You will sign in to Amazon Seller Central and approve our Selling Partner API application (Login with Amazon) for this workspace.",
            permissions: [
                "Link your selling partner account via Amazon OAuth",
                "Store encrypted refresh tokens for scheduled SP-API access",
            ],
            footnote: "Scopes follow your app registration in Amazon Developer Central.",
        },
        buttonStyle: "default",
        showCallbackComparison: true,
    },
    shopify: {
        id: "shopify",
        name: "Shopify",
        authType: "oauth-with-domain",
        stepContent: {
            title: "Connect Shopify Store",
            subtitle:
                "Enter your Shopify store domain to begin OAuth authorization.",
            permissions: [
                "Read orders and customer data",
                "Read product catalog and inventory",
            ],
            footnote: "You'll be redirected to Shopify to approve access.",
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
            title: "Authorize Shopee Access",
            subtitle:
                "You will sign in to Shopee Seller Center and approve Monstera Cloud to access your shop data.",
            permissions: [
                "Read daily orders and fulfillment status",
                "Read product inventory and performance",
                "Read campaign and sales metrics",
            ],
            footnote: "Monstera Cloud does not modify your live store or campaigns.",
        },
        buttonStyle: "default",
    },
    tiktok_shop: {
        id: "tiktok_shop",
        name: "TikTok Shop",
        authType: "oauth",
        stepContent: {
            title: "Authorize TikTok Shop",
            subtitle:
                "You will sign in to TikTok Shop Seller Center and approve data access for this workspace.",
            permissions: [
                "Read orders and fulfillment data",
                "Read product and inventory information",
                "Read shop performance metrics",
            ],
            footnote: "Monstera Cloud does not modify your shop or listings.",
        },
        buttonStyle: "default",
    },
    tiktok_business: {
        id: "tiktok_business",
        name: "TikTok Ads",
        authType: "oauth",
        stepContent: {
            title: "Connect TikTok for Business",
            subtitle:
                "You will sign in to TikTok Business Center and authorize access to your advertising data.",
            permissions: [
                "Read advertiser account structure",
                "Read campaign and ad performance metrics",
            ],
            footnote: "We never modify your TikTok ad campaigns.",
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
        "inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0f172a]";

    switch (buttonStyle) {
        case "facebook":
            return `${baseClasses} bg-[#1877F2] hover:bg-[#166fe0] text-white`;
        case "google":
            return `${baseClasses} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700`;
        default:
            return `${baseClasses} bg-primary hover:bg-primary-hover text-primary-foreground`;
    }
}
