import type { MetadataRoute } from "next";
import { PUBLIC_INTEGRATION_SLUGS } from "@/lib/public-integrations";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

const PUBLIC_ROUTES = [
  "",
  "/about",
  "/changelog",
  "/docs",
  "/integrations",
  "/looker-studio",
  "/platform",
  "/pricing",
  "/solutions",
  "/solutions/agencies",
  "/solutions/smes",
  "/support",
  "/templates",
  "/legal/privacy-policy",
  "/legal/refund-policy",
  "/legal/terms-of-service",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    ...PUBLIC_ROUTES,
    ...PUBLIC_INTEGRATION_SLUGS.map((slug) => `/integrations/${slug}`),
  ];

  return routes.map((path) => ({
    url: `${PRODUCT_SITE_URL}${path}`,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : path === "/integrations" || path === "/pricing" || path === "/docs" ? 0.8 : 0.6,
  }));
}
