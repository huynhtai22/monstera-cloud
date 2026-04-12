import { fileURLToPath } from "url";
import path from "path";

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

export default nextConfig;
