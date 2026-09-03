import { NextResponse } from "next/server";
import { resolveReleaseIdentity } from "@/lib/release-identity";
import { resolveLatestMigrationVersion } from "@/lib/release-schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const releaseIdentity = resolveReleaseIdentity({
    // RELEASE_COMMIT_SHA is set only by trusted production release paths and
    // stamped into the build. Provider metadata remains an explicit fallback.
    buildCommitSha: process.env.RELEASE_COMMIT_SHA,
    vercelCommitSha: process.env.VERCEL_GIT_COMMIT_SHA,
  });

  return NextResponse.json(
    {
      ...releaseIdentity,
      buildTime: process.env.BUILD_TIME || null,
      schemaVersion: resolveLatestMigrationVersion(),
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
