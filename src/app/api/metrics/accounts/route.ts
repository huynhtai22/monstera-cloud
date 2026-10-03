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
 * Distinct workspace ad accounts stored in CampaignMetric (for explorer filters).
 * GET ?workspaceId=
 */
export async function GET(req: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = new URL(req.url).searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "viewer",
      operation: "query_metrics_accounts",
    });
  } catch (err) {
    const rbac = toRbacResponse(err);
    if (rbac) return rbac;
    throw err;
  }

  const clientId = new URL(req.url).searchParams.get("clientId");
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
          select: { provider: true, accountId: true, connectionId: true },
        });
        if (assignments.length > 0) {
          const where = {
            workspaceId,
            OR: assignments.map((a) => ({
              connectionId: a.connectionId,
              platform: a.provider,
              accountId: a.accountId,
            })),
          };
          const grouped = await prisma.campaignMetric.groupBy({
            by: ["accountId", "platform"],
            where,
            _max: { accountName: true },
            orderBy: [{ accountId: "asc" }, { platform: "asc" }],
          });
          return NextResponse.json({
            accounts: grouped.map((g) => ({
              accountId: g.accountId,
              platform: g.platform,
              accountName: g._max.accountName ?? "",
            })),
          });
        }
        return NextResponse.json({ accounts: [] });
      }

      const grouped = await prisma.campaignMetric.groupBy({
        by: ["accountId", "platform"],
        where: { workspaceId, connection: { clientId: scopedClientId } },
        _max: { accountName: true },
        orderBy: [{ accountId: "asc" }, { platform: "asc" }],
      });
      return NextResponse.json({
        accounts: grouped.map((g) => ({
          accountId: g.accountId,
          platform: g.platform,
          accountName: g._max.accountName ?? "",
        })),
      });
    }

    if (scopedClientId === "unassigned") {
      const where = {
        workspaceId,
        ...unassignedTupleFilter(await getUnassignedTupleExclusions(workspaceId)),
      };
      const grouped = await prisma.campaignMetric.groupBy({
        by: ["accountId", "platform"],
        where,
        _max: { accountName: true },
        orderBy: [{ accountId: "asc" }, { platform: "asc" }],
      });
      return NextResponse.json({
        accounts: grouped.map((g) => ({
          accountId: g.accountId,
          platform: g.platform,
          accountName: g._max.accountName ?? "",
        })),
      });
    }

    const grouped = await prisma.campaignMetric.groupBy({
      by: ["accountId", "platform"],
      where: { workspaceId },
      _max: { accountName: true },
      orderBy: [{ accountId: "asc" }, { platform: "asc" }],
    });

    const accounts = grouped.map((g) => ({
      accountId: g.accountId,
      platform: g.platform,
      accountName: g._max.accountName ?? "",
    }));

    return NextResponse.json({ accounts });
  } catch (e) {
    console.error("[metrics/accounts]", e);
    return NextResponse.json({ error: "Failed to load accounts" }, { status: 500 });
  }
}
