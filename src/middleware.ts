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
    "/dashboard/:path*",
    "/destinations/:path*",
    "/explorer/:path*",
    "/overview/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/templates/:path*",
    "/transformations/:path*",
    "/api/pipelines/:path*",
    "/api/connections/:path*",
    "/api/workspaces/:path*",
    "/api/user/:path*",
  ],
};
