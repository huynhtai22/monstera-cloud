/**
 * Shopee Open Platform environment flags.
 * Vercel / host UIs may store booleans as "true", "True", "1", etc.
 */

/**
 * Sandbox API base URL.
 * Shopee validates HMAC here for test apps. The older `partner.test-stable.shopeemobile.com`
 * host often returns `error_sign` / `Wrong sign` for otherwise correct signatures.
 *
 * @see https://stackoverflow.com/questions/79751636/shopee-api-sandbox-error-sign-even-with-correct-test-partner-id-and-partner-key
 */
export const SHOPEE_SANDBOX_OPEN_API_HOST = "https://openplatform.sandbox.test-stable.shopee.sg";

/** True when using Shopee test-stable host and test partner credentials. */
export function isShopeeSandboxEnabled(): boolean {
  const v = (process.env.SHOPEE_SANDBOX ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}
