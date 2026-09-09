import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import {
  assertQueryableClientContext,
  resolveClientContext,
  sourceConnectionIdsForClient,
  toClientContextResponse,
  warehouseClientId,
} from "@/lib/client-context-server";
import { sanitizeConnectionCredentials } from "@/lib/sanitize-connection-credentials";
import { resolveSourceHealthState, SOURCE_HEALTH_STALE_AFTER_MS } from "@/lib/source-health";
import { pickDataThroughDate } from "@/lib/connection-data-through";

/**
 * GET /api/workspaces/[id]/connections
 */
export async function GET(req: Request, context: { params: any }) {
    try {
        const session = await getAuthSession();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const params = await context.params;
        const workspaceId = params.id;
        const { searchParams } = new URL(req.url);
        const unassignedOnly = searchParams.get("unassigned") === "true";
        const type = searchParams.get("type");
        const clientId = searchParams.get("clientId");

        // Verify membership
        await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "viewer" });

        const resolution = await resolveClientContext({
            workspaceId,
            requestedClientId: clientId,
            surface: "sources",
        });
        assertQueryableClientContext(resolution);
        const scopedClientId = warehouseClientId(resolution);
        const assignedConnectionIds = scopedClientId
            ? await sourceConnectionIdsForClient(workspaceId, scopedClientId)
            : null;

        const connections = await prisma.connection.findMany({
            where: { 
                workspaceId,
                ...(unassignedOnly ? { clientId: null } : {}),
                ...(assignedConnectionIds ? { id: { in: assignedConnectionIds } } : {}),
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
            dataThroughDate: pickDataThroughDate(
                connection.lastDataThrough,
                dataThroughByConnectionId.get(connection.id),
            )?.toISOString() ?? null,
        })));
    } catch (error: unknown) {
        const clientCtx = toClientContextResponse(error);
        if (clientCtx) return clientCtx;
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
    }
}
