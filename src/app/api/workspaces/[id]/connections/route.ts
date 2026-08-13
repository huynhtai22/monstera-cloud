import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { sanitizeConnectionCredentials } from "@/lib/sanitize-connection-credentials";

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

        return NextResponse.json(connections.map((connection) => ({
            ...connection,
            credentials: sanitizeConnectionCredentials(connection.credentials),
        })));
    } catch (error: unknown) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
    }
}
