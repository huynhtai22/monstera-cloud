import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { isMockClientId } from "@/lib/mock-console-data";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

/**
 * GET /api/clients
 * List all clients for a workspace.
 */
export async function GET(req: Request) {
    try {
        const session = await getAuthSession();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const workspaceId = searchParams.get("workspaceId");

        if (!workspaceId) {
            return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
        }

        // Verify membership
        await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "viewer" });

        const clients = await prisma.client.findMany({
            where: { workspaceId },
            orderBy: { createdAt: "desc" },
            include: {
                _count: {
                    select: { pipelines: true, connections: true }
                },
                connections: {
                    where: { workspaceId, type: "source" },
                    select: {
                        id: true,
                        name: true,
                        provider: true,
                        status: true,
                        lastSyncAt: true,
                        lastError: true,
                    },
                },
            }
        });

        return NextResponse.json(clients);
    } catch (error: unknown) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
    }
}

/**
 * POST /api/clients
 * Create a new client.
 */
export async function POST(req: Request) {
    try {
        const session = await getAuthSession();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { workspaceId, name, description, logoUrl } = body;

        if (!workspaceId || !name) {
            return NextResponse.json({ error: "workspaceId and name are required" }, { status: 400 });
        }

        // Verify membership
        await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "member", operation: "create_client" });

        const client = await prisma.client.create({
            data: {
                workspaceId,
                name,
                description,
                logoUrl
            }
        });

        return NextResponse.json(client, { status: 201 });
    } catch (error: unknown) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
    }
}

/**
 * DELETE /api/clients
 * Remove a client.
 */
export async function DELETE(req: Request) {
    try {
        const session = await getAuthSession();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        const workspaceId = searchParams.get("workspaceId");

        if (!id || !workspaceId) {
            return NextResponse.json({ error: "id and workspaceId are required" }, { status: 400 });
        }

        // Verify membership
        await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "admin", operation: "delete_client" });

        if (isMockClientId(id)) {
            return NextResponse.json(
                { error: "Demo clients cannot be deleted — turn off demo mode in Settings." },
                { status: 400 }
            );
        }

        const deleted = await prisma.client.deleteMany({ where: { id, workspaceId } });
        if (deleted.count !== 1) return NextResponse.json({ error: "Client not found" }, { status: 404 });

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
    }
}

/**
 * PATCH /api/clients
 * Rename or update a client (body: { id, workspaceId, name?, description? }).
 */
export async function PATCH(req: Request) {
    try {
        const session = await getAuthSession();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { id, workspaceId, name, description } = body;

        if (!id || !workspaceId) {
            return NextResponse.json(
                { error: "id and workspaceId are required" },
                { status: 400 }
            );
        }

        await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "member", operation: "update_client" });

        if (isMockClientId(id)) {
            return NextResponse.json(
                { error: "Demo clients cannot be edited — turn off demo mode in Settings." },
                { status: 400 }
            );
        }

        const data: { name?: string; description?: string | null } = {};
        if (typeof name === "string" && name.trim()) {
            data.name = name.trim();
        }
        if (description !== undefined) {
            data.description =
                description === null || description === ""
                    ? null
                    : String(description);
        }

        if (Object.keys(data).length === 0) {
            return NextResponse.json(
                { error: "No fields to update" },
                { status: 400 }
            );
        }

        const existing = await prisma.client.findFirst({ where: { id, workspaceId }, select: { id: true } });
        if (!existing) return NextResponse.json({ error: "Client not found" }, { status: 404 });
        const updated = await prisma.client.update({
            where: { id: existing.id },
            data,
        });

        return NextResponse.json(updated);
    } catch (error: unknown) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
    }
}
