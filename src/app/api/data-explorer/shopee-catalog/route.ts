import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { resolveClientDataScope, toClientContextResponse } from "@/lib/client-context-server";
import { getUnassignedTupleExclusions } from "@/lib/warehouse-query";

/** Warehouse-only Shopee catalog view; it never calls Shopee or exposes credentials. */
export async function GET(request: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const searchParams = new URL(request.url).searchParams;
  const workspaceId = searchParams.get("workspaceId")?.trim();
  const clientId = searchParams.get("clientId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  try {
    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "viewer", operation: "view_shopee_catalog" });
  } catch (error) {
    const response = toRbacResponse(error);
    if (response) return response;
    throw error;
  }

  let scope;
  try {
    scope = await resolveClientDataScope({ workspaceId, requestedClientId: clientId, surface: "warehouse" });
  } catch (error) {
    const response = toClientContextResponse(error);
    if (response) return response;
    throw error;
  }

  const rowWhere: Record<string, unknown> = { workspaceId };
  if (scope.ownershipMode === "explicit") {
    const assignments = scope.assignments.filter((assignment) => assignment.provider === "shopee");
    rowWhere.OR = assignments.length > 0
      ? assignments.map((assignment) => ({ connectionId: assignment.connectionId, shopId: assignment.accountId }))
      : [{ id: { in: [] } }];
  } else if (scope.ownershipMode === "legacy") {
    rowWhere.connectionId = { in: scope.connectionIds };
  } else if (scope.ownershipMode === "unassigned") {
    const [exclusions, legacyConnections] = await Promise.all([
      getUnassignedTupleExclusions(workspaceId),
      prisma.connection.findMany({
        where: {
          workspaceId,
          provider: "shopee",
          type: "source",
          clientId: { not: null },
          client: { accountAssignmentsConfiguredAt: null },
        },
        select: { id: true },
      }),
    ]);
    const assignedShopIds = exclusions
      .filter((tuple) => tuple.platform === "shopee")
      .map((tuple) => tuple.accountId);
    rowWhere.NOT = [
      ...(assignedShopIds.length > 0 ? [{ shopId: { in: assignedShopIds } }] : []),
      ...(legacyConnections.length > 0 ? [{ connectionId: { in: legacyConnections.map((row) => row.id) } }] : []),
    ];
  }

  // ProviderSyncRun has a shopId, so explicit/unassigned metadata is included
  // only when it can be attributed with the same account predicate as rows.
  const runWhere = {
    ...rowWhere,
    provider: "shopee",
    ...(scope.ownershipMode === "unassigned" ? { shopId: { not: null } } : {}),
  };

  const [campaigns, products, lastRun] = await Promise.all([
    (prisma as any).shopeeCampaign.findMany({
      where: rowWhere,
      orderBy: [{ syncedAt: "desc" }, { externalCampaignId: "asc" }],
      take: 100,
    }),
    (prisma as any).shopeeProduct.findMany({
      where: rowWhere,
      orderBy: [{ syncedAt: "desc" }, { externalItemId: "asc" }],
      take: 100,
    }),
    (prisma as any).providerSyncRun.findFirst({
      where: runWhere,
      orderBy: { startedAt: "desc" },
      select: { status: true, endpoint: true, startedAt: true, rowsReceived: true, rowsWritten: true, environment: true },
    }),
  ]);
  return NextResponse.json({ campaigns, products, lastRun, attribution: "account" });
}
