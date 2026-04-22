/**
 * API Interceptor Layer - Flux Architecture Compliance (Section 3.3)
 *
 * Requirements:
 * - Centralized HTTP client interceptor
 * - Auto-inject timestamp, HMAC signature for Shopee/Lazada
 * - Business logic never handles signing
 * - Inject Google Ads developer token
 */

import crypto from "crypto";
import { getToken, invalidateToken } from "./token-cache";
import { withMutex } from "./distributed-mutex";

// Platform configurations
const PLATFORM_CONFIG: Record<
  string,
  {
    baseUrl: string;
    authType: "oauth" | "hmac" | "developer_token";
    signatureFn?: (params: SignatureParams) => Record<string, string>;
    headersFn?: (token: string) => Record<string, string>;
  }
> = {
  shopee: {
    baseUrl: process.env.SHOPEE_SANDBOX === "true"
      ? "https://partner.test-stable.shopeemobile.com"
      : "https://partner.shopeemobile.com",
    authType: "hmac",
    signatureFn: shopeeSignature,
  },
  lazada: {
    baseUrl: "https://api.lazada.com/rest",
    authType: "hmac",
    signatureFn: lazadaSignature,
  },
  google_ads: {
    baseUrl: "https://googleads.googleapis.com/v14",
    authType: "developer_token",
    headersFn: (token) => ({
      Authorization: `Bearer ${token}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
    }),
  },
  meta_ads: {
    baseUrl: "https://graph.facebook.com/v18.0",
    authType: "oauth",
    headersFn: (token) => ({
      Authorization: `Bearer ${token}`,
    }),
  },
};

interface SignatureParams {
  partnerId?: string;
  partnerKey?: string;
  accessToken?: string;
  shopId?: string;
  path: string;
  timestamp: number;
}

/**
 * Shopee HMAC-SHA256 signature
 */
function shopeeSignature(params: SignatureParams): Record<string, string> {
  const { partnerId, partnerKey, accessToken, shopId, path, timestamp } = params;

  if (!partnerId || !partnerKey) {
    throw new Error("Missing Shopee partner credentials");
  }

  // Auth APIs: sign(partner_id + path + timestamp)
  // Shop APIs: sign(partner_id + path + timestamp + access_token + shop_id)
  let baseString: string;
  if (accessToken && shopId) {
    baseString = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  } else {
    baseString = `${partnerId}${path}${timestamp}`;
  }

  const sign = crypto.createHmac("sha256", partnerKey).update(baseString).digest("hex");

  return {
    partner_id: partnerId,
    timestamp: String(timestamp),
    sign,
    access_token: accessToken || "",
    shop_id: shopId || "",
  };
}

/**
 * Lazada signature
 */
function lazadaSignature(params: SignatureParams): Record<string, string> {
  const { partnerId, partnerKey, path, timestamp } = params;

  if (!partnerId || !partnerKey) {
    throw new Error("Missing Lazada partner credentials");
  }

  // Lazada: sign(path + params + timestamp + app_secret)
  const baseString = `${path}${timestamp}${partnerKey}`;
  const sign = crypto.createHmac("sha256", partnerKey).update(baseString).digest("hex");

  return {
    app_key: partnerId,
    timestamp: String(timestamp),
    sign,
  };
}

/**
 * Intercepted API Request
 *
 * Flux: "Business logic should never be responsible for signing requests"
 */
export async function apiRequest<T>(
  platform: string,
  endpoint: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: any;
    connectionId?: string;
    skipCache?: boolean;
  } = {}
): Promise<T> {
  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  // Get fresh token from cache
  let token: string | undefined;
  if (options.connectionId) {
    const cached = await getToken(options.connectionId);
    if (cached) {
      token = cached.accessToken;
    }
  }

  if (!token && config.authType !== "hmac") {
    throw new Error(`No valid token for ${platform}`);
  }

  // Build request URL
  let url: string;
  let headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  switch (config.authType) {
    case "oauth":
    case "developer_token": {
      if (config.headersFn) {
        headers = { ...headers, ...config.headersFn(token!) };
      }
      url = `${config.baseUrl}${endpoint}`;
      break;
    }

    case "hmac": {
      const timestamp = Math.floor(Date.now() / 1000);
      const partnerId = process.env[`${platform.toUpperCase()}_PARTNER_ID`];
      const partnerKey = process.env[`${platform.toUpperCase()}_PARTNER_KEY`];

      if (!partnerId || !partnerKey) {
        throw new Error(`Missing ${platform} credentials`);
      }

      const sigParams: SignatureParams = {
        partnerId,
        partnerKey,
        accessToken: token,
        shopId: undefined, // Extract from connection metadata if needed
        path: endpoint,
        timestamp,
      };

      if (config.signatureFn) {
        const signedParams = config.signatureFn(sigParams);
        const queryString = new URLSearchParams(signedParams).toString();
        url = `${config.baseUrl}${endpoint}?${queryString}`;
      } else {
        url = `${config.baseUrl}${endpoint}`;
      }
      break;
    }
  }

  // Make request
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  // Handle errors
  if (!response.ok) {
    const error = await response.text();

    // Check for token expiration
    if (response.status === 401 && options.connectionId) {
      await invalidateToken(options.connectionId);
      throw new Error(`Token expired for ${platform}: ${error}`);
    }

    throw new Error(`${platform} API error (${response.status}): ${error}`);
  }

  return response.json() as T;
}

/**
 * Protected token refresh with mutex
 */
export async function refreshTokenWithMutex(
  platform: string,
  connectionId: string,
  refreshFn: () => Promise<{ accessToken: string; expiresAt: Date }>
): Promise<{ accessToken: string; expiresAt: Date }> {
  // Flux: "Before initiating a Refresh Token flow, acquire a distributed lock"
  const lockKey = `refresh:${platform}:${connectionId}`;

  return withMutex(
    lockKey,
    async () => {
      console.log(`[API Interceptor] Refreshing ${platform} token for ${connectionId}`);
      const result = await refreshFn();

      // Update cache after successful refresh
      const { setToken } = await import("./token-cache");
      await setToken(connectionId, {
        accessToken: result.accessToken,
        expiresAt: Math.floor(result.expiresAt.getTime() / 1000),
      });

      return result;
    },
    { ttlSeconds: 30 } // Lock for 30 seconds during refresh
  );
}

/**
 * Rate limiting helper
 */
export async function checkRateLimit(
  platform: string,
  shopId: string,
  limit: number = 100,
  windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number }> {
  const { getRedis } = await import("./redis");
  const redis = getRedis();

  const key = `ratelimit:${platform}:${shopId}`;
  const current = await redis.incr(key);

  if (current === 1) {
    // First request, set expiry
    await redis.expire(key, windowSeconds);
  }

  const remaining = limit - current;

  return {
    allowed: current <= limit,
    remaining: Math.max(0, remaining),
  };
}
