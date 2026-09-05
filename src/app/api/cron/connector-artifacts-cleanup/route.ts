import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireCronSecret } from "@/lib/request-auth";
import { cleanupExpiredArtifacts } from "@/lib/connector-runtime/retention";

/**
 * POST /api/cron/connector-artifacts-cleanup
 *
 * Deletes expired ConnectorRunArtifact rows (retainedUntil < cutoff) in
 * bounded batches. Never touches certification evidence, warehouse metrics,
 * or unexpired artifacts. Authenticated with the shared CRON_SECRET like
 * the other internal cron routes.
 *
 * Optional JSON body: { "before": "<ISO date, defaults to now>", "limit": <1..1000, defaults to 500> }.
 */
export async function POST(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const before = typeof body.before === "string" ? new Date(body.before) : undefined;

  try {
    const summary = await cleanupExpiredArtifacts({ before, limit: body.limit });
    return NextResponse.json({ ok: true, cleanup: summary });
  } catch (error) {
    logger.error("[connector-artifacts-cleanup] failed:", error);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
