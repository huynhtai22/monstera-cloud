import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    // Public paths that should bypass auth
    if (
      pathname === "/logo.png" || 
      pathname === "/favicon.png" || 
      pathname === "/favicon.ico"
    ) {
      return NextResponse.next();
    }
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/login",
    },
  }
);

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
