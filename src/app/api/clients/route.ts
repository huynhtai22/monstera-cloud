import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * GET /api/clients
 * List all clients for a workspace.
 */
export async function GET(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const workspaceId = searchParams.get("workspaceId");

        if (!workspaceId) {
            return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
        }

        // Verify membership
        const membership = await (prisma.workspaceMember as any).findUnique({
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

        const clients = await prisma.client.findMany({
            where: { workspaceId },
            orderBy: { createdAt: "desc" },
            include: {
                _count: {
                    select: { pipelines: true, connections: true }
                }
            }
        });

        return NextResponse.json(clients);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * POST /api/clients
 * Create a new client.
 */
export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { workspaceId, name, description, logoUrl } = body;

        if (!workspaceId || !name) {
            return NextResponse.json({ error: "workspaceId and name are required" }, { status: 400 });
        }

        // Verify membership
        const membership = await (prisma.workspaceMember as any).findUnique({
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

        const client = await prisma.client.create({
            data: {
                workspaceId,
                name,
                description,
                logoUrl
            }
        });

        return NextResponse.json(client, { status: 201 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * DELETE /api/clients
 * Remove a client.
 */
export async function DELETE(req: Request) {
    try {
        const session = await getServerSession(authOptions);
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
        const membership = await (prisma.workspaceMember as any).findUnique({
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

        await prisma.client.delete({
            where: { id }
        });

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
