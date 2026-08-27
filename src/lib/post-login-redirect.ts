import { safeCallbackUrl } from "@/lib/safe-callback-url";

/**
 * After sign-in, land on the requested app path (default /console).
 * Start (`free`) is a real trial workspace — do not bounce it to /pricing.
 * Entitlements still gate Looker, extra sources, and scheduled refresh in-product.
 */
export function getPostLoginRedirectPath(
  _plan: string | undefined,
  requestedPath: string
): string {
  return safeCallbackUrl(requestedPath, "/console");
}
