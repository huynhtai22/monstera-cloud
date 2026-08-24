/**
 * Page access policy for the edge proxy (src/proxy.ts).
 *
 * Model: DENY-BY-DEFAULT.
 *
 * Every page request is either explicitly classified `public` or it falls
 * through to the `authenticated` default and requires a NextAuth session JWT.
 * This inverts the previous fragile model (a hand-maintained list of
 * authenticated path segments): a newly added application page is protected
 * automatically unless someone consciously allowlists it here.
 *
 * Route groups like `(app)` are build-time folders, NOT URL segments, so this
 * policy never references them. Classification is purely URL-based.
 *
 * Public classification covers exactly:
 * - `/` marketing home
 * - marketing: /about /changelog /docs /pricing /platform /showcase /support
 *   /templates /looker-studio /id /integrations(/…) /solutions(/…)
 * - legal: /legal/privacy-policy /legal/refund-policy /legal/terms-of-service
 * - auth flows: /login /register /forgot-password /reset-password /verify
 * - invitation acceptance: /invite/[token] (the invite itself gates access)
 * - utility pages: /auth/continue /success /pixel-test /demo/ui
 */

export type PageAccessClass = "public" | "authenticated";

/** Exact-match public paths. */
export const PUBLIC_PAGE_PATHS: ReadonlySet<string> = new Set([
  "/",
  // Auth flows
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify",
  // Legal
  "/legal/privacy-policy",
  "/legal/refund-policy",
  "/legal/terms-of-service",
  // Utility / transactional pages
  "/success",
  "/pixel-test",
]);

/** First-segment prefixes that are public including all nested sub-paths. */
export const PUBLIC_PAGE_PREFIXES: readonly string[] = [
  // Marketing site (including /integrations/[slug], /solutions/*, etc.)
  "/about",
  "/changelog",
  "/docs",
  "/pricing",
  "/platform",
  "/showcase",
  "/support",
  "/templates",
  "/looker-studio",
  "/id",
  "/integrations",
  "/solutions",
  // OAuth post-auth continuation page
  "/auth/continue",
  // Demo surface (mock data only, no warehouse access)
  "/demo/ui",
  // Invitation acceptance — token-gated by the page itself; invitees often
  // have no session yet, so this must stay reachable.
  "/invite/",
];

function isPublicPagePath(pathname: string): boolean {
  if (PUBLIC_PAGE_PATHS.has(pathname)) return true;
  return PUBLIC_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

/**
 * Classify a canonical page URL path (agency rewrites already stripped).
 *
 * API routes (`/api/…`) are out of scope here; they are handled by
 * src/lib/request-rate-limit-policy.ts and their own handlers/auth.
 */
export function classifyPageAccess(pathname: string): PageAccessClass {
  if (!pathname.startsWith("/")) return "authenticated";
  if (pathname.startsWith("/api/") || pathname === "/api") {
    return "authenticated";
  }
  return isPublicPagePath(pathname) ? "public" : "authenticated";
}
