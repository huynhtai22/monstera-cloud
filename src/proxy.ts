import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import {
  classifyApiRoute,
  enforceRequestLimit,
  type EnforceOptions,
} from "@/lib/request-rate-limit-policy";
import { classifyPageAccess } from "@/lib/page-access-policy";
import { safeCallbackUrl } from "@/lib/safe-callback-url";
import {
  pathnameNeedsAgencyRewrite,
  resolveAgencySlugFromHost,
  stripAgencyPath,
} from "@/lib/agency-host";

/**
 * Edge proxy (Next.js middleware).
 *
 * Responsibilities are split across dedicated policy modules:
 * - Page authentication: src/lib/page-access-policy.ts — DENY-BY-DEFAULT.
 *   Everything not explicitly public requires a session JWT. Browser page
 *   auth never touches Upstash, so an upstream limiter outage cannot take
 *   pages down.
 * - API rate limiting: src/lib/request-rate-limit-policy.ts — route classes
 *   with per-class limits, identity tiers, and documented failure policies.
 *
 * Static assets (anything whose last URL segment has a file extension) pass
 * straight through; the broad matcher below keeps this cheap instead of
 * enumerating every asset pattern.
 */

function looksLikeStaticAsset(pathname: string): boolean {
  const lastSegment = pathname.split("/").pop() ?? "";
  return /\.[a-zA-Z0-9]+$/.test(lastSegment);
}

// Add CORS headers for /api/v1/sheets/* routes (called by Google Apps Script add-on)
// OWASP Fix: Use specific origin instead of wildcard (*) for security compliance
const SHEET_ADDON_ALLOWED_ORIGINS = [
  'https://monsteracloud.com',
  'https://www.monsteracloud.com',
  // Google Apps Script origins - required for Sheets add-on functionality
  'https://script.google.com',
  'https://script.googleusercontent.com',
];

function sheetAddonAllowedOrigin(request: NextRequest): string {
  const origin = request.headers.get('origin') || 'https://monsteracloud.com';
  return SHEET_ADDON_ALLOWED_ORIGINS.includes(origin) ? origin : 'https://monsteracloud.com';
}

function sheetAddonPreflightResponse(allowedOrigin: string): Response {
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

function withSheetAddonCors(response: Response, allowedOrigin: string): Response {
  response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.headers.set('Vary', 'Origin');
  return response;
}

/** Injectable session verifier contract (tests stub this; defaults to NextAuth JWT). */
export type SessionTokenVerifier = (args: {
  req: NextRequest;
  secret?: string;
}) => Promise<unknown>;

type ProxyDeps = {
  /** Injectable session verifier (defaults to next-auth JWT cookie lookup). */
  getSessionToken?: SessionTokenVerifier;
  /** Injectable enforcement options (fake limiters, production flag, timeouts). */
  enforceOptions?: EnforceOptions;
};

function createProxy(deps: ProxyDeps = {}) {
  const verifySessionToken: SessionTokenVerifier =
    deps.getSessionToken ??
    (({ req }) => getToken({ req, secret: process.env.NEXTAUTH_SECRET }));

  return async function proxy(request: NextRequest): Promise<Response> {
    const pathname = request.nextUrl.pathname;
    const host = request.headers.get("host") ?? "";

    /* ----------------------------- API pipeline ----------------------------- */
    if (pathname.startsWith("/api/")) {
      // CORS preflight must never be throttled or rejected by limiter outages.
      const routeClass = classifyApiRoute(pathname);
      if (routeClass === "external-sheets" && request.method === "OPTIONS") {
        return sheetAddonPreflightResponse(sheetAddonAllowedOrigin(request));
      }

      // First-party APIs key the limiter per verified user (falls back to IP
      // pre-auth) so shared office/VPN addresses cannot exhaust one budget.
      let enforceOptions = deps.enforceOptions;
      if (routeClass === "internal-api" && !enforceOptions?.sessionUserId) {
        try {
          const sessionToken = await verifySessionToken({ req: request });
          const sessionUserId = (sessionToken as { sub?: unknown } | null)?.sub;
          if (typeof sessionUserId === "string" && sessionUserId) {
            enforceOptions = { ...enforceOptions, sessionUserId };
          }
        } catch {
          /* identity stays IP-based on verifier failure */
        }
      }

      const enforcement = await enforceRequestLimit(request, pathname, enforceOptions);
      if (
        enforcement.outcome === "blocked" ||
        enforcement.outcome === "failed-closed" ||
        enforcement.outcome === "fallback-blocked"
      ) {
        return enforcement.response;
      }

      const response = NextResponse.next();
      if (routeClass === "external-sheets") {
        withSheetAddonCors(response, sheetAddonAllowedOrigin(request));
      }
      return response;
    }

    /* ---------------------------- Page pipeline ----------------------------- */
    if (looksLikeStaticAsset(pathname)) {
      return NextResponse.next();
    }

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

    // Deny-by-default: any page not explicitly public needs a session JWT.
    if (classifyPageAccess(authCheckPath) === "authenticated") {
      const token = await verifySessionToken({ req: request });
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
  };
}

/** Production entry point. */
export const proxy = createProxy();

/** Test seam: build a proxy with injected session/rate-limit dependencies. */
export function __createProxyForTests(deps: ProxyDeps): (request: NextRequest) => Promise<Response> {
  return createProxy(deps);
}

// Matcher notes:
// - `/api/*` except `/api/auth/*`: NextAuth internals (OAuth callbacks, session,
//   CSRF) must NOT be intercepted — doing so breaks Google sign-in.
// - The five credential endpoints under /api/auth/* ARE matched explicitly so
//   they get the dedicated `credential` limiter class.
// - Pages use a deny-by-default catch-all (minus _next assets and common
//   top-level metadata files). Remaining static files are passed through in
//   code via looksLikeStaticAsset(). New application routes therefore require
//   a session automatically.
export const config = {
  matcher: [
    "/api/((?!auth/).*)",
    "/api/auth/forgot-password",
    "/api/auth/register",
    "/api/auth/resend-otp",
    "/api/auth/reset-password",
    "/api/auth/verify",
    "/((?!api/|_next/|favicon.ico|robots.txt|sitemap.xml|manifest.json).*)",
  ],
};
