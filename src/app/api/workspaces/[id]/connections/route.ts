import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import {
  resolveClientDataScope,
  toClientContextResponse,
} from "@/lib/client-context-server";
import {
  sanitizeConnectionCredentials,
  sanitizeConnectionCredentialsForAccounts,
} from "@/lib/sanitize-connection-credentials";
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

        const scope = await resolveClientDataScope({
            workspaceId,
            requestedClientId: clientId,
            surface: "sources",
        });
        const assignedConnectionIds = scope.resolution.status === "resolved" ? scope.connectionIds : null;
        const assignedAccountsByConnection = new Map<string, string[]>();
        for (const assignment of scope.assignments) {
            const ids = assignedAccountsByConnection.get(assignment.connectionId) ?? [];
            ids.push(assignment.accountId);
            assignedAccountsByConnection.set(assignment.connectionId, ids);
        }

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
                where: {
                    workspaceId,
                    ...(scope.ownershipMode === "explicit"
                        ? {
                            OR: scope.assignments.length > 0
                                ? scope.assignments.map((assignment) => ({
                                    connectionId: assignment.connectionId,
                                    platform: assignment.provider,
                                    accountId: assignment.accountId,
                                }))
                                : [{ id: { in: [] } }],
                        }
                        : { connectionId: { in: sourceConnectionIds } }),
                },
                _max: { date: true },
            })
            : [];
        const dataThroughByConnectionId = new Map(
            dataCoverage.map((coverage) => [coverage.connectionId, coverage._max.date]),
        );
        const staleBefore = new Date(Date.now() - SOURCE_HEALTH_STALE_AFTER_MS);
        return NextResponse.json(connections.map((connection) => ({
            ...connection,
            credentials: scope.ownershipMode === "explicit"
                ? sanitizeConnectionCredentialsForAccounts(
                    connection.credentials,
                    connection.provider,
                    assignedAccountsByConnection.get(connection.id) ?? [],
                )
                : sanitizeConnectionCredentials(connection.credentials),
            assignedAccounts: scope.ownershipMode === "explicit"
                ? (scope.assignments
                    .filter((assignment) => assignment.connectionId === connection.id)
                    .map(({ provider, accountId }) => ({ provider, accountId })))
                : undefined,
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
