import { withAuth } from "next-auth/middleware";

export default withAuth({
  callbacks: {
    authorized: ({ token }) => !!token,
  },
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    "/destinations",
    "/destinations/:path*",
    "/explorer",
    "/explorer/:path*",
    "/overview",
    "/overview/:path*",
    "/reports",
    "/reports/:path*",
    "/settings",
    "/settings/:path*",
    "/transformations",
    "/transformations/:path*",
    "/internal-templates",
    "/internal-templates/:path*",
    "/api/pipelines",
    "/api/pipelines/:path*",
    "/api/connections",
    "/api/connections/:path*",
    "/api/workspaces",
    "/api/workspaces/:path*",
    "/api/user",
    "/api/user/:path*",
  ],
};
