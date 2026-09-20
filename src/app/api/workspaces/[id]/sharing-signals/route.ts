import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma, { prismaBase } from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { getPlanLimits } from "@/lib/plan-config";
import { aggregateLoginSignals } from "@/lib/login-telemetry";

/**
 * GET /api/workspaces/[id]/sharing-signals?days=7
 *
 * P0 seat-sharing telemetry — read-only, no enforcement.
 * Admin+ only. Returns per-member login counts + distinct hashed-device
 * counts and per-key usage counters so owners can spot shared seats.
 * Raw IPs / user-agents are never returned (only salted-hash counts).
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

    const memberIds = members.map((member) => member.userId);
    const events =
      memberIds.length === 0
        ? []
        : await prismaBase.loginEvent.findMany({
            where: { userId: { in: memberIds }, createdAt: { gte: since } },
            select: { userId: true, ipHash: true, uaHash: true },
            orderBy: { createdAt: "desc" },
            take: 5000,
          });

    const signalsByUser = new Map(
      aggregateLoginSignals(events).map((row) => [row.userId, row]),
    );

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

    const users = members.map((member) => {
      const signals = signalsByUser.get(member.userId);
      return {
        userId: member.userId,
        email: member.user.email,
        loginCount: signals?.loginCount ?? 0,
        distinctIps: signals?.distinctIps ?? 0,
        distinctUas: signals?.distinctUas ?? 0,
      };
    });

    // P3: upgrade nudge input for the console. A single seat seen from 3+
    // networks in the window is worth a human review, not an auto-block.
    const maxDistinctIps = users.reduce((max, user) => Math.max(max, user.distinctIps), 0);

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
      suggestedAction:
        maxDistinctIps >= 3
          ? {
              type: "review_sharing",
              message: `One seat signed in from ${maxDistinctIps} networks in ${windowDays} days. If a team shares this login, invite them instead — shared seats get rate-limited first when busy.`,
            }
          : null,
      note: "Telemetry + session caps active. IP/UA hashes are salted and never returned raw.",
    });
  } catch (error) {
    return toRbacResponse(error) ?? NextResponse.json({ error: "Could not load sharing signals" }, { status: 500 });
  }
}
