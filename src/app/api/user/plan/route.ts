import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { isWhitelistedProEmail } from "@/lib/plan-config";

/**
 * GET /api/user/plan
 * Returns one explicitly selected workspace's current plan from the DB.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "viewer",
      operation: "read_workspace_plan",
    });
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { id: true, plan: true, status: true, subscriptionEndsAt: true },
    });

    if (isWhitelistedProEmail(session.user.email) && workspace.plan !== "professional" && workspace.plan !== "enterprise") {
      await prisma.workspace.update({
        where: { id: workspace.id },
        data: { plan: "professional", status: "ACTIVE" },
      }).catch(() => {});
      return NextResponse.json({ plan: "professional", status: "ACTIVE", subscriptionEndsAt: workspace.subscriptionEndsAt });
    }

    return NextResponse.json({ plan: workspace.plan, status: workspace.status, subscriptionEndsAt: workspace.subscriptionEndsAt });
  } catch (error) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    throw error;
  }
}
