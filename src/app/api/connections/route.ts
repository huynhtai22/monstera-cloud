import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { upsertSourceConnection } from "@/lib/connection-upsert";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { isPilotMode } from "@/lib/pilot-mode";

export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (isPilotMode()) {
            return NextResponse.json(
                { error: "Connections must be created through an enabled OAuth source during the pilot" },
                { status: 410 },
            );
        }

        const body = await request.json();
        const { workspaceId, clientId, name, type, provider, credentials, remoteAccountId: bodyRemoteAccountId } = body;

        if (!workspaceId || !name || !type || !provider) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Verify the user has access to this workspace
        await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "member", operation: "create_connection" });
        if (type !== "source" && type !== "destination") {
            return NextResponse.json({ error: "Invalid connection type" }, { status: 400 });
        }
        const access = type === "source"
            ? await prisma.workspaceProviderAccess.findUnique({
                where: { workspaceId_provider: { workspaceId, provider } },
                select: { enabled: true },
            })
            : { enabled: provider === "google_sheets" };
        if (!access?.enabled) return NextResponse.json({ error: "Provider is not enabled for this workspace" }, { status: 403 });
        if (clientId) {
            const client = await prisma.client.findFirst({ where: { id: clientId, workspaceId }, select: { id: true } });
            if (!client) return NextResponse.json({ error: "Client not found in workspace" }, { status: 400 });
        }

        // Upsert connection by identity triple (workspaceId + provider + remoteAccountId)
        const remoteAccountId = bodyRemoteAccountId ||
            (name ? name.replace(/\s+/g, "_").toLowerCase() : provider);

        const connection = await upsertSourceConnection({
            workspaceId,
            provider,
            remoteAccountId,
            name,
            type,
            credentials: typeof credentials === "string"
                ? JSON.parse(credentials || "{}")
                : (credentials || {}),
            status: body.status || "connected",
            clientId: clientId || undefined,
        });

        return NextResponse.json(connection, { status: 201 });
    } catch (error) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        logger.error("Error creating connection:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
