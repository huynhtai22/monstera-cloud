import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ShopeeClient } from "@/lib/shopee";

export async function GET(request: Request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get("workspaceId");

        if (!workspaceId) {
            return NextResponse.json({ error: "Missing workspaceId parameter." }, { status: 400 });
        }

        const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
        const host = request.headers.get("host") || "localhost:3000";
        
        // Pass the workspaceId into the redirect URL so Shopee hands it back to us
        const redirectUrl = `${protocol}://${host}/api/auth/shopee/callback?workspaceId=${workspaceId}`;

        const shopee = new ShopeeClient();
        const authUrl = shopee.getAuthUrl(redirectUrl);

        return NextResponse.json({ url: authUrl });
    } catch (error) {
        console.error("Error generating Shopee Auth URL:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
