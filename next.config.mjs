import { fileURLToPath } from "url";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    BUILD_TIME: process.env.BUILD_TIME || new Date().toISOString(),
    // This value is the immutable release stamp consumed by /api/version.
    // Production workflows must set GIT_COMMIT_SHA explicitly before building.
    GIT_COMMIT_SHA: process.env.GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "development",
  },
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
      { source: "/transformations", destination: "/explorer", permanent: false },
      { source: "/internal-templates", destination: "/console", permanent: false },
      { source: "/ops", destination: "/console", permanent: false },
      // Short URL for payment gateways and app store listings
      { source: "/refund", destination: "/legal/refund-policy", permanent: true },
      { source: "/privacy", destination: "/legal/privacy-policy", permanent: true },
      { source: "/privacy-policy", destination: "/legal/privacy-policy", permanent: true },
      { source: "/terms", destination: "/legal/terms-of-service", permanent: true },
      { source: "/terms-of-service", destination: "/legal/terms-of-service", permanent: true },
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
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "frame-ancestors 'self'",
              "frame-src 'self' https://www.googletagmanager.com https://www.google.com https://*.paddle.com https://buy.paddle.com https://sandbox-buy.paddle.com https://checkout.paddle.com https://sandbox-checkout.paddle.com",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net https://cdn.paddle.com https://sandbox-cdn.paddle.com",
              "style-src 'self' 'unsafe-inline' https://cdn.paddle.com https://sandbox-cdn.paddle.com",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data:",
              "connect-src 'self' https://www.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://stats.g.doubleclick.net https://connect.facebook.net https://www.facebook.com https://graph.facebook.com https://*.facebook.com https://accounts.google.com https://oauth2.googleapis.com https://*.googleapis.com https://*.tiktok.com https://*.tiktokglobalshop.com https://partner.shopeemobile.com https://open.shopee.com https://api.lazada.sg https://*.lazada.com https://auth.lazada.com https://googleads.googleapis.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://vitals.vercel-insights.com https://*.vercel-insights.com https://*.paddle.com https://checkout-service.paddle.com https://sandbox-checkout-service.paddle.com",
              "upgrade-insecure-requests",
            ].join("; "),
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
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
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

  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },

  // Widens file upload glob to include pages/ and app/ routes
  widenClientFileUpload: true,
});
