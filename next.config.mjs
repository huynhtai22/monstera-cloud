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
      // Short URL for payment gateways and app store listings
      { source: "/refund", destination: "/legal/refund-policy", permanent: true },
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
