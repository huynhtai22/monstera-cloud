import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isLazadaConnectEnabled } from "@/lib/integration-flags";
import { getLazadaAuthorizeUrl } from "@/lib/lazada";

function publicBaseUrl(request: Request): string {
  const explicit = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  if (!isLazadaConnectEnabled()) {
    return NextResponse.json(
      { error: "Lazada connection is disabled" },
      { status: 403 }
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    const login = new URL("/login", publicBaseUrl(request));
    login.searchParams.set("callbackUrl", "/sources");
    return NextResponse.redirect(login);
  }

  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state");
  if (!state?.trim()) {
    return NextResponse.json(
      { error: "Missing state (workspace id)" },
      { status: 400 }
    );
  }

  const base = publicBaseUrl(request);
  const redirectUri =
    process.env.LAZADA_REDIRECT_URI?.trim() ||
    `${base}/api/auth/lazada/callback`;

  try {
    const url = getLazadaAuthorizeUrl({ redirectUri, state });
    return NextResponse.redirect(url);
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Lazada OAuth not configured" },
      { status: 500 }
    );
  }
}
