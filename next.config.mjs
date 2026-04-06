/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: "/dashboard", destination: "/console", permanent: true },
      { source: "/dashboard/:path*", destination: "/console/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
