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
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public (public files)
     * - login, register, pricing, solutions, success (marketing & auth pages)
     * - legal (legal and compliance pages)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|logo.png|favicon.png|login|register|pricing|solutions|success|legal|$).*)",
  ],
};
