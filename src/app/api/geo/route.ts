import { NextRequest, NextResponse } from "next/server";
import { resolvePricingGeo } from "@/lib/pricing-geo";

export async function GET(req: NextRequest) {
    const geo = resolvePricingGeo({
        country: req.nextUrl.searchParams.get("country"),
        vercelCountry: req.headers.get("x-vercel-ip-country"),
        cfCountry: req.headers.get("cf-ipcountry"),
        acceptLanguage: req.headers.get("accept-language"),
    });
    const city = req.headers.get("x-vercel-ip-city") || "";

    return NextResponse.json({
        country: geo.country,
        city,
        currency: geo.currency,
        isVietnam: geo.isVietnam,
    });
}
