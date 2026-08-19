import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { getWorkspaceDashboardOverview } from "@/lib/dashboard-overview";

/**
 * GET /api/dashboard/summary?workspaceId=...
 *
 * Returns a unified operational dashboard payload:
 * - overview: comprehensive real workspace state (sources, accounts, warehouse, syncs, destinations, alerts)
 * - pipelines & syncLogs: for legacy/activity compatibility
 */
export async function GET(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
        return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    try {
        await requireWorkspaceAccess({
            userId: session.user.id,
            workspaceId,
            minimumRole: "viewer",
            operation: "view_dashboard_summary",
        });
    } catch (error) {
        return toRbacResponse(error) ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        const overview = await getWorkspaceDashboardOverview(workspaceId);

        if (!overview) {
            return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
        }

        // Return the clean overview DTO directly
        return NextResponse.json({
            ...overview,
            overview, // for nested access if preferred
        });
    } catch (error) {
        logger.error("[dashboard/summary] error:", error);
        return NextResponse.json(
            { error: "Failed to fetch dashboard summary" },
            { status: 500 }
        );
    }
}
