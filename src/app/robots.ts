import type { MetadataRoute } from "next";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin/",
        "/agencies/",
        "/api/",
        "/auth/",
        "/clients/",
        "/console/",
        "/demo/",
        "/explorer/",
        "/exports/",
        "/login",
        "/ops/",
        "/register",
        "/settings/",
        "/showcase",
        "/sources/",
      ],
    },
    sitemap: `${PRODUCT_SITE_URL}/sitemap.xml`,
    host: PRODUCT_SITE_URL,
  };
}
