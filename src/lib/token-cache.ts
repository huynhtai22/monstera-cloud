/**
 * Token Cache - Flux Architecture Compliance (Section 3.1)
 * 
 * Requirements:
 * - Store access tokens in Redis with TTL = token TTL - 5 minutes
 * - Fallback to database on cache miss
 * - Never fetch tokens on a per-request basis
 */

import { getRedis } from "./redis";
import prisma from "./prisma";
import { safeDecrypt } from "./encryption";
import { logger } from "@/lib/logger";

const REDIS_KEY_PREFIX = "token:";
const SAFETY_BUFFER_SECONDS = 300; // 5 minutes

interface CachedToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix timestamp in seconds
  shopId?: number | string;
  extraFields?: Record<string, any>;
}

/**
 * Build Redis key for a connection's token
 */
function buildTokenKey(connectionId: string): string {
  return `${REDIS_KEY_PREFIX}${connectionId}`;
}

/**
 * Calculate Redis TTL with 5-minute safety buffer
 * 
 * Flux requirement: "TTL must expire 5 minutes before actual API token expires"
 */
function calculateCacheTTL(expiresAt: number): number {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tokenTTL = expiresAt - nowSeconds;
  const cacheTTL = tokenTTL - SAFETY_BUFFER_SECONDS;

  // Minimum 60 seconds cache TTL, maximum 1 hour
  return Math.max(60, Math.min(cacheTTL, 3600));
}

/**
 * Get token from cache or database (Flux: never per-request DB hits)
 */
export async function getToken(connectionId: string): Promise<CachedToken | null> {
  const redis = getRedis();
  const key = buildTokenKey(connectionId);

  // 1. Try Redis first (fast path)
  try {
    const cached = await redis.get(key);
    if (cached) {
      const token: CachedToken = JSON.parse(cached);
      // Verify token is still valid
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (token.expiresAt > nowSeconds + 60) {
        logger.info(`[TokenCache] Hit for ${connectionId}`);
        return token;
      }
      // Token expired in cache, delete it
      await redis.del(key);
    }
  } catch (err) {
    logger.error("[TokenCache] Redis error:", err);
  }

  // 2. Cache miss - fetch from database (slow path)
  logger.info(`[TokenCache] Miss for ${connectionId}, fetching from DB`);

  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: { credentials: true, provider: true },
  });

  if (!connection?.credentials) return null;

  try {
    const decrypted = JSON.parse(safeDecrypt(connection.credentials));

    const token: CachedToken = {
      accessToken: decrypted.accessToken,
      refreshToken: decrypted.refreshToken,
      expiresAt: Math.floor(new Date(decrypted.expiresAt).getTime() / 1000),
      shopId: decrypted.shopId,
      extraFields: decrypted.extraFields || {},
    };

    // 3. Populate cache for next request
    await setToken(connectionId, token);

    return token;
  } catch (err) {
    logger.error("[TokenCache] Failed to parse credentials:", err);
    return null;
  }
}

/**
 * Store token in Redis with safety buffer TTL
 */
export async function setToken(connectionId: string, token: CachedToken): Promise<void> {
  const redis = getRedis();
  const key = buildTokenKey(connectionId);

  const cacheTTL = calculateCacheTTL(token.expiresAt);

  try {
    await redis.set(key, JSON.stringify(token), "EX", cacheTTL);
    logger.info(`[TokenCache] Stored for ${connectionId}, TTL: ${cacheTTL}s`);
  } catch (err) {
    logger.error("[TokenCache] Failed to store token:", err);
  }
}

/**
 * Invalidate token cache (after refresh or disconnect)
 */
export async function invalidateToken(connectionId: string): Promise<void> {
  const redis = getRedis();
  const key = buildTokenKey(connectionId);

  try {
    await redis.del(key);
    logger.info(`[TokenCache] Invalidated for ${connectionId}`);
  } catch (err) {
    logger.error("[TokenCache] Failed to invalidate:", err);
  }
}

/**
 * Bulk invalidate cache by pattern (e.g., all tokens for a specific shop)
 * Useful for sweeping cleanup when user scopes change
 */
export async function invalidateByPattern(pattern: string): Promise<number> {
  const redis = getRedis();
  let cursor = 0;
  let count = 0;
  
  try {
    do {
      // NOTE: Vercel KV / Upstash supports SCAN
      const result = await redis.scan(cursor, { match: pattern, count: 100 });
      // Depending on the client version, result is either [cursor, keys] or an object
      cursor = Array.isArray(result) ? parseInt(result[0], 10) : parseInt((result as any).cursor, 10);
      const keys: string[] = Array.isArray(result) ? result[1] : (result as any).keys || [];
      
      if (keys.length > 0) {
        await redis.del(...keys);
        count += keys.length;
      }
    } while (cursor !== 0);
    
    if (count > 0) {
      logger.info(`[TokenCache] Bulk invalidated ${count} keys matching pattern: ${pattern}`);
    }
    return count;
  } catch (err) {
    logger.error(`[TokenCache] Failed to bulk invalidate pattern ${pattern}:`, err);
    return 0;
  }
}

/**
 * Check if token needs refresh (within safety buffer)
 */
export async function shouldRefreshToken(
  connectionId: string,
  token: CachedToken
): Promise<boolean> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const timeUntilExpiry = token.expiresAt - nowSeconds;

  // Refresh if less than 10 minutes until expiry (double the safety buffer)
  return timeUntilExpiry < 600;
}

/**
 * Get token with auto-refresh logic
 * Flux: Application only hits DB for refresh token when cache miss
 */
export async function getValidToken(
  connectionId: string,
  refreshFn: (refreshToken: string) => Promise<CachedToken>
): Promise<CachedToken | null> {
  const token = await getToken(connectionId);

  if (!token) return null;

  // Check if token is about to expire
  const needsRefresh = await shouldRefreshToken(connectionId, token);

  if (needsRefresh && token.refreshToken) {
    logger.info(`[TokenCache] Token expiring soon for ${connectionId}, refreshing...`);

    // Distributed mutex will be handled by the refresh function
    const newToken = await refreshFn(token.refreshToken);

    if (newToken) {
      // Update cache with new token
      await setToken(connectionId, newToken);
      return newToken;
    }
  }

  return token;
}

/**
 * Batch get tokens for multiple connections (efficient for sync jobs)
 */
export async function getTokensBatch(connectionIds: string[]): Promise<
  Map<string, CachedToken>
> {
  const redis = getRedis();
  const keys = connectionIds.map(buildTokenKey);
  const result = new Map<string, CachedToken>();

  // Try to get all from Redis in one pipeline
  try {
    const cached = await redis.mget(...keys);

    const missingIds: string[] = [];

    cached.forEach((value, index) => {
      const connectionId = connectionIds[index];
      if (value) {
        const token: CachedToken = JSON.parse(value);
        // Verify still valid
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (token.expiresAt > nowSeconds + 60) {
          result.set(connectionId, token);
        } else {
          missingIds.push(connectionId);
        }
      } else {
        missingIds.push(connectionId);
      }
    });

    // Fetch missing from DB
    if (missingIds.length > 0) {
      const dbTokens = await Promise.all(
        missingIds.map((id) => getToken(id))
      );

      dbTokens.forEach((token, index) => {
        if (token) {
          result.set(missingIds[index], token);
        }
      });
    }
  } catch (err) {
    logger.error("[TokenCache] Batch fetch error:", err);
    // Fallback to individual DB fetches
    for (const id of connectionIds) {
      const token = await getToken(id);
      if (token) result.set(id, token);
    }
  }

  return result;
}
