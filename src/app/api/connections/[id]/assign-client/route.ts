import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isMockClientId } from "@/lib/mock-console-data";

/**
 * PATCH /api/connections/[id]/assign-client
 */
export async function PATCH(req: Request, context: { params: any }) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const params = await context.params;
        const id = params.id;
        const body = await req.json();
        const { clientId, workspaceId } = body;

        if (!workspaceId) {
            return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
        }

        // Verify membership
        const membership = await prisma.workspaceMember.findUnique({
            where: {
                workspaceId_userId: {
                    workspaceId,
                    userId: session.user.id
                }
            }
        });

        if (!membership) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        if (clientId && isMockClientId(String(clientId))) {
            return NextResponse.json(
                { error: "Demo clients are for display only. Create a real client to assign connections." },
                { status: 400 }
            );
        }

        const connection = await prisma.connection.updateMany({
            where: { id, workspaceId },
            data: { clientId: clientId || null },
        });

        if (connection.count === 0) {
            return NextResponse.json({ error: 'Connection not found in workspace' }, { status: 404 });
        }

        const updated = await prisma.connection.findFirst({ where: { id, workspaceId } });

        return NextResponse.json(updated);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
