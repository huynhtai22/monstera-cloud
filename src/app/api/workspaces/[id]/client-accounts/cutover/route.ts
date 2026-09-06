import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { cutoverUnambiguousAssignments } from "@/lib/client-account-assignment";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: workspaceId } = await context.params;
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    // Explicit cutover is strictly admin/owner only
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "admin",
      operation: "cutover_client_accounts",
    });

    const body = await req.json().catch(() => ({}));
    const { clientId } = body;

    if (clientId) {
      const result = await cutoverUnambiguousAssignments(
        workspaceId,
        clientId,
        prisma,
        session.user.id,
      );
      return NextResponse.json(result, { status: 200 });
    }

    // Workspace-wide cutover for all legacy clients
    const legacyClients = await prisma.client.findMany({
      where: { workspaceId, accountAssignmentsConfiguredAt: null },
      select: { id: true, name: true },
      orderBy: { id: "asc" },
    });

    const results = [];
    for (const client of legacyClients) {
      const result = await cutoverUnambiguousAssignments(
        workspaceId,
        client.id,
        prisma,
        session.user.id,
      );
      results.push({
        clientId: client.id,
        clientName: client.name,
        ...result,
      });
    }

    return NextResponse.json({
      workspaceId,
      totalClients: legacyClients.length,
      results,
    });
  } catch (error: unknown) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to execute cutover" },
      { status: 500 },
    );
  }
}
