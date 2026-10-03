import { OAuthError } from "@/lib/oauth-framework/types";

/**
 * Facebook Login for Business configuration identifiers are numeric.
 * Deliberately strict: a malformed value must fail closed rather than send an
 * unusable `config_id`, which Meta rejects before it reaches our callback.
 */
export const META_LOGIN_CONFIG_ID_PATTERN = /^[0-9]+$/;

/**
 * Read the configured Meta App ID (primary: META_ADS_APP_ID, alias: META_APP_ID).
 */
export function getMetaAppId(): string {
  return (process.env.META_ADS_APP_ID || process.env.META_APP_ID || "").trim();
}

/**
 * Read the configured Meta App Secret (primary: META_ADS_APP_SECRET, alias: META_APP_SECRET).
 */
export function getMetaAppSecret(): string {
  return (process.env.META_ADS_APP_SECRET || process.env.META_APP_SECRET || "").trim();
}

/**
 * Returns true if the Configuration ID is present, non-empty, and strictly numeric.
 * Surrounding whitespace is trimmed.
 */
export function isValidMetaLoginConfigId(raw?: string | null): boolean {
  const value = (raw ?? process.env.META_ADS_LOGIN_CONFIG_ID ?? "").trim();
  if (!value) return false;
  return META_LOGIN_CONFIG_ID_PATTERN.test(value);
}

/**
 * Read and validate the reviewed Facebook Login for Business configuration ID.
 *
 * Evaluated lazily at authorization time — never at module load — so builds,
 * CI and unrelated routes are unaffected when the variable is absent. The
 * returned value is never logged, and errors never echo it.
 */
export function requireMetaLoginConfigId(): string {
  const configured = (process.env.META_ADS_LOGIN_CONFIG_ID || "").trim();

  if (!configured) {
    throw new OAuthError(
      "configuration_error",
      "META_ADS_LOGIN_CONFIG_ID is not configured; Meta authorization is unavailable",
      "meta_ads",
    );
  }

  if (!META_LOGIN_CONFIG_ID_PATTERN.test(configured)) {
    throw new OAuthError(
      "configuration_error",
      "META_ADS_LOGIN_CONFIG_ID is malformed; expected the numeric Meta configuration identifier",
      "meta_ads",
    );
  }

  return configured;
}

/**
 * Checks if Meta Ads is fully configured for Facebook Login for Business:
 * 1. App ID is non-empty
 * 2. App Secret is non-empty
 * 3. Configuration ID is non-empty and strictly numeric
 */
export function isMetaAdsConfigured(): boolean {
  if (!getMetaAppId() || !getMetaAppSecret()) {
    return false;
  }
  return isValidMetaLoginConfigId();
}
