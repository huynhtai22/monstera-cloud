import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { apiRatelimit } from "@/lib/ratelimit";

export async function middleware(request: NextRequest) {
  // Global rate limit for all /api/* routes (excluding add-on endpoints)
  // Uses Upstash if configured; otherwise no-op.
  if (
    apiRatelimit &&
    request.nextUrl.pathname.startsWith("/api/") &&
    !request.nextUrl.pathname.startsWith("/api/v1/sheets")
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

  // Add CORS headers for /api/v1/sheets/* routes (called by Google Apps Script)
  if (request.nextUrl.pathname.startsWith('/api/v1/sheets')) {
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const response = NextResponse.next();
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return response;
  }

  return NextResponse.next();
}

export const config = {
  // Exclude /api/auth/* — NextAuth handles its own OAuth callbacks and session
  // cookies there; custom middleware intercepting those routes breaks Google sign-in.
  matcher: ['/api/((?!auth/).*)', '/api/v1/sheets/:path*'],
};
