import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { sanitizeConnectionCredentials } from "@/lib/sanitize-connection-credentials";
import { resolveSourceHealthState, SOURCE_HEALTH_STALE_AFTER_MS } from "@/lib/source-health";

/**
 * GET /api/workspaces/[id]/connections
 */
export async function GET(req: Request, context: { params: any }) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const params = await context.params;
        const workspaceId = params.id;
        const { searchParams } = new URL(req.url);
        const unassignedOnly = searchParams.get("unassigned") === "true";
        const type = searchParams.get("type");

        // Verify membership
        await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "viewer" });

        const connections = await prisma.connection.findMany({
            where: { 
                workspaceId,
                ...(unassignedOnly ? { clientId: null } : {}),
                ...(type === "source" || type === "destination" ? { type } : {}),
            },
            orderBy: { createdAt: "desc" }
        });

        const sourceConnectionIds = connections
            .filter((connection) => connection.type === "source")
            .map((connection) => connection.id);
        const dataCoverage = sourceConnectionIds.length > 0
            ? await prisma.campaignMetric.groupBy({
                by: ["connectionId"],
                where: { workspaceId, connectionId: { in: sourceConnectionIds } },
                _max: { date: true },
            })
            : [];
        const dataThroughByConnectionId = new Map(
            dataCoverage.map((coverage) => [coverage.connectionId, coverage._max.date]),
        );
        const staleBefore = new Date(Date.now() - SOURCE_HEALTH_STALE_AFTER_MS);
        return NextResponse.json(connections.map((connection) => ({
            ...connection,
            credentials: sanitizeConnectionCredentials(connection.credentials),
            healthState: connection.type === "source"
                ? resolveSourceHealthState({
                    connectionStatus: connection.status,
                    lastError: connection.lastError,
                    lastSyncAt: connection.lastSyncAt,
                    staleBefore,
                })
                : undefined,
            dataThroughDate: dataThroughByConnectionId.get(connection.id)?.toISOString() ?? null,
        })));
    } catch (error: unknown) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
    }
}
