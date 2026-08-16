import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

function getAdminEmail(): string | null {
  return process.env.ADMIN_EMAIL?.trim().toLowerCase() || null;
}

function isAuthorizedAdmin(sessionUserEmail?: string | null): boolean {
  const admin = getAdminEmail();
  if (!admin || !sessionUserEmail) return false;
  return sessionUserEmail.trim().toLowerCase() === admin;
}

async function handleProxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // 1. Validate NextAuth session & admin role
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAuthorizedAdmin(session.user.email)) {
    return NextResponse.json(
      { error: "Forbidden: Admin authorization required" },
      { status: 403 }
    );
  }

  // 2. Resolve backend URL and secret
  const backendBaseUrl = (
    process.env.SIGNAL_DESK_API_URL || "http://127.0.0.1:8000"
  ).replace(/\/+$/, "");
  const serviceSecret = process.env.SIGNAL_DESK_SERVICE_SECRET || "";

  const resolvedParams = await params;
  const pathSegments = resolvedParams.path || [];
  const subPath = pathSegments.join("/");
  const searchParams = request.nextUrl.search;
  const targetUrl = `${backendBaseUrl}/api/${subPath}${searchParams}`;

  // 3. Prepare headers
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (serviceSecret) {
    headers["X-Internal-Service-Key"] = serviceSecret;
  }

  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  // 4. Prepare request body for write methods
  let body: string | undefined = undefined;
  if (["POST", "PUT", "PATCH"].includes(request.method)) {
    try {
      body = await request.text();
    } catch {
      body = undefined;
    }
  }

  // 5. Forward request to FastAPI backend with timeout safeguard
  try {
    const upstreamResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      signal: AbortSignal.timeout(300_000), // 5 min timeout for LLM analysis runs
    });

    const responseContentType =
      upstreamResponse.headers.get("content-type") || "";

    if (responseContentType.includes("application/json")) {
      const data = await upstreamResponse.json();
      return NextResponse.json(data, {
        status: upstreamResponse.status,
      });
    }

    const text = await upstreamResponse.text();
    return new NextResponse(text, {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": responseContentType || "text/plain",
      },
    });
  } catch (err: any) {
    const isTimeout =
      err?.name === "TimeoutError" || err?.name === "AbortError";
    const errorMessage = isTimeout
      ? "Signal Desk request timed out waiting for the upstream backend."
      : "Failed to connect to Signal Desk backend service. Ensure the FastAPI service is running.";

    return NextResponse.json(
      {
        error: errorMessage,
        detail: err?.message || String(err),
      },
      { status: isTimeout ? 504 : 502 }
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleProxy(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleProxy(request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleProxy(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleProxy(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleProxy(request, context);
}
