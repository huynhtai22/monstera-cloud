import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import {
  cutoverUnambiguousAssignmentsInTransaction,
  runSerializableAssignmentTransaction,
} from "@/lib/client-account-assignment";

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
      const result = await runSerializableAssignmentTransaction(prisma, (tx) =>
        cutoverUnambiguousAssignmentsInTransaction(
          workspaceId,
          clientId,
          tx,
          session.user.id,
        ),
      );
      return NextResponse.json(result, { status: 200 });
    }

    // Every legacy client is loaded, validated, and cut over in the same
    // serializable transaction. A conflict on a later client rolls back the
    // earlier markers, assignments, and audit events as well.
    const { legacyClients, results } = await runSerializableAssignmentTransaction(prisma, async (tx) => {
      const legacyClients = await tx.client.findMany({
        where: { workspaceId, accountAssignmentsConfiguredAt: null },
        select: { id: true, name: true },
        orderBy: { id: "asc" },
      });

      const results = [];
      for (const client of legacyClients) {
        const result = await cutoverUnambiguousAssignmentsInTransaction(
          workspaceId,
          client.id,
          tx,
          session.user.id,
        );
        results.push({
          clientId: client.id,
          clientName: client.name,
          ...result,
        });
      }
      return { legacyClients, results };
    });

    return NextResponse.json({
      workspaceId,
      totalClients: legacyClients.length,
      results,
    });
  } catch (error: unknown) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      return NextResponse.json(
        { error: "Concurrent cutover conflict; retry the operation." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to execute cutover" },
      { status: 500 },
    );
  }
}
