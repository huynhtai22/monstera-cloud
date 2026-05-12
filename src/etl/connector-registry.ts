/**
 * Declarative Connector SDK — foundational registry.
 *
 * Long-term goal: replace extract.ts switch/case with fully
 * config-driven extraction. Each connector declares its endpoints,
 * pagination, auth type, and canonical schema mapping in a plain
 * object rather than bespoke TypeScript functions.
 *
 * New connectors are registered here; no other files need modification
 * to support basic extraction (endpoint + pagination loop).
 */

import type { EtlProvider } from "@/etl/types";
import { isShopeeSandboxEnabled, SHOPEE_SANDBOX_OPEN_API_HOST } from "@/lib/shopee-env";

export type AuthType = "oauth" | "hmac" | "api_key";
export type PaginationType = "cursor" | "page" | "offset" | "time_range" | "none";

export interface ConnectorEndpoint {
    path: string;
    method: "GET" | "POST";
    /** Query param or body key for the pagination cursor */
    cursorParam?: string;
    /** JSON path to the array of results (e.g. "data.items") */
    resultsPath: string;
    /** JSON path to the next cursor (e.g. "paging.next") */
    nextCursorPath?: string;
    /** Maximum records per request */
    pageSize: number;
    /** Static query params merged into every call */
    defaultParams?: Record<string, string | number>;
}

export interface ConnectorConfig {
    /** Unique provider key */
    provider: EtlProvider;
    /** Human-readable name */
    name: string;
    /** How the platform authenticates */
    authType: AuthType;
    /** Base URL (environment-specific overrides allowed) */
    baseUrl: string;
    /** Pagination strategy */
    pagination: PaginationType;
    /** One or more endpoints to call during extraction */
    endpoints: ConnectorEndpoint[];
    /** Canonical field mapping: source_field -> canonical_field */
    fieldMapping: Record<string, string>;
    /** Fields that must be present for a record to be considered valid */
    requiredFields: string[];
}

/**
 * Central registry of all connector configurations.
 * Adding a new connector = adding one entry here.
 */
const CONNECTOR_REGISTRY: Record<EtlProvider, ConnectorConfig> = {
    meta_ads: {
        provider: "meta_ads",
        name: "Meta Ads (Facebook & Instagram)",
        authType: "oauth",
        baseUrl: "https://graph.facebook.com/v21.0",
        pagination: "cursor",
        endpoints: [
            {
                path: "/{accountId}/insights",
                method: "GET",
                cursorParam: "after",
                resultsPath: "data",
                nextCursorPath: "paging.cursors.after",
                pageSize: 500,
                defaultParams: { level: "campaign", fields: "campaign_id,campaign_name,spend,impressions,clicks,conversions,actions" },
            },
        ],
        fieldMapping: {
            campaign_id: "campaignId",
            campaign_name: "campaignName",
            spend: "spend",
            impressions: "impressions",
            clicks: "clicks",
            conversions: "conversions",
            actions: "conversions",
        },
        requiredFields: ["campaign_id", "spend"],
    },

    google_ads: {
        provider: "google_ads",
        name: "Google Ads",
        authType: "oauth",
        baseUrl: "https://googleads.googleapis.com/v16",
        pagination: "page",
        endpoints: [
            {
                path: "/customers/{customerId}/googleAds:searchStream",
                method: "POST",
                resultsPath: "results",
                pageSize: 10000,
            },
        ],
        fieldMapping: {
            "campaign.id": "campaignId",
            "campaign.name": "campaignName",
            metrics_cost_micros: "spend",
            metrics_impressions: "impressions",
            metrics_clicks: "clicks",
            metrics_conversions: "conversions",
            metrics_conversions_value: "revenue",
        },
        requiredFields: ["campaign.id"],
    },

    tiktok_business: {
        provider: "tiktok_business",
        name: "TikTok for Business",
        authType: "oauth",
        baseUrl: "https://business-api.tiktok.com/open_api/v1.3",
        pagination: "page",
        endpoints: [
            {
                path: "/report/integrated/get/",
                method: "GET",
                cursorParam: "page",
                resultsPath: "data.list",
                nextCursorPath: "data.page_info.page",
                pageSize: 1000,
            },
        ],
        fieldMapping: {
            dimensions_campaign_id: "campaignId",
            dimensions_campaign_name: "campaignName",
            metrics_spend: "spend",
            metrics_impressions: "impressions",
            metrics_clicks: "clicks",
            metrics_conversions: "conversions",
        },
        requiredFields: ["dimensions_campaign_id"],
    },

    shopee: {
        provider: "shopee",
        name: "Shopee",
        authType: "hmac",
        baseUrl: isShopeeSandboxEnabled()
            ? SHOPEE_SANDBOX_OPEN_API_HOST
            : "https://partner.shopeemobile.com",
        pagination: "time_range",
        endpoints: [
            {
                path: "/api/v2/order/get_order_list",
                method: "GET",
                resultsPath: "response.order_list",
                pageSize: 100,
            },
        ],
        fieldMapping: {
            order_sn: "orderId",
            total_amount: "grossRevenue",
            create_time: "orderCreatedAt",
            currency: "currency",
        },
        requiredFields: ["order_sn"],
    },

    shopify: {
        provider: "shopify",
        name: "Shopify",
        authType: "oauth",
        baseUrl: "https://{shopDomain}.myshopify.com/admin/api/2024-01",
        pagination: "cursor",
        endpoints: [
            {
                path: "/orders.json",
                method: "GET",
                cursorParam: "page_info",
                resultsPath: "orders",
                nextCursorPath: "link.next",
                pageSize: 250,
            },
        ],
        fieldMapping: {
            id: "orderId",
            total_price: "grossRevenue",
            created_at: "orderCreatedAt",
            currency: "currency",
        },
        requiredFields: ["id"],
    },

    amazon: {
        provider: "amazon",
        name: "Amazon SP-API",
        authType: "oauth",
        baseUrl: "https://sellingpartnerapi-na.amazon.com",
        pagination: "cursor",
        endpoints: [
            {
                path: "/orders/v0/orders",
                method: "GET",
                cursorParam: "NextToken",
                resultsPath: "Orders",
                nextCursorPath: "NextToken",
                pageSize: 100,
            },
        ],
        fieldMapping: {
            AmazonOrderId: "orderId",
            OrderTotal_Amount: "grossRevenue",
            PurchaseDate: "orderCreatedAt",
            OrderTotal_CurrencyCode: "currency",
        },
        requiredFields: ["AmazonOrderId"],
    },

    lazada: {
        provider: "lazada",
        name: "Lazada",
        authType: "hmac",
        baseUrl: "https://api.lazada.com/rest",
        pagination: "offset",
        endpoints: [
            {
                path: "/orders/get",
                method: "GET",
                cursorParam: "offset",
                resultsPath: "data.orders",
                pageSize: 100,
            },
        ],
        fieldMapping: {
            order_id: "orderId",
            price: "grossRevenue",
            created_at: "orderCreatedAt",
        },
        requiredFields: ["order_id"],
    },
};

export function getConnectorConfig(provider: EtlProvider): ConnectorConfig | undefined {
    return CONNECTOR_REGISTRY[provider];
}

export function listConnectors(): ConnectorConfig[] {
    return Object.values(CONNECTOR_REGISTRY);
}

export function isConnectorSupported(provider: string): provider is EtlProvider {
    return provider in CONNECTOR_REGISTRY;
}

/**
 * Future: extract.ts will migrate to use this registry.
 * The registry already provides enough metadata to generate
 * a generic pagination loop + field mapper for simple GET APIs.
 */
