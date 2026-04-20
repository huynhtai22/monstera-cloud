import { PRODUCT_SITE_URL } from "@/lib/site-url";

/**
 * Local SVG brand marks under /public/logos (Simple Icons MIT, except lazada.svg: Wikimedia Commons “Lazada (2019).svg”).
 * Keeps logos sharp at any size and avoids third-party CDN drift.
 */
export const INTEGRATION_LOGOS = {
  tiktok: "/logos/tiktok.svg",
  shopee: "/logos/shopee.svg",
  meta: "/logos/meta.svg",
  googleAds: "/logos/google-ads.svg",
  googleSheets: "/logos/gsheets.svg",
  looker: "/logos/looker.svg",
  slack: "/logos/slack.svg",
  shopify: "/logos/shopify.svg",
  lazada: "/logos/lazada.svg",
  googleAnalytics: "/logos/googleanalytics.svg",
  postgresql: "/logos/postgresql.svg",
  amazon: "/logos/amazon.svg",
} as const;

export type IntegrationLogoKey = keyof typeof INTEGRATION_LOGOS;

export function logoPathForCatalogId(catalogId: string): string {
  const map: Record<string, string> = {
    tiktok_shop: INTEGRATION_LOGOS.tiktok,
    tiktok_business: INTEGRATION_LOGOS.tiktok,
    meta_ads: INTEGRATION_LOGOS.meta,
    google_ads: INTEGRATION_LOGOS.googleAds,
    shopee: INTEGRATION_LOGOS.shopee,
    lazada: INTEGRATION_LOGOS.lazada,
    shopify: INTEGRATION_LOGOS.shopify,
    amazon: INTEGRATION_LOGOS.amazon,
  };
  return map[catalogId] ?? INTEGRATION_LOGOS.postgresql;
}

export function logoPathForConnectionProvider(provider: string): string {
  const p = provider.toLowerCase();
  if (p === "meta_ads") return INTEGRATION_LOGOS.meta;
  if (p === "google_ads") return INTEGRATION_LOGOS.googleAds;
  if (p.includes("shopee")) return INTEGRATION_LOGOS.shopee;
  if (p.includes("facebook") || p.includes("fb")) return INTEGRATION_LOGOS.meta;
  if ((p.includes("google") && p.includes("analytics")) || p.includes("ga4"))
    return INTEGRATION_LOGOS.googleAnalytics;
  if (p.includes("tiktok_business")) return INTEGRATION_LOGOS.tiktok;
  if (p.includes("tiktok_shop") || p === "tiktok") return INTEGRATION_LOGOS.tiktok;
  if (p === "amazon") return INTEGRATION_LOGOS.amazon;
  return INTEGRATION_LOGOS.postgresql;
}

/** For APIs consumed outside the browser (e.g. Google Sheets add-on). */
export function absoluteIntegrationLogo(path: string): string {
  if (path.startsWith("http")) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${PRODUCT_SITE_URL}${p}`;
}
