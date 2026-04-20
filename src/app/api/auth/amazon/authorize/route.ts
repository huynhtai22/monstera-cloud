import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAmazonConnectEnabled } from "@/lib/integration-flags";
import { getAmazonSpConsentUrl } from "@/lib/amazon-sp";

function publicBaseUrl(request: Request): string {
  const explicit = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  if (!isAmazonConnectEnabled()) {
    return NextResponse.json(
      { error: "Amazon Selling Partner connection is disabled" },
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

  try {
    const url = getAmazonSpConsentUrl(state);
    return NextResponse.redirect(url);
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Amazon OAuth not configured" },
      { status: 500 }
    );
  }
}
