import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireCronSecret } from "@/lib/request-auth";
import { cleanupSeatSharingTelemetry } from "@/lib/seat-sharing-retention";
import { recordSecurityControlEvent } from "@/lib/security-control-events";

export async function GET(request: Request) {
  const denied = requireCronSecret(request, "seat_sharing_retention");
  if (denied) return denied;

  try {
    const cleanup = await cleanupSeatSharingTelemetry();
    await recordSecurityControlEvent({
      eventType: "retention_cleanup",
      outcome: "success",
      scope: "seat_sharing",
      metadata: { hasMore: cleanup.hasMore },
    });
    return NextResponse.json({ ok: true, cleanup });
  } catch (error) {
    logger.error("[seat-sharing-retention] cleanup failed", error);
    await recordSecurityControlEvent({
      eventType: "retention_cleanup",
      outcome: "failure",
      scope: "seat_sharing",
    });
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
