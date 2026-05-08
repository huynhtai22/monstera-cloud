import { fileURLToPath } from "url";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin workspace root explicitly so Next.js/Turbopack doesn't get confused
  // by a stale package-lock.json sitting in a parent directory.
  turbopack: {
    root: __dirname,
  },
  async redirects() {
    return [
      { source: "/dashboard", destination: "/console", permanent: true },
      { source: "/dashboard/:path*", destination: "/console/:path*", permanent: true },
      { source: "/overview", destination: "/console", permanent: true },
      { source: "/tiktok-ads", destination: "/reports?source=tiktok_business", permanent: true },
      { source: "/meta-ads", destination: "/reports?source=meta_ads", permanent: true },
      { source: "/google-ads", destination: "/reports?source=google_ads", permanent: true },
      { source: "/shopee", destination: "/reports?source=shopee", permanent: true },
      // Legacy: merged into Data Explorer (warehouse + column picker + batch import)
      { source: "/synced-data", destination: "/explorer", permanent: true },
      { source: "/synced-data/:path*", destination: "/explorer", permanent: true },
      // Short URL for payment gateways and app store listings
      { source: "/refund", destination: "/legal/refund-policy", permanent: true },
    ];
  },
  // OWASP Security Headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https:; frame-ancestors 'self'; upgrade-insecure-requests;",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Suppresses Sentry CLI output during build
  silent: !process.env.CI,

  // Upload source maps to Sentry for readable stack traces (set SENTRY_ORG + SENTRY_PROJECT in Vercel)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Hides source maps from the client bundle (security)
  hideSourceMaps: true,

  // Disables verbose Sentry logger in production bundle
  disableLogger: true,

  // Widens file upload glob to include pages/ and app/ routes
  widenClientFileUpload: true,
});
