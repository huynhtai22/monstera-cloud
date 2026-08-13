import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/request-auth";

/**
 * META KEEP-ALIVE CRON
 *
 * Daily ping to the Meta Graph API to prevent the access token from going
 * dormant. Fetches a small slice of ad accounts so the token stays active.
 *
 * Schedule: every day at 10:00 UTC (configured in vercel.json)
 */
export async function GET(req: Request) {
    const denied = requireCronSecret(req);
    if (denied) return denied;

    const accessToken = process.env.META_ACCESS_TOKEN;
    if (!accessToken) {
        console.error("[meta-keep-alive] META_ACCESS_TOKEN is not set");
        return NextResponse.json(
            { error: "META_ACCESS_TOKEN not configured" },
            { status: 500 },
        );
    }

    try {
        const url = `https://graph.facebook.com/v19.0/me/adaccounts?fields=name,account_status&limit=5&access_token=${accessToken}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.error) {
            console.error("[meta-keep-alive] Meta API error:", data.error);
            return NextResponse.json(
                { error: data.error.message ?? "Meta API error", type: data.error.type },
                { status: 500 },
            );
        }

        const count = Array.isArray(data.data) ? data.data.length : 0;
        console.log(`[meta-keep-alive] OK — pinged Meta Graph API, ${count} ad account(s) returned`);

        return NextResponse.json({ ok: true, adAccountCount: count });
    } catch (err: any) {
        console.error("[meta-keep-alive] Unexpected error:", err);
        return NextResponse.json(
            { error: err.message ?? "Unexpected error" },
            { status: 500 },
        );
    }
}
