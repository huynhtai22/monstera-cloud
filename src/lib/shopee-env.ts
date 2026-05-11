/**
 * Shopee Open Platform environment flags.
 * Vercel / host UIs may store booleans as "true", "True", "1", etc.
 */

/** True when using Shopee test-stable host and test partner credentials. */
export function isShopeeSandboxEnabled(): boolean {
  const v = (process.env.SHOPEE_SANDBOX ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}
