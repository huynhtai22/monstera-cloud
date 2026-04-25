import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

/**
 * Lazada Open Platform — Push Mechanism callback (server notifications).
 * Configure this URL in Developer Console → App Management → Push Mechanism → Callback URL.
 *
 * OAuth seller redirect remains: /api/auth/lazada/callback (browser flow only).
 *
 * Lazada may call GET to verify the URL; POST delivers push payloads. We ACK with 200
 * so the console verification succeeds; event handling can be extended later.
 */
export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text) {
      const preview = text.slice(0, 500);
      logger.info("[LAZADA_PUSH] received", preview);
    }
  } catch (e) {
    logger.warn("[LAZADA_PUSH] read body", e);
  }
  return NextResponse.json({ success: true }, { status: 200 });
}
