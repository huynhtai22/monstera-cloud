import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getPlanLimits } from "@/lib/plan-config";
import { assertCanCreateWorkspace, toPlanLimitResponse } from "@/lib/plan-entitlements";

/** Tenant-safe workspace index. Detailed resources have their own scoped endpoints. */
export async function GET() {
  try {
    const session = await getAuthSession();
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
            subscriptionEndsAt: true,
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
              select: { id: true, name: true, provider: true, status: true, lastSyncAt: true, lastError: true },
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
        subscriptionEndsAt: workspace.subscriptionEndsAt,
        createdAt: workspace.createdAt,
        enabledProviders: workspace.providerAccess.map((item) => item.provider),
        counts: {
          members: workspace._count.members,
          clients: workspace._count.clients,
          connections: workspace._count.connections,
          sourceConnections: workspace.connections.length,
          pipelines: workspace._count.pipelines,
          apiKeys: workspace._count.apiKeys,
        },
        entitlements: (() => {
          const limits = getPlanLimits(workspace.plan);
          return {
            displayName: limits.displayName,
            maxConnections: limits.maxConnections,
            maxSourceProviders: limits.maxSourceProviders,
            maxSeats: limits.maxSeats,
            maxWorkspaces: limits.maxWorkspaces,
            allowLooker: limits.allowLooker,
            allowApiKeys: limits.allowApiKeys,
            allowCsvExport: limits.allowCsvExport,
            scheduledRefresh: limits.scheduledRefresh,
            maxHistoryDays: limits.maxHistoryDays ?? null,
            syncLabel: limits.syncLabel,
          };
        })(),
        sources: workspace.connections.map((c) => ({
          id: c.id,
          name: c.name,
          provider: c.provider,
          status: c.status,
          lastSyncAt: c.lastSyncAt,
          hasError: Boolean(c.status === "error" || c.lastError),
        })),
        health: {
          status: failing.length > 0 ? "error" : latestSyncAt ? "healthy" : "not_synced",
          latestSyncAt,
          latestJobStatus: latestJob?.status ?? null,
          latestJobFinishedAt: latestJob?.finishedAt ?? null,
          failingConnections: failing.length,
          failingDetails: failing.map((c) => ({
            id: c.id,
            name: c.name,
            provider: c.provider,
            errorMsg: c.lastError,
          })),
        },
      };
    }));
  } catch (error) {
    logger.error("Error fetching workspaces", error);
    return NextResponse.json({ error: "Failed to fetch workspaces" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const name = String(body?.name || "").trim() || "Workspace";
    const { plan } = await assertCanCreateWorkspace(session.user.id);
    const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "workspace";
    const slug = `${slugBase}-${session.user.id.slice(0, 6)}-${Date.now().toString(36)}`;

    const workspace = await prisma.workspace.create({
      data: {
        name,
        slug,
        ownerId: session.user.id,
        plan,
        status: plan === "free" ? "PILOT" : "ACTIVE",
        members: { create: { userId: session.user.id, role: "owner" } },
        providerAccess: {
          create: [
            { provider: "meta_ads", enabled: true },
            { provider: "google_ads", enabled: true },
            { provider: "tiktok_business", enabled: true },
            { provider: "shopee", enabled: true },
          ],
        },
      },
      select: { id: true, name: true, slug: true, plan: true, status: true },
    });

    return NextResponse.json(workspace, { status: 201 });
  } catch (error) {
    const planLimit = toPlanLimitResponse(error);
    if (planLimit) return planLimit;
    logger.error("Error creating workspace", error);
    return NextResponse.json({ error: "Failed to create workspace" }, { status: 500 });
  }
}
