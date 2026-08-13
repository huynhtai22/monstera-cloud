import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

/** Tenant-safe workspace index. Detailed resources have their own scoped endpoints. */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: session.user.id },
      orderBy: { workspace: { createdAt: "asc" } },
      select: {
        role: true,
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            plan: true,
            status: true,
            createdAt: true,
            providerAccess: {
              where: { enabled: true },
              select: { provider: true },
              orderBy: { provider: "asc" },
            },
            _count: {
              select: { members: true, clients: true, connections: true, pipelines: true, apiKeys: true },
            },
            connections: {
              where: { type: "source" },
              select: { status: true, lastSyncAt: true, lastError: true },
              orderBy: { lastSyncAt: "desc" },
            },
            pipelines: {
              select: {
                syncJobs: {
                  orderBy: { createdAt: "desc" },
                  take: 1,
                  select: { status: true, finishedAt: true },
                },
              },
            },
          },
        },
      },
    });

    return NextResponse.json(memberships.map(({ role, workspace }) => {
      const latestSyncAt = workspace.connections.find((connection) => connection.lastSyncAt)?.lastSyncAt ?? null;
      const failing = workspace.connections.filter((connection) => connection.status === "error" || connection.lastError);
      const latestJobs = workspace.pipelines.flatMap((pipeline) => pipeline.syncJobs).sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0));
      const latestJob = latestJobs[0] ?? null;
      return {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        role,
        plan: workspace.plan,
        status: workspace.status,
        createdAt: workspace.createdAt,
        enabledProviders: workspace.providerAccess.map((item) => item.provider),
        counts: {
          members: workspace._count.members,
          clients: workspace._count.clients,
          connections: workspace._count.connections,
          pipelines: workspace._count.pipelines,
          apiKeys: workspace._count.apiKeys,
        },
        health: {
          status: failing.length > 0 ? "error" : latestSyncAt ? "healthy" : "not_synced",
          latestSyncAt,
          latestJobStatus: latestJob?.status ?? null,
          latestJobFinishedAt: latestJob?.finishedAt ?? null,
          failingConnections: failing.length,
        },
      };
    }));
  } catch (error) {
    logger.error("Error fetching workspaces", error);
    return NextResponse.json({ error: "Failed to fetch workspaces" }, { status: 500 });
  }
}
