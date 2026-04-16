import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * GET /api/sync-logs?workspaceId=...&status=success|error
 * Returns latest sync logs for pipelines in a workspace the user belongs to.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const status = searchParams.get("status");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const where: any = {
    pipeline: {
      workspaceId,
      workspace: {
        members: { some: { userId: session.user.id } },
      },
    },
  };
  if (status === "success" || status === "error") {
    where.status = status;
  }

  const logs = await prisma.syncLog.findMany({
    where,
    include: {
      pipeline: { select: { id: true, name: true, sourceConnectionId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ logs });
}

