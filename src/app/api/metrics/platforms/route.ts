import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { getUnassignedTupleExclusions, unassignedTupleFilter } from "@/lib/warehouse-query";
import {
  assertQueryableClientContext,
  resolveClientContext,
  toClientContextResponse,
  warehouseClientId,
} from "@/lib/client-context-server";

/**
 * GET /api/metrics/platforms?workspaceId=...
 * 
 * Returns distinct platforms available in the workspace.
 * This is a lightweight endpoint for populating the platform filter dropdown.
 * Not affected by date range - shows all platforms that have ever synced data.
 */
export async function GET(req: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "viewer",
      operation: "query_metrics_platforms",
    });
  } catch (err) {
    const rbac = toRbacResponse(err);
    if (rbac) return rbac;
    throw err;
  }

  const clientId = searchParams.get("clientId");
  let resolution;
  try {
    resolution = await resolveClientContext({
      workspaceId,
      requestedClientId: clientId,
      surface: "warehouse",
    });
    assertQueryableClientContext(resolution);
  } catch (err) {
    const clientCtx = toClientContextResponse(err);
    if (clientCtx) return clientCtx;
    throw err;
  }
  const scopedClientId = warehouseClientId(resolution);

  try {
    if (scopedClientId && scopedClientId !== "unassigned") {
      const client = await prisma.client.findFirst({
        where: { id: scopedClientId, workspaceId },
        select: { id: true, accountAssignmentsConfiguredAt: true },
      });
      if (!client) {
        return NextResponse.json({ error: "Client not found in workspace" }, { status: 404 });
      }
      const isExplicit = client.accountAssignmentsConfiguredAt !== null;
      if (isExplicit) {
        const assignments = await prisma.clientProviderAccountAssignment.findMany({
          where: { workspaceId, clientId: scopedClientId },
          select: { provider: true },
        });
        if (assignments.length > 0) {
          const distinct = [...new Set(assignments.map((a) => a.provider))].sort();
          return NextResponse.json({ platforms: distinct });
        }
        return NextResponse.json({ platforms: [] });
      }

      const legacyPlatforms = await prisma.campaignMetric.findMany({
        where: { workspaceId, connection: { clientId: scopedClientId } },
        distinct: ["platform"],
        select: { platform: true },
      });
      return NextResponse.json({ platforms: legacyPlatforms.map((p) => p.platform) });
    }

    if (scopedClientId === "unassigned") {
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
