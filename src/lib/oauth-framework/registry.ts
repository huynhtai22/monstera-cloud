/**
 * OAuth Framework - Provider Registry
 * Central registry for all OAuth provider adapters
 */

import type { OAuthProviderAdapter, OAuthProviderRegistry } from "./types";
import { OAuthError } from "./types";
import { ShopeeOAuthAdapter } from "./providers/shopee";
import { MetaAdsOAuthAdapter } from "./providers/meta-ads";
import { GoogleAdsOAuthAdapter } from "./providers/google-ads";
import { TikTokShopOAuthAdapter } from "./providers/tiktok-shop";
import { TikTokBusinessOAuthAdapter } from "./providers/tiktok-business";
import { LazadaOAuthAdapter } from "./providers/lazada";
import { ShopifyOAuthAdapter } from "./providers/shopify";
import { AmazonOAuthAdapter } from "./providers/amazon";

/** Lazy-loaded registry */
let registry: OAuthProviderRegistry | null = null;

export function getProviderRegistry(): OAuthProviderRegistry {
    if (registry) return registry;
    
    registry = {
        shopee: new ShopeeOAuthAdapter(),
        meta_ads: new MetaAdsOAuthAdapter(),
        google_ads: new GoogleAdsOAuthAdapter(),
        tiktok_shop: new TikTokShopOAuthAdapter(),
        tiktok_business: new TikTokBusinessOAuthAdapter(),
        lazada: new LazadaOAuthAdapter(),
        shopify: new ShopifyOAuthAdapter(),
        amazon: new AmazonOAuthAdapter(),
    };
    
    return registry;
}

export function getProvider(id: string): OAuthProviderAdapter {
    const reg = getProviderRegistry();
    const provider = reg[id];
    
    if (!provider) {
        throw new OAuthError(
            "configuration_error",
            `OAuth provider "${id}" not registered`,
            id
        );
    }
    
    return provider;
}

export function listProviders(): OAuthProviderAdapter[] {
    return Object.values(getProviderRegistry());
}

export function isProviderEnabled(id: string): boolean {
    // Check if provider exists and has required env vars
    try {
        const provider = getProvider(id);
        return !!provider;
    } catch {
        return false;
    }
}

/** Check if all required environment variables are present for a provider */
export function isProviderConfigured(id: string): boolean {
    const configChecks: Record<string, () => boolean> = {
        shopee: () => !!(process.env.SHOPEE_APP_ID && process.env.SHOPEE_APP_SECRET),
        lazada: () => !!(process.env.LAZADA_APP_KEY && process.env.LAZADA_APP_SECRET),
        meta_ads: () => !!(process.env.META_APP_ID && process.env.META_APP_SECRET),
        google_ads: () => !!(process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET),
        tiktok_shop: () => !!(process.env.TIKTOK_APP_ID && process.env.TIKTOK_APP_SECRET),
        tiktok_business: () => !!(process.env.TIKTOK_BUSINESS_APP_ID && process.env.TIKTOK_BUSINESS_APP_SECRET),
        shopify: () => !!process.env.SHOPIFY_CLIENT_ID,
        amazon: () => !!(process.env.AMAZON_CLIENT_ID && process.env.AMAZON_CLIENT_SECRET),
    };
    
    const check = configChecks[id];
    return check ? check() : false;
}

/** Get all enabled and configured providers */
export function getAvailableProviders(): string[] {
    const all = Object.keys(getProviderRegistry());
    return all.filter(id => isProviderEnabled(id) && isProviderConfigured(id));
}
