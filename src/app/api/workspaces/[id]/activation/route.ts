import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getWorkspaceDashboardOverview } from "@/lib/dashboard-overview";
import {
  PilotActivationConflictError,
  recordDashboardReviewMilestone,
} from "@/lib/pilot-activation-store";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: workspaceId } = await params;
  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "viewer",
      operation: "record_dashboard_reviewed",
    });
  } catch (error) {
    return toRbacResponse(error) ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (
    !body ||
    body.action !== "dashboard_reviewed" ||
    Object.keys(body).length !== 1
  ) {
    return NextResponse.json(
      { error: "Only the dashboard_reviewed activation action is accepted" },
      { status: 400 },
    );
  }

  try {
    await recordDashboardReviewMilestone({ workspaceId, actorUserId: session.user.id });
  } catch (error) {
    if (error instanceof PilotActivationConflictError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }

  const refreshed = await getWorkspaceDashboardOverview(workspaceId);
  if (!refreshed) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  return NextResponse.json({ pilotActivation: refreshed.pilotActivation });
}
