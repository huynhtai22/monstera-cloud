/**
 * Agency / multi-tenant hostname resolution for middleware rewrites.
 *
 * - Primary marketing hosts (`monsteracloud.com`, `www.…`) do not get agency routing.
 * - Subdomains of `AGENCY_PRIMARY_DOMAIN_SUFFIX` (default `monsteracloud.com`) map to a workspace slug:
 *   `agency.example.com` → slug `agency`; `data.samsung.example.com` → slug `samsung` (rightmost label before the suffix).
 * - Custom domains: set `AGENCY_HOST_MAP` to JSON `{"reports.client.com":"workspace-slug"}`.
 * - `AGENCY_ROOT_HOSTS`: comma-separated extra apex hosts treated like marketing (no rewrite).
 * - Preview: `*.vercel.app` is ignored unless `AGENCY_ENABLE_VERCEL_PREVIEW=1`.
 */

const DEFAULT_MARKETING_HOSTS = ["monsteracloud.com", "www.monsteracloud.com"];

/** First URL segment must match one of these to rewrite under `/agencies/[slug]/…`. */
export const AGENCY_APP_PREFIXES = new Set([
  "console",
  "sources",
  "settings",
  "reports",
  "explorer",
  "synced-data",
  "clients",
  "destinations",
  "transformations",
  "internal-templates",
  "overview",
  "quickstart",
  "ops",
  "meta-ads",
  "shopee",
  "google-ads",
  "tiktok-ads",
]);

function parseAgencyHostMap(): Record<string, string> {
  const raw = process.env.AGENCY_HOST_MAP?.trim();
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k.trim().toLowerCase()] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function marketingHosts(): Set<string> {
  const extra =
    process.env.AGENCY_ROOT_HOSTS?.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean) ?? [];
  return new Set([...DEFAULT_MARKETING_HOSTS.map((h) => h.toLowerCase()), ...extra]);
}

export function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null;
  return host.split(":")[0]!.toLowerCase();
}

export function isPrimaryMarketingHost(host: string): boolean {
  const h = normalizeHost(host);
  if (!h) return false;
  return marketingHosts().has(h);
}

/**
 * Returns workspace slug for agency routing, or null if this host should use normal routes.
 */
export function resolveAgencySlugFromHost(host: string): string | null {
  const h = normalizeHost(host);
  if (!h) return null;

  const mapped = parseAgencyHostMap()[h];
  if (mapped) return mapped;

  if (isPrimaryMarketingHost(h)) return null;

  if (h === "localhost" || h.endsWith(".localhost")) {
    const devSlug = process.env.AGENCY_DEV_SLUG?.trim();
    return devSlug || null;
  }

  if (h.endsWith(".vercel.app") && process.env.AGENCY_ENABLE_VERCEL_PREVIEW !== "1") {
    return null;
  }

  const suffix = (process.env.AGENCY_PRIMARY_DOMAIN_SUFFIX || "monsteracloud.com")
    .trim()
    .toLowerCase();
  if (!h.endsWith(suffix)) return null;

  const prefix = h.slice(0, -(suffix.length + 1));
  if (!prefix) return null;

  const parts = prefix.split(".").filter(Boolean);
  if (parts.length === 0) return null;
  return parts[parts.length - 1]!;
}

const SKIP_FIRST_SEGMENT = new Set([
  "login",
  "register",
  "verify",
  "forgot-password",
  "reset-password",
  "auth",
  "legal",
  "pricing",
  "docs",
  "platform",
  "integrations",
  "templates",
  "support",
  "looker-studio",
  "id",
  "solutions",
  "pixel-test",
]);

export function pathnameNeedsAgencyRewrite(pathname: string): boolean {
  if (pathname.startsWith("/agencies/")) return false;
  if (pathname.startsWith("/api") || pathname.startsWith("/_next")) return false;
  if (pathname.startsWith("/favicon")) return false;
  // Likely static files
  if (/\.[a-zA-Z0-9]+$/.test(pathname.split("/").pop() || "")) return false;

  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (first && SKIP_FIRST_SEGMENT.has(first)) return false;

  if (pathname === "/") return true;
  return first ? AGENCY_APP_PREFIXES.has(first) : false;
}

/** Map `/agencies/[slug]/console` → `/console` for auth checks. */
export function stripAgencyPath(pathname: string): string {
  const m = pathname.match(/^\/agencies\/[^/]+(\/.*)?$/);
  if (!m) return pathname;
  const rest = m[1];
  return rest && rest.length > 0 ? rest : "/console";
}
