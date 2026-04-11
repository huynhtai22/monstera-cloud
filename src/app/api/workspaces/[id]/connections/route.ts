import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

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

        const connections = await prisma.connection.findMany({
            where: { 
                workspaceId,
                ...(unassignedOnly ? { clientId: null } : {})
            },
            orderBy: { createdAt: "desc" }
        });

        return NextResponse.json(connections);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
