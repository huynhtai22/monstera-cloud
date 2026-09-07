import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getUnassignedTupleExclusions, unassignedTupleFilter } from "@/lib/warehouse-query";

/**
 * Distinct workspace ad accounts stored in CampaignMetric (for explorer filters).
 * GET ?workspaceId=
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = new URL(req.url).searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: session.user.id },
  });
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const clientId = new URL(req.url).searchParams.get("clientId");

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
        where: { workspaceId, connection: { clientId } },
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

    if (clientId === "unassigned") {
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
