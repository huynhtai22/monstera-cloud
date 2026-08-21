import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { disconnectConnection } from "@/lib/connection-lifecycle";
import { sanitizeConnectionCredentials } from "@/lib/sanitize-connection-credentials";
import { logger } from "@/lib/logger";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

/**
 * GET — connection detail, related pipelines, and last 30 sync logs (for /sources/[id]).
 */
export async function GET(
    _request: Request,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: connectionId } = await context.params;
        if (!connectionId) {
            return NextResponse.json({ error: "Missing connection id" }, { status: 400 });
        }

        const connection = await prisma.connection.findUnique({
            where: { id: connectionId },
            include: {
                workspace: { select: { id: true, name: true, slug: true } },
            },
        });

        if (!connection) {
            return NextResponse.json({ error: "Connection not found" }, { status: 404 });
        }

        await requireWorkspaceAccess({ userId: session.user.id, workspaceId: connection.workspaceId, minimumRole: "viewer" });

        const pipelines = await prisma.pipeline.findMany({
            where: {
                OR: [{ sourceConnectionId: connectionId }, { destinationConnectionId: connectionId }],
            },
            include: {
                sourceConnection: { select: { id: true, name: true, provider: true, type: true } },
                destinationConnection: { select: { id: true, name: true, provider: true, type: true } },
            },
            orderBy: { updatedAt: "desc" },
        });

        const pipelineIds = pipelines.map((p) => p.id);
        const recentLogs =
            pipelineIds.length === 0
                ? []
                : await prisma.syncLog.findMany({
                      where: { pipelineId: { in: pipelineIds } },
                      orderBy: { createdAt: "desc" },
                      take: 30,
                      include: {
                          pipeline: { select: { id: true, name: true } },
                      },
                  });

        const safeConnection = {
            ...connection,
            credentials: sanitizeConnectionCredentials(connection.credentials),
        };

        return NextResponse.json({
            connection: safeConnection,
            pipelines,
            recentLogs,
        });
    } catch (error) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        logger.error("GET /api/connections/[id]:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

/**
 * DELETE — disconnect a source without deleting historical warehouse data.
 *
 * Disconnect semantics (see docs/KNOWN_LIMITATIONS.md §15):
 *   - stops future syncs (status = "disconnected"; sync routes and cron filters gate on it)
 *   - revokes Monstera's stored OAuth tokens / credentials for this link
 *   - pauses pipelines referencing this connection (rows + sync logs retained)
 *   - RETAINS all CampaignMetric history for the connection
 *
 * Permanent deletion of retained warehouse data is a separate explicit operation:
 * DELETE /api/connections/[id]/purge.
 * Users may still revoke the app in Meta / Google / TikTok account settings separately.
 */
export async function DELETE(
    _request: Request,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: connectionId } = await context.params;

        if (!connectionId) {
            return NextResponse.json({ error: "Missing connection id" }, { status: 400 });
        }

        const connection = await prisma.connection.findUnique({
            where: { id: connectionId },
            select: { id: true, workspaceId: true, type: true, name: true },
        });

        if (!connection) {
            return NextResponse.json({ error: "Connection not found" }, { status: 404 });
        }

        await requireWorkspaceAccess({
            userId: session.user.id,
            workspaceId: connection.workspaceId,
            minimumRole: "admin",
            operation: "delete_connection",
        });

        await prisma.$transaction((tx) =>
            disconnectConnection(tx, { connectionId, workspaceId: connection.workspaceId })
        );

        return NextResponse.json({
            ok: true,
            message: `Disconnected ${connection.name}. Historical warehouse data is retained; permanently delete it from the source settings if needed.`,
        });
    } catch (error) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        logger.error("DELETE /api/connections/[id]:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
