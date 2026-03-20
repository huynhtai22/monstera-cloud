import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import crypto from "crypto";

export async function GET(request: Request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get("workspaceId");

        if (!workspaceId) {
            return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
        }

        // Verify membership
        const membership = await prisma.workspaceMember.findUnique({
            where: {
                workspaceId_userId: {
                    workspaceId: workspaceId,
                    userId: session.user.id
                }
            }
        });

        if (!membership) {
            return NextResponse.json({ error: "Unauthorized access to this workspace." }, { status: 403 });
        }

        const keys = await prisma.apiKey.findMany({
            where: { workspaceId },
            orderBy: { createdAt: "desc" }
        });

        return NextResponse.json(keys);
    } catch (error) {
        console.error("Error fetching API keys:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { workspaceId, name } = await request.json();

        if (!workspaceId) {
            return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
        }

        // Verify membership and role (Only owners or admins should theoretically create keys, sticking to basic auth for MVP)
        const membership = await prisma.workspaceMember.findUnique({
            where: {
                workspaceId_userId: {
                    workspaceId: workspaceId,
                    userId: session.user.id
                }
            }
        });

        if (!membership) {
            return NextResponse.json({ error: "Unauthorized access to this workspace." }, { status: 403 });
        }

        // Generate a secure API Key
        const rawKey = crypto.randomBytes(32).toString('hex');
        const formattedKey = `mc_${rawKey}`;

        const newKey = await prisma.apiKey.create({
            data: {
                key: formattedKey,
                name: name || "Default Extension Key",
                workspaceId: workspaceId
            }
        });

        // We return the raw key only once here. The UI should display it.
        return NextResponse.json(newKey, { status: 201 });
    } catch (error) {
        console.error("Error creating API key:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const keyId = searchParams.get("id");
        const workspaceId = searchParams.get("workspaceId");

        if (!keyId || !workspaceId) {
            return NextResponse.json({ error: "Missing id or workspaceId" }, { status: 400 });
        }

        // Verify membership
        const membership = await prisma.workspaceMember.findUnique({
            where: {
                workspaceId_userId: {
                    workspaceId: workspaceId,
                    userId: session.user.id
                }
            }
        });

        if (!membership) {
            return NextResponse.json({ error: "Unauthorized access to this workspace." }, { status: 403 });
        }

        await prisma.apiKey.deleteMany({
            where: {
                id: keyId,
                workspaceId: workspaceId
            }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting API key:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
