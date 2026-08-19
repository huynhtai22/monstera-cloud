import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { mapSyncLogToRun, mapWarehouseJobToRun, type RunRecord } from "@/lib/ingestion/runs";

/**
 * GET /api/runs?workspaceId=&connectionId=
 * Unified midnight-debugging feed: warehouse import jobs + pipeline sync logs.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const connectionId = searchParams.get("connectionId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "viewer",
      operation: "list_runs",
    });
  } catch (error) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    throw error;
  }

  const [jobs, logs] = await Promise.all([
    prisma.warehouseImportJob.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.syncLog.findMany({
      where: {
        pipeline: {
          workspaceId,
          ...(connectionId ? { sourceConnectionId: connectionId } : {}),
        },
      },
      include: {
        pipeline: {
          select: { id: true, name: true, sourceConnectionId: true, workspaceId: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const runs: RunRecord[] = [
    ...jobs.map((job) => mapWarehouseJobToRun(job)),
    ...logs.map((log) => mapSyncLogToRun(log)),
  ]
    .filter((run) => !connectionId || run.connectionId === connectionId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 25);

  return NextResponse.json({ runs });
}
