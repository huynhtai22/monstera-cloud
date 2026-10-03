import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import {
  resolveClientDataScope,
  toClientContextResponse,
} from "@/lib/client-context-server";

/**
 * GET /api/sync-logs?workspaceId=...&status=success|error
 * Returns latest sync logs for pipelines in a workspace the user belongs to.
 */
export async function GET(req: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const status = searchParams.get("status");
  const clientId = searchParams.get("clientId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "viewer",
      operation: "list_sync_logs",
    });
  } catch (error) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    throw error;
  }

  let scope;
  try {
    scope = await resolveClientDataScope({
      workspaceId,
      requestedClientId: clientId,
      surface: "reports",
    });
  } catch (error) {
    const clientCtx = toClientContextResponse(error);
    if (clientCtx) return clientCtx;
    throw error;
  }

  // SyncLog has no provider-account identity. Once a client has cut over to
  // account assignments, a connection/root alone is insufficient evidence on
  // shared roots, so explicit scope reports this evidence as unavailable.
  if (scope.ownershipMode === "explicit") {
    return NextResponse.json({ logs: [], attribution: "unavailable" });
  }

  const scopedClientId = scope.resolution.status === "resolved" ? scope.resolution.client.id : undefined;

  const where: any = {
    pipeline: {
      workspaceId,
      workspace: {
        members: { some: { userId: session.user.id } },
      },
      ...(scopedClientId && scope.ownershipMode === "legacy"
        ? {
            OR: [
              { clientId: scopedClientId },
              ...(scope.connectionIds.length > 0
                ? [{ sourceConnectionId: { in: scope.connectionIds } }]
                : []),
            ],
          }
        : {}),
    },
  };
  if (status === "success" || status === "error") {
    where.status = status;
  }

  const logs = await prisma.syncLog.findMany({
    where,
    include: {
      pipeline: { select: { id: true, name: true, sourceConnectionId: true, clientId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ logs, attribution: "available" });
}
