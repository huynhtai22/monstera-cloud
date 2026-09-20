import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { getPlanLimits } from "@/lib/plan-config";

/**
 * GET /api/workspaces/[id]/sharing-signals?days=7
 *
 * P0 seat-sharing telemetry — read-only, no enforcement.
 * Admin+ only. Returns workspace-scoped membership and key signals.
 * LoginEvent is deliberately user-scoped rather than workspace-scoped, so a
 * workspace admin must never receive a member's global login history (which
 * could include activity in unrelated tenants). Per-member device activity is
 * reported as unavailable until heartbeat evidence is workspace-attributed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id: workspaceId } = await params;

    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "admin",
      operation: "list_sharing_signals",
    });

    const { searchParams } = new URL(request.url);
    const rawDays = Number(searchParams.get("days") ?? "7");
    const windowDays = Number.isFinite(rawDays) ? Math.min(30, Math.max(1, Math.floor(rawDays))) : 7;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const [workspace, members, pendingInvitations] = await Promise.all([
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, plan: true },
      }),
      prisma.workspaceMember.findMany({
        where: { workspaceId },
        select: { userId: true, user: { select: { id: true, email: true } } },
      }),
      prisma.workspaceInvitation.count({
        where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);

    if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    const limits = getPlanLimits(workspace.plan);

    const keys = await prisma.apiKey.findMany({
      where: { workspaceId, revokedAt: null },
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastUsedAt: true,
        useCount: true,
        lastUsedIpHash: true,
        allowedIpHash: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const users = members.map((member) => ({
      userId: member.userId,
      email: member.user.email,
      loginActivity: {
        status: "unavailable" as const,
        code: "WORKSPACE_SCOPED_LOGIN_EVIDENCE_UNAVAILABLE",
      },
    }));

    return NextResponse.json({
      workspaceId,
      plan: workspace.plan,
      seats: {
        used: members.length,
        pending: pendingInvitations,
        maxSeats: limits.maxSeats,
      },
      windowDays,
      since: since.toISOString(),
      users,
      apiKeys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        useCount: key.useCount,
        seenIp: key.lastUsedIpHash != null,
        ipPinned: key.allowedIpHash != null,
      })),
      suggestedAction: null,
      note: "Session caps are active. Global user login telemetry is never exposed to workspace administrators; workspace-scoped device evidence requires a future attributed heartbeat model.",
    });
  } catch (error) {
    return toRbacResponse(error) ?? NextResponse.json({ error: "Could not load sharing signals" }, { status: 500 });
  }
}
