import { NextResponse } from "next/server";
import crypto from "crypto";

/**
 * Debug endpoint — verifies the Shopee HMAC-SHA256 signature computation.
 * Returns the basestring, computed sign, and the full auth URL so you can
 * compare against Shopee's expected format.
 *
 * GET /api/debug/shopee-sign
 * Remove this file before going to production.
 */
export async function GET() {
    const partnerId = (process.env.SHOPEE_PARTNER_ID ?? "").trim();
    const partnerKey = (process.env.SHOPEE_PARTNER_KEY ?? "").trim();
    const isSandbox = process.env.SHOPEE_SANDBOX === "true";

    const path = "/api/v2/shop/auth_partner";
    const ts = Math.floor(Date.now() / 1000);
    const basestring = `${partnerId}${path}${ts}`;
    const sign = crypto
        .createHmac("sha256", partnerKey)
        .update(basestring)
        .digest("hex");

    const host = isSandbox
        ? "https://partner.test-stable.shopeemobile.com"
        : "https://partner.shopeemobile.com";

    const url = new URL(`${host}${path}`);
    url.searchParams.set("partner_id", partnerId);
    url.searchParams.set("redirect", "https://monsteracloud.com/api/auth/shopee/callback");
    url.searchParams.set("timestamp", String(ts));
    url.searchParams.set("sign", sign);

    return NextResponse.json({
        sandbox: isSandbox,
        host,
        partner_id: partnerId,
        partner_key_length: partnerKey.length,
        partner_key_preview: `${partnerKey.slice(0, 6)}...${partnerKey.slice(-4)}`,
        timestamp: ts,
        basestring,
        sign,
        auth_url: url.toString(),
    });
}
