/**
 * DELETE /api/connections/[id]/purge — permanently delete a disconnected source
 * AND its retained historical warehouse data.
 *
 * This is the only path that deletes CampaignMetric history. It is deliberately
 * separate from Disconnect (DELETE /api/connections/[id]) and requires an
 * explicit confirmation payload: `{ "confirm": "delete" }`.
 *
 * Deletes, scoped to the connection's workspace (tenant fencing):
 *   - pipelines referencing the connection (sync logs cascade)
 *   - CampaignMetric rows belonging to the connection
 *   - the Connection record itself
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { purgeConnection } from "@/lib/connection-lifecycle";
import { logger } from "@/lib/logger";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

const CONFIRMATION_PHRASE = "delete";

export async function DELETE(
    request: Request,
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

        const body = await request.json().catch(() => ({} as Record<string, unknown>));
        if ((body as { confirm?: unknown }).confirm !== CONFIRMATION_PHRASE) {
            return NextResponse.json(
                {
                    error:
                        'This permanently deletes all retained warehouse data for this source. Retry with body { "confirm": "delete" } if that is intended.',
                    code: "CONFIRMATION_REQUIRED",
                },
                { status: 400 }
            );
        }

        const connection = await prisma.connection.findUnique({
            where: { id: connectionId },
            select: { id: true, workspaceId: true, type: true, name: true, status: true },
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
            purgeConnection(tx, { connectionId, workspaceId: connection.workspaceId })
        );

        logger.info(
            `[PURGE] Permanently deleted connection ${connectionId} and its warehouse data (workspace ${connection.workspaceId})`
        );

        return NextResponse.json({
            ok: true,
            message: `Permanently deleted ${connection.name} and its historical warehouse data.`,
        });
    } catch (error) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        logger.error("DELETE /api/connections/[id]/purge:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
