import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || "development",
      buildTime: process.env.BUILD_TIME || null,
      schemaVersion: "20260813090000_agency_pilot_tenancy",
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
