import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    const country =
        req.headers.get("x-vercel-ip-country") ||
        req.headers.get("cf-ipcountry") ||
        "US";

    const city =
        req.headers.get("x-vercel-ip-city") ||
        "";

    const isVietnam = country.toUpperCase() === "VN";

    return NextResponse.json({
        country: country.toUpperCase(),
        city,
        currency: isVietnam ? "VND" : "USD",
        isVietnam,
    });
}
