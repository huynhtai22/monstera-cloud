import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getUnassignedTupleExclusions, unassignedTupleFilter } from "@/lib/warehouse-query";

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

  const clientId = searchParams.get("clientId");

  try {
    if (clientId && clientId !== "unassigned") {
      const client = await prisma.client.findFirst({
        where: { id: clientId, workspaceId },
        select: { id: true, accountAssignmentsConfiguredAt: true },
      });
      if (!client) {
        return NextResponse.json({ error: "Client not found in workspace" }, { status: 404 });
      }
      const isExplicit = client.accountAssignmentsConfiguredAt !== null;
      if (isExplicit) {
        const assignments = await prisma.clientProviderAccountAssignment.findMany({
          where: { workspaceId, clientId },
          select: { provider: true },
        });
        if (assignments.length > 0) {
          const distinct = [...new Set(assignments.map((a) => a.provider))].sort();
          return NextResponse.json({ platforms: distinct });
        }
        return NextResponse.json({ platforms: [] });
      }

      const legacyPlatforms = await prisma.campaignMetric.findMany({
        where: { workspaceId, connection: { clientId } },
        distinct: ["platform"],
        select: { platform: true },
      });
      return NextResponse.json({ platforms: legacyPlatforms.map((p) => p.platform) });
    }

    if (clientId === "unassigned") {
      const where = {
        workspaceId,
        ...unassignedTupleFilter(await getUnassignedTupleExclusions(workspaceId)),
      };
      const platforms = await prisma.campaignMetric.findMany({
        where,
        distinct: ["platform"],
        select: { platform: true },
        take: 50,
      });
      return NextResponse.json({ platforms: platforms.map((p) => p.platform) });
    }

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
