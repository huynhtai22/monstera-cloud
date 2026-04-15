import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

/**
 * GET /api/debug/sentry-test
 * Temporary endpoint to verify Sentry is capturing errors.
 * DELETE THIS ROUTE after confirming Sentry works.
 */
export async function GET() {
  Sentry.captureException(new Error("[Sentry test] Manual error from /api/debug/sentry-test — safe to ignore"));
  return NextResponse.json({ ok: true, message: "Test error sent to Sentry. Check your Issues dashboard." });
}
