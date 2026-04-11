import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

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

        const connection = await prisma.connection.update({
            where: { id },
            data: { clientId: clientId || null }
        });

        return NextResponse.json(connection);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
