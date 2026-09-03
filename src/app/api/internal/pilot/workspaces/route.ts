import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { generateInvitationToken, normalizeEmail, normalizeWorkspaceSlug } from "@/lib/invitation-security";
import type { WorkspaceRole } from "@prisma/client";
import { resolveSourceHealthState } from "@/lib/source-health";
import {
  DASHBOARD_REVIEWED_ACTION,
  derivePilotActivation,
  pilotActivationSortRank,
  trialDaysRemaining,
} from "@/lib/pilot-activation";
import { withSystemScope } from "@/lib/tenant-guard";

const ALLOWED_PROVIDERS = new Set(["meta_ads", "google_ads", "tiktok_business", "shopee"]);

async function requireOperator(userId: string) {
  return prisma.user.findFirst({ where: { id: userId, platformRole: "OPERATOR" }, select: { id: true } });
}

export async function GET(request: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await requireOperator(session.user.id))) {
    return NextResponse.json({ error: "Operator access required" }, { status: 403 });
  }

  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(50, Math.max(1, Math.floor(requestedLimit)))
    : 50;
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
  const staleBefore = new Date(Date.now() - 26 * 60 * 60 * 1000);

  const workspaces = await withSystemScope(() => prisma.workspace.findMany({
    where: { status: "PILOT" },
    select: {
      id: true,
      name: true,
      slug: true,
      ownerId: true,
      status: true,
      plan: true,
      subscriptionEndsAt: true,
      createdAt: true,
      updatedAt: true,
      connections: {
        where: { type: "source" },
        select: {
          id: true,
          name: true,
          status: true,
          lastError: true,
          lastSyncAt: true,
          lastDataThrough: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      warehouseImportJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          status: true,
          approximateRows: true,
          createdAt: true,
          updatedAt: true,
          finishedAt: true,
        },
      },
      auditEvents: {
        where: { action: DASHBOARD_REVIEWED_ACTION },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { createdAt: true },
      },
      paymentOrders: {
        where: { status: "PAID" },
        orderBy: { fulfilledAt: "desc" },
        take: 1,
        select: { fulfilledAt: true, paidAt: true },
      },
    },
  }));

  const workspaceIds = workspaces.map((workspace) => workspace.id);
  const [owners, recentMetricGroups] = await withSystemScope(() => Promise.all([
    workspaceIds.length
      ? prisma.user.findMany({
          where: { id: { in: workspaces.map((workspace) => workspace.ownerId) } },
          select: { id: true, email: true },
        })
      : [],
    workspaceIds.length
      ? prisma.campaignMetric.groupBy({
          where: { workspaceId: { in: workspaceIds }, date: { gte: sevenDaysAgo } },
          by: ["workspaceId"],
          _count: { _all: true },
          _max: { date: true, pulledAt: true },
        })
      : [],
  ]));
  const ownerEmailById = new Map(owners.map((owner) => [owner.id, owner.email]));
  const metricsByWorkspaceId = new Map(
    recentMetricGroups.map((group) => [group.workspaceId, group]),
  );

  const rows = workspaces.map((workspace) => {
    const metricGroup = metricsByWorkspaceId.get(workspace.id);
    const sourceStates = workspace.connections.map((connection) => ({
      id: connection.id,
      state: resolveSourceHealthState({
        connectionStatus: connection.status,
        lastError: connection.lastError,
        lastSyncAt: connection.lastSyncAt,
        isSyncing: false,
        staleBefore,
      }),
      lastSyncAt: connection.lastSyncAt,
    }));
    const latestImport = workspace.warehouseImportJobs[0] ?? null;
    const activation = derivePilotActivation({
      workspaceStatus: workspace.status,
      subscriptionEndsAt: workspace.subscriptionEndsAt,
      sources: sourceStates,
      rows7d: metricGroup?._count._all ?? 0,
      dataThroughDate: metricGroup?._max.date ?? null,
      dashboardReviewedAt: workspace.auditEvents[0]?.createdAt ?? null,
      latestImport,
    });
    const blockingSource = activation.blockers.length > 0 && activation.sourceConnectionId
      ? workspace.connections.find((connection) => connection.id === activation.sourceConnectionId)
      : null;
    const lastProgressAt = [
      workspace.createdAt,
      workspace.updatedAt,
      metricGroup?._max.pulledAt,
      latestImport?.finishedAt,
      latestImport?.updatedAt,
      workspace.auditEvents[0]?.createdAt,
      workspace.paymentOrders[0]?.fulfilledAt,
      workspace.paymentOrders[0]?.paidAt,
      ...workspace.connections.flatMap((connection) => [connection.createdAt, connection.updatedAt, connection.lastSyncAt]),
    ].filter((value): value is Date => value instanceof Date)
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? workspace.createdAt;

    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      ownerEmail: ownerEmailById.get(workspace.ownerId) ?? null,
      status: workspace.status,
      plan: workspace.plan,
      createdAt: workspace.createdAt.toISOString(),
      trialEndsAt: activation.trialEndsAt,
      daysRemaining: trialDaysRemaining(activation.trialEndsAt),
      milestone: activation.currentStep,
      recentRows: activation.rows7d,
      dataThroughDate: activation.dataThroughDate,
      blockingSource: blockingSource
        ? { id: blockingSource.id, name: blockingSource.name, reason: activation.blockers[0] ?? null }
        : null,
      lastProgressAt: lastProgressAt.toISOString(),
      activation,
    };
  });

  rows.sort((left, right) => {
    const rankDelta = pilotActivationSortRank(left.activation) - pilotActivationSortRank(right.activation);
    if (rankDelta !== 0) return rankDelta;
    const leftExpiry = left.trialEndsAt ? new Date(left.trialEndsAt).getTime() : Number.MAX_SAFE_INTEGER;
    const rightExpiry = right.trialEndsAt ? new Date(right.trialEndsAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
    return new Date(right.lastProgressAt).getTime() - new Date(left.lastProgressAt).getTime();
  });

  return NextResponse.json({ workspaces: rows.slice(0, limit) });
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await requireOperator(session.user.id))) {
    return NextResponse.json({ error: "Operator access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = normalizeEmail(String(body.email || ""));
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const agencyName = typeof body.agencyName === "string" ? body.agencyName.trim() : "";
  const agencySlug = normalizeWorkspaceSlug(String(body.agencySlug || agencyName));
  const enabledProviders: string[] = Array.isArray(body.enabledProviders)
    ? Array.from(new Set<string>(body.enabledProviders.filter((value: unknown): value is string => typeof value === "string" && ALLOWED_PROVIDERS.has(value))))
    : ["meta_ads", "google_ads", "tiktok_business", "shopee"];
  const role: WorkspaceRole = body.role === "viewer" || body.role === "member" || body.role === "admin" ? body.role : "member";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid owner or teammate email is required" }, { status: 400 });
  }

  let invitationData;
  if (workspaceId) {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
    if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    invitationData = { workspaceId, role, enabledProviders: [] as string[] };
  } else {
    if (!agencyName || agencySlug.length < 3) {
      return NextResponse.json({ error: "Agency name and a valid slug are required" }, { status: 400 });
    }
    const [workspace, pending] = await Promise.all([
      prisma.workspace.findUnique({ where: { slug: agencySlug }, select: { id: true } }),
      prisma.workspaceInvitation.findFirst({
        where: { agencySlug, acceptedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      }),
    ]);
    if (workspace || pending) return NextResponse.json({ error: "Agency slug is already reserved" }, { status: 409 });
    invitationData = { agencyName, agencySlug, plan: "pilot", role: "owner" as const, enabledProviders };
  }

  const generated = generateInvitationToken();
  const invitation = await prisma.workspaceInvitation.create({
    data: {
      ...invitationData,
      tokenHash: generated.tokenHash,
      email,
      invitedByUserId: session.user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    select: { id: true, email: true, expiresAt: true },
  });
  const origin = new URL(request.url).origin;
  return NextResponse.json(
    { ...invitation, invitationUrl: `${origin}/invite/${generated.token}` },
    { status: 201 },
  );
}
