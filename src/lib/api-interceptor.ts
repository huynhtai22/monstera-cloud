/**
 * Centralized API Interceptor Layer - Flux Architecture Compliance (Section 3.3)
 *
 * Requirements:
 * - All outgoing requests pass through centralized interceptor
 * - Auto-inject timestamp and calculate signatures
 * - Business logic never handles signing
 * - Support for Shopee HMAC, Lazada signing, Google dev token, etc.
 */

import crypto from "crypto";
import { getToken } from "./token-cache";
import { withTokenRefreshLock } from "./distributed-lock";
import { logger } from "@/lib/logger";
import { getShopeeActiveConfig, isShopeeSandboxEnabled } from "@/lib/shopee-env";

// Platform-specific signing configurations
interface PlatformConfig {
  name: string;
  baseUrl: string;
  authType: "oauth" | "hmac" | "api_key" | "custom";
  signatureMethod?: "hmac-sha256" | "rsa";
  requireTimestamp?: boolean;
  devToken?: string; // For Google Ads
}

// Request context for interceptors
interface RequestContext {
  platform: string;
  connectionId: string;
  endpoint: string;
  method: string;
  headers?: Record<string, string>;
  body?: any;
}

// Response from interceptor
interface InterceptedRequest {
  url: string;
  headers: Record<string, string>;
  body?: any;
}

/**
 * Platform configurations
 */
const PLATFORM_CONFIGS: Record<string, PlatformConfig> = {
  shopee: {
    name: "Shopee",
    // The actual host and signing credentials are selected per connection in
    // signHmacRequest. Do not capture an environment at module-load time.
    baseUrl: "",
    authType: "hmac",
    signatureMethod: "hmac-sha256",
    requireTimestamp: true,
  },
  google_ads: {
    name: "Google Ads",
    baseUrl: "https://googleads.googleapis.com",
    authType: "oauth",
    devToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  },
  meta_ads: {
    name: "Meta Ads",
    baseUrl: "https://graph.facebook.com",
    authType: "oauth",
  },
  tiktok_business: {
    name: "TikTok Business",
    baseUrl: "https://business-api.tiktok.com",
    authType: "oauth",
  },
  lazada: {
    name: "Lazada",
    baseUrl: "https://api.lazada.com/rest",
    authType: "hmac",
    signatureMethod: "hmac-sha256",
    requireTimestamp: true,
  },
  amazon: {
    name: "Amazon SP-API",
    baseUrl: "https://sellingpartnerapi-na.amazon.com",
    authType: "oauth",
  },
};

/**
 * Main interceptor - transforms any request with proper auth
 */
export async function interceptRequest(
  context: RequestContext
): Promise<InterceptedRequest> {
  const config = PLATFORM_CONFIGS[context.platform];

  if (!config) {
    throw new Error(`Unknown platform: ${context.platform}`);
  }

  // Get cached token
  const token = await getToken(context.connectionId);
  if (!token) {
    throw new Error(`No token available for connection ${context.connectionId}`);
  }

  // Platform-specific transformations
  switch (config.authType) {
    case "hmac":
      return await signHmacRequest(context, config, token);
    case "oauth":
      return await signOAuthRequest(context, config, token);
    case "api_key":
      return await signApiKeyRequest();
    default:
      throw new Error(`Unsupported auth type: ${config.authType}`);
  }
}

/**
 * HMAC-SHA256 signing (Shopee, Lazada)
 */
