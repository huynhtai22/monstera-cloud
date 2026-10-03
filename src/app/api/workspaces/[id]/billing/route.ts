import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { getPlanLimits } from "@/lib/plan-config";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: workspaceId } = await params;
    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace ID is required" }, { status: 400 });
    }

    try {
      await requireWorkspaceAccess({
        userId: session.user.id,
        workspaceId,
        minimumRole: "viewer",
        operation: "view_workspace_billing",
      });
    } catch (rbacErr) {
      const resp = toRbacResponse(rbacErr);
      if (resp) return resp;
      throw rbacErr;
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
        plan: true,
        status: true,
        subscriptionEndsAt: true,
        subscriptionProvider: true,
        _count: {
          select: {
            connections: { where: { type: "source" } },
            members: true,
            pipelines: true,
          },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const orders = await prisma.paymentOrder.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        orderCode: true,
        plan: true,
        billingCycle: true,
        amount: true,
        currency: true,
        status: true,
        checkoutUrl: true,
        createdAt: true,
        paidAt: true,
        expiresAt: true,
      },
    });

    const limits = getPlanLimits(workspace.plan);

    return NextResponse.json({
      workspaceId,
      plan: workspace.plan,
      status: workspace.status,
      subscriptionEndsAt: workspace.subscriptionEndsAt,
      subscriptionProvider: workspace.subscriptionProvider,
      limits,
      usage: {
        connectionsCount: workspace._count.connections,
        membersCount: workspace._count.members,
        pipelinesCount: workspace._count.pipelines,
      },
      orders: orders.map((o) => ({
        ...o,
        orderCode: Number(o.orderCode),
      })),
    });
  } catch (err) {
    logger.error("[WORKSPACE_BILLING_GET]", err);
    return NextResponse.json({ error: "Failed to fetch workspace billing details" }, { status: 500 });
  }
}
