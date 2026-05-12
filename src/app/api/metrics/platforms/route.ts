import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * GET /api/metrics/platforms?workspaceId=...
 * 
 * Returns distinct platforms available in the workspace.
 * This is a lightweight endpoint for populating the platform filter dropdown.
 * Not affected by date range - shows all platforms that have ever synced data.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  // Verify user has access to workspace
  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: session.user.id },
  });

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Get distinct platforms for this workspace
    const platforms = await prisma.campaignMetric.findMany({
      where: { workspaceId },
      distinct: ["platform"],
      select: { platform: true },
      take: 50,
    });

    return NextResponse.json({
      platforms: platforms.map((p) => p.platform),
    });
  } catch (error) {
    console.error("[metrics/platforms] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch platforms" },
      { status: 500 }
    );
  }
}
