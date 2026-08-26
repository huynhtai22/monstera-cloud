/**
 * Shopee Open Platform environment configuration.
 * Supports explicit separation between Sandbox and Production environments.
 */

export interface ShopeeEnvironment {
  apiBaseUrl: string;
  partnerId?: string;
  partnerKey?: string;
  redirectUrl: string;
}

export const SHOPEE_CANONICAL_REDIRECT_URL =
  "https://monsteracloud.com/api/auth/callback?provider=shopee";

export const SHOPEE_SANDBOX_OPEN_API_HOST =
  "https://openplatform.sandbox.test-stable.shopee.sg";

export const SHOPEE_PRODUCTION_OPEN_API_HOST =
  "https://partner.shopeemobile.com";

/** True when using Shopee sandbox host and test partner credentials. */
export function isShopeeSandboxEnabled(): boolean {
  const v = (process.env.SHOPEE_SANDBOX ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/** Trim, strip BOM, and remove wrapping quotes */
export function normalizePartnerEnvValue(raw?: string | null): string {
  if (!raw) return "";
  let v = raw.trim().replace(/^\uFEFF/, "");
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

export function getShopeeEnvironments(): {
  sandbox: ShopeeEnvironment;
  production: ShopeeEnvironment;
} {
  return {
    sandbox: {
      apiBaseUrl: SHOPEE_SANDBOX_OPEN_API_HOST,
      partnerId:
        normalizePartnerEnvValue(process.env.SHOPEE_TEST_PARTNER_ID) ||
        normalizePartnerEnvValue(process.env.SHOPEE_PARTNER_ID) ||
        undefined,
      partnerKey:
        normalizePartnerEnvValue(process.env.SHOPEE_TEST_PARTNER_KEY) ||
        normalizePartnerEnvValue(process.env.SHOPEE_PARTNER_KEY) ||
        undefined,
      redirectUrl:
        process.env.SHOPEE_REDIRECT_URL || SHOPEE_CANONICAL_REDIRECT_URL,
    },
    production: {
      apiBaseUrl: SHOPEE_PRODUCTION_OPEN_API_HOST,
      partnerId:
        normalizePartnerEnvValue(process.env.SHOPEE_LIVE_PARTNER_ID) ||
        normalizePartnerEnvValue(process.env.SHOPEE_PARTNER_ID) ||
        undefined,
      partnerKey:
        normalizePartnerEnvValue(process.env.SHOPEE_LIVE_PARTNER_KEY) ||
        normalizePartnerEnvValue(process.env.SHOPEE_PARTNER_KEY) ||
        undefined,
      redirectUrl:
        process.env.SHOPEE_REDIRECT_URL || SHOPEE_CANONICAL_REDIRECT_URL,
    },
  };
}

export function getShopeeActiveConfig(sandbox?: boolean): {
  apiBaseUrl: string;
  partnerId: string;
  partnerKey: string;
  redirectUrl: string;
  isSandbox: boolean;
} {
  const isSb = sandbox !== undefined ? sandbox : isShopeeSandboxEnabled();
  const envs = getShopeeEnvironments();
  const env = isSb ? envs.sandbox : envs.production;

  const partnerId = env.partnerId || "";
  const partnerKey = env.partnerKey || "";

  if (!partnerId) {
    throw new Error(
      isSb
        ? "Shopee Sandbox partner ID is not configured. Set SHOPEE_TEST_PARTNER_ID (or SHOPEE_PARTNER_ID with SHOPEE_SANDBOX=true)."
        : "Shopee Production partner ID is not configured. Set SHOPEE_LIVE_PARTNER_ID (or SHOPEE_PARTNER_ID)."
    );
  }
  if (!partnerKey) {
    throw new Error(
      isSb
        ? "Shopee Sandbox partner key is not configured. Set SHOPEE_TEST_PARTNER_KEY (or SHOPEE_PARTNER_KEY with SHOPEE_SANDBOX=true)."
        : "Shopee Production partner key is not configured. Set SHOPEE_LIVE_PARTNER_KEY (or SHOPEE_PARTNER_KEY)."
    );
  }

  return {
    apiBaseUrl: env.apiBaseUrl,
    partnerId,
    partnerKey,
    redirectUrl: env.redirectUrl,
    isSandbox: isSb,
  };
}
