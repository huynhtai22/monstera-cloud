import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { apiRatelimit } from "@/lib/ratelimit";
import { safeCallbackUrl } from "@/lib/safe-callback-url";
import {
  pathnameNeedsAgencyRewrite,
  resolveAgencySlugFromHost,
  stripAgencyPath,
} from "@/lib/agency-host";

/** Logged-in app surfaces (must match routes under `src/app/(app)/`). */
const APP_AUTH_SEGMENTS = [
  "console",
  "sources",
  "settings",
  "reports",
  "explorer",
  "synced-data",
  "clients",
  "destinations",
  "transformations",
  "internal-templates",
  "overview",
  "quickstart",
  "ops",
  "meta-ads",
  "shopee",
  "google-ads",
  "tiktok-ads",
] as const;

function pathnameNeedsAppAuth(pathname: string): boolean {
  return APP_AUTH_SEGMENTS.some(
    (seg) => pathname === `/${seg}` || pathname.startsWith(`/${seg}/`)
  );
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get("host") ?? "";

  const agencySlug =
    !pathname.startsWith("/agencies/")
      ? resolveAgencySlugFromHost(host)
      : null;
  const shouldAgencyRewrite = Boolean(
    agencySlug && pathnameNeedsAgencyRewrite(pathname),
  );

  const authCheckPath = pathname.startsWith("/agencies/")
    ? stripAgencyPath(pathname)
    : pathname;

  // Global rate limit for all /api/* routes (excluding add-on endpoints)
  // Uses Upstash if configured; otherwise no-op.
  if (
    apiRatelimit &&
    request.nextUrl.pathname.startsWith("/api/") &&
    !request.nextUrl.pathname.startsWith("/api/webhooks/") &&
    !request.nextUrl.pathname.startsWith("/api/v1/sheets") &&
    !request.nextUrl.pathname.startsWith("/api/looker-studio")
  ) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";

    try {
      const result = await Promise.race([
        apiRatelimit.limit(ip),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("ratelimit timeout")), 3000)
        ),
      ]);

      if (!result.success) {
        const res = NextResponse.json(
          { error: "Too Many Requests" },
          { status: 429 }
        );
        if (result.reset) {
          res.headers.set("x-ratelimit-reset", String(result.reset));
        }
        res.headers.set("x-ratelimit-limit", String(result.limit));
        res.headers.set("x-ratelimit-remaining", String(result.remaining));
        return res;
      }
    } catch {
      // Upstash Redis unavailable — skip rate limiting, don't block requests
      console.warn("[middleware] Rate limiter unavailable, skipping");
    }
  }

  // Add CORS headers for /api/v1/sheets/* routes (called by Google Apps Script add-on)
  // OWASP Fix: Use specific origin instead of wildcard (*) for security compliance
  const ALLOWED_ORIGINS = [
    'https://monsteracloud.com',
    'https://www.monsteracloud.com',
    // Google Apps Script origins - required for Sheets add-on functionality
    'https://script.google.com',
    'https://script.googleusercontent.com',
  ];
  
  if (request.nextUrl.pathname.startsWith('/api/v1/sheets')) {
    const origin = request.headers.get('origin') || 'https://monsteracloud.com';
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : 'https://monsteracloud.com';
    
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
          'Vary': 'Origin',
        },
      });
    }

    const response = NextResponse.next();
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Vary', 'Origin');
    return response;
  }

  // Require a session JWT for in-app pages (otherwise /api/workspaces returns 401 and the UI looks "broken").
  if (pathnameNeedsAppAuth(authCheckPath)) {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });
    if (!token) {
      const login = new URL("/login", request.url);
      const nextPath =
        authCheckPath +
        (request.nextUrl.search || "");
      login.searchParams.set(
        "callbackUrl",
        safeCallbackUrl(nextPath, "/console")
      );
      return NextResponse.redirect(login);
    }
  }

  if (shouldAgencyRewrite && agencySlug) {
    const url = request.nextUrl.clone();
    const suffix = pathname === "/" ? "/console" : pathname;
    url.pathname = `/agencies/${agencySlug}${suffix}`;
    const res = NextResponse.rewrite(url);
    res.headers.set("x-monstera-agency-slug", agencySlug);
    return res;
  }

  return NextResponse.next();
}

// Must be static strings for Turbopack / Next.js to parse at compile time (no spread from arrays).
export const config = {
  // Exclude /api/auth/* — NextAuth handles its own OAuth callbacks and session
  // cookies there; custom middleware intercepting those routes breaks Google sign-in.
  matcher: [
    "/api/((?!auth/).*)",
    "/api/v1/sheets/:path*",
    "/sources",
    "/sources/:path*",
    "/settings",
    "/settings/:path*",
    "/reports",
    "/reports/:path*",
    "/explorer",
    "/explorer/:path*",
    "/synced-data",
    "/synced-data/:path*",
    "/clients",
    "/clients/:path*",
    "/destinations",
    "/destinations/:path*",
    "/transformations",
    "/transformations/:path*",
    "/internal-templates",
    "/internal-templates/:path*",
    "/console",
    "/console/:path*",
    "/agencies",
    "/agencies/:path*",
    "/overview",
    "/overview/:path*",
    "/quickstart",
    "/quickstart/:path*",
    "/ops",
    "/ops/:path*",
    "/meta-ads",
    "/meta-ads/:path*",
    "/shopee",
    "/shopee/:path*",
    "/google-ads",
    "/google-ads/:path*",
    "/tiktok-ads",
    "/tiktok-ads/:path*",
  ],
};
