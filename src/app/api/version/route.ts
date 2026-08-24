import { NextResponse } from "next/server";
import { resolveReleaseIdentity } from "@/lib/release-identity";

export const dynamic = "force-dynamic";

export async function GET() {
  const releaseIdentity = resolveReleaseIdentity({
    // GIT_COMMIT_SHA is stamped into the Next.js build. Prefer it over runtime
    // provider metadata, which can be stale on deployments created by the CLI.
    buildCommitSha: process.env.GIT_COMMIT_SHA,
    vercelCommitSha: process.env.VERCEL_GIT_COMMIT_SHA,
  });

  return NextResponse.json(
    {
      ...releaseIdentity,
      buildTime: process.env.BUILD_TIME || null,
      schemaVersion: "20260819000000_support_tickets",
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
