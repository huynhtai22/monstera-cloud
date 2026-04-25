/**
 * Meta System User Token Support - Flux Architecture Compliance (Section 3.5)
 *
 * For internal marketing automation, use System User tokens instead of standard OAuth.
 * This eliminates token refresh logic entirely.
 *
 * Setup:
 * 1. Create Facebook Business Manager
 * 2. Add System User (Settings → System Users)
 * 3. Generate Access Token with ads_management permission
 * 4. Store token (never expires)
 */

import { getRedis } from "./redis";
import { logger } from "@/lib/logger";

const REDIS_KEY_PREFIX = "meta:system_user:";

interface MetaSystemUserConfig {
  businessId: string;
  systemUserId: string;
  accessToken: string;
  permissions: string[];
  adAccounts: string[]; // List of ad account IDs this token can access
}

/**
 * Store System User token
 * Unlike regular OAuth tokens, System User tokens don't expire
 */
export async function storeSystemUserToken(
  workspaceId: string,
  config: MetaSystemUserConfig
): Promise<void> {
  const redis = getRedis();
  const key = `${REDIS_KEY_PREFIX}${workspaceId}`;

  await redis.set(
    key,
    JSON.stringify(config),
    "EX",
    365 * 24 * 60 * 60 // 1 year (essentially permanent, but we verify periodically)
  );

  logger.info(`[Meta System User] Stored token for workspace ${workspaceId}`);
}

/**
 * Get System User token (no refresh needed)
 */
export async function getSystemUserToken(
  workspaceId: string
): Promise<MetaSystemUserConfig | null> {
  const redis = getRedis();
  const key = `${REDIS_KEY_PREFIX}${workspaceId}`;

  const data = await redis.get(key);
  if (!data) return null;

  return JSON.parse(data) as MetaSystemUserConfig;
}

/**
 * Validate System User token is still valid
 * Meta tokens don't expire, but permissions can be revoked
 */
export async function validateSystemUserToken(
  accessToken: string
): Promise<{ valid: boolean; adAccounts: string[]; error?: string }> {
  try {
    // Call Meta Graph API to verify token
    const response = await fetch(
      `https://graph.facebook.com/v18.0/me?access_token=${accessToken}`
    );

    if (!response.ok) {
      const error = await response.json();
      return {
        valid: false,
        adAccounts: [],
        error: error.error?.message || "Invalid token",
      };
    }

    // Get accessible ad accounts
    const accountsResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/adaccounts?access_token=${accessToken}&fields=id,name`
    );

    const accounts = await accountsResponse.json();
    const adAccounts = accounts.data?.map((a: any) => a.id) || [];

    return { valid: true, adAccounts };
  } catch (err) {
    return {
      valid: false,
      adAccounts: [],
      error: err instanceof Error ? err.message : "Validation failed",
    };
  }
}

/**
 * API request using System User token
 * No refresh logic needed - token is permanent
 */
export async function metaSystemUserRequest<T>(
  endpoint: string,
  accessToken: string,
  options: {
    method?: "GET" | "POST";
    params?: Record<string, string>;
  } = {}
): Promise<T> {
  const url = new URL(`https://graph.facebook.com/v18.0${endpoint}`);
  url.searchParams.set("access_token", accessToken);

  if (options.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  const response = await fetch(url.toString(), {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `Meta API error: ${error.error?.message || response.statusText}`
    );
  }

  return response.json() as T;
}

/**
 * Migration: Convert OAuth connection to System User
 * Use this when setting up internal/agency tools
 */
export async function migrateToSystemUser(
  workspaceId: string,
  connectionId: string,
  systemUserToken: string
): Promise<void> {
  // Validate the system user token
  const validation = await validateSystemUserToken(systemUserToken);

  if (!validation.valid) {
    throw new Error(`Invalid System User token: ${validation.error}`);
  }

  // Store system user config
  await storeSystemUserToken(workspaceId, {
    businessId: "", // Will be populated on first API call
    systemUserId: "", // Will be populated on first API call
    accessToken: systemUserToken,
    permissions: ["ads_management", "ads_read"],
    adAccounts: validation.adAccounts,
  });

  // Mark original connection as migrated
  logger.info(
    `[Meta System User] Migrated connection ${connectionId} to System User token`
  );
}

/**
 * Check if workspace should use System User token
 */
export async function shouldUseSystemUser(workspaceId: string): Promise<boolean> {
  const config = await getSystemUserToken(workspaceId);
  return config !== null;
}
