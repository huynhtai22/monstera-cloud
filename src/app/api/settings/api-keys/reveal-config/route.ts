import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

/**
 * Returns public OAuth client id for Google step-up (GSI token client) when revealing API keys.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
    return NextResponse.json({
      googleClientId: clientId.length > 0 ? clientId : null,
    });
  } catch (error) {
    console.error("[GET reveal-config]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