async function signHmacRequest(
  context: RequestContext,
  config: PlatformConfig,
  token: any
): Promise<InterceptedRequest> {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = context.endpoint;
  const storedSandbox = token.extraFields?.sandbox ?? token.sandbox;
  const shopeeConfig = context.platform === "shopee"
    ? getShopeeActiveConfig(
        typeof storedSandbox === "boolean" ? storedSandbox : isShopeeSandboxEnabled(),
      )
    : null;
  const partnerId = shopeeConfig?.partnerId ?? token.extraFields?.partnerId;
  const partnerKey = shopeeConfig?.partnerKey ?? getPartnerKey(context.platform);
  const baseUrl = shopeeConfig?.apiBaseUrl ?? config.baseUrl;

  if (!partnerId || !partnerKey || !baseUrl) {
    throw new Error(`Missing configured credentials for ${context.platform}`);
  }

  // Build signature base string
  // Shopee: partner_id + path + timestamp + access_token + shop_id
  // Lazada: similar pattern
  const baseString = `${partnerId}${path}${timestamp}${token.accessToken}${token.shopId}`;

  const signature = crypto
    .createHmac("sha256", partnerKey)
    .update(baseString)
    .digest("hex");

  const url = new URL(`${baseUrl}${path}`);

  // Add query params
  url.searchParams.set("partner_id", String(partnerId));
  url.searchParams.set("timestamp", timestamp.toString());
  url.searchParams.set("access_token", token.accessToken);
  url.searchParams.set("shop_id", String(token.shopId));
  url.searchParams.set("sign", signature);

  return {
    url: url.toString(),
    headers: {
      "Content-Type": "application/json",
      ...context.headers,
    },
    body: context.body,
  };
}

/**
 * OAuth Bearer token signing (Google Ads, Meta, TikTok)
 */
async function signOAuthRequest(
  context: RequestContext,
  config: PlatformConfig,
  token: any
): Promise<InterceptedRequest> {
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token.accessToken}`,
    "Content-Type": "application/json",
    ...context.headers,
  };

  // Google Ads requires Developer Token in header
  if (config.name === "Google Ads" && config.devToken) {
    headers["developer-token"] = config.devToken;
  }

  // Amazon SP-API requires specific headers
  if (config.name === "Amazon SP-API") {
    headers["x-amz-access-token"] = token.accessToken;
  }

  const url = `${config.baseUrl}${context.endpoint}`;

  return {
    url,
    headers,
    body: context.body,
  };
}

/**
 * API Key signing (simple platforms)
 */
async function signApiKeyRequest(): Promise<InterceptedRequest> {
  // Implementation for API key platforms
  throw new Error("API Key auth not yet implemented");
}

/**
 * Execute API request with full lifecycle:
 * 1. Get token from cache
 * 2. Sign request
 * 3. Execute
 * 4. Handle 401 by refreshing token
 * 5. Retry with new token
 */
export async function executeApiRequest<T>(
  context: RequestContext,
  fetchFn: (req: InterceptedRequest) => Promise<Response>
): Promise<T> {
  // Get intercepted/signed request
  const request = await interceptRequest(context);

  // Execute
  let response = await fetchFn(request);

  // Handle token expiration (401)
  if (response.status === 401) {
    logger.info(`[API] Token expired for ${context.connectionId}, refreshing...`);

    // Use distributed mutex to prevent race conditions
    const refreshed = await withTokenRefreshLock(
      context.connectionId,
      async () => {
        // Refresh token logic here
        // This would call the provider's refreshCredentials
        return await refreshAndCacheToken(context);
      }
    );

    if (!refreshed) {
      throw new Error("Failed to refresh token");
    }

    // Retry with new token
    const newRequest = await interceptRequest(context);
    response = await fetchFn(newRequest);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error ${response.status}: ${errorText}`);
  }

  return await response.json() as T;
}

/**
 * Refresh token and update cache
 */
async function refreshAndCacheToken(context: RequestContext): Promise<boolean> {
  // This would integrate with your existing refresh logic
  // For now, return false (needs implementation based on your providers)
  logger.info(`[API] Token refresh needed for ${context.connectionId}`);
  return false;
}

/**
 * Get partner key for HMAC platforms
 */
function getPartnerKey(platform: string): string {
  switch (platform) {
    case "lazada":
      return process.env.LAZADA_APP_KEY || "";
    default:
      throw new Error(`No partner key for platform: ${platform}`);
  }
}

/**
 * Rate limiting helper
 * Tracks API calls per connection to respect platform limits
 */
export async function checkRateLimit(
  _connectionId: string,
  _platform: string,
  limit: number
): Promise<{ allowed: boolean; remaining: number }> {
  // Implementation would use Redis to track call counts
  // For now, always allow (implement with Redis)
  return { allowed: true, remaining: limit };
}
