import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * DELETE — remove a connection from the workspace (revokes Monstera's stored OAuth tokens
 * and credentials for this link). Also removes pipelines that reference this connection.
 * Users may still revoke the app in Meta / Google / TikTok account settings separately.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const rawParams = await Promise.resolve(context.params);
        const connectionId = rawParams?.id;

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

        const membership = await prisma.workspaceMember.findUnique({
            where: {
                workspaceId_userId: {
                    workspaceId: connection.workspaceId,
                    userId: session.user.id,
                },
            },
        });

        if (!membership) {
            return NextResponse.json({ error: "Unauthorized for this workspace" }, { status: 403 });
        }

        await prisma.$transaction(async (tx) => {
            await tx.pipeline.deleteMany({
                where: {
                    OR: [
                        { sourceConnectionId: connectionId },
                        { destinationConnectionId: connectionId },
                    ],
                },
            });
            await tx.campaignMetric.deleteMany({
                where: { connectionId },
            });
            await tx.connection.delete({
                where: { id: connectionId },
            });
        });

        return NextResponse.json({
            ok: true,
            message: `Disconnected ${connection.name}. You can reconnect this ${connection.type} anytime.`,
        });
    } catch (error) {
        console.error("DELETE /api/connections/[id]:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
