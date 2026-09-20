import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireCronSecret } from "@/lib/request-auth";
import { cleanupSeatSharingTelemetry } from "@/lib/seat-sharing-retention";

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  try {
    const cleanup = await cleanupSeatSharingTelemetry();
    return NextResponse.json({ ok: true, cleanup });
  } catch (error) {
    logger.error("[seat-sharing-retention] cleanup failed", error);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
