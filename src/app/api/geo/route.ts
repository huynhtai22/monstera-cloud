import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    const searchCountry = req.nextUrl.searchParams.get("country");
    const acceptLang = req.headers.get("accept-language") || "";
    
    // Check headers, query param, or fallback
    let country =
        searchCountry?.toUpperCase() ||
        req.headers.get("x-vercel-ip-country") ||
        req.headers.get("cf-ipcountry");

    // In local development or if header is missing, detect via accept-language
    if (!country) {
        if (acceptLang.toLowerCase().includes("vi") || acceptLang.toLowerCase().includes("vn")) {
            country = "VN";
        } else {
            country = "US";
        }
    }

    const city = req.headers.get("x-vercel-ip-city") || "";
    const isVietnam = country.toUpperCase() === "VN";

    return NextResponse.json({
        country: country.toUpperCase(),
        city,
        currency: isVietnam ? "VND" : "USD",
        isVietnam,
    });
}
