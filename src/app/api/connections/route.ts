import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { workspaceId, name, type, provider, credentials } = body;

        if (!workspaceId || !name || !type || !provider) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Verify the user has access to this workspace
        const membership = await prisma.workspaceMember.findUnique({
            where: {
                workspaceId_userId: {
                    workspaceId: workspaceId,
                    userId: session.user.id
                }
            }
        });

        if (!membership) {
            return NextResponse.json({ error: "Unauthorized for this workspace" }, { status: 403 });
        }

        // Create the connection
        const connection = await prisma.connection.create({
            data: {
                workspaceId,
                name,
                type,
                provider,
                credentials: credentials || "{}"
            }
        });

        // ---------------------------------------------------------------------
        // MVP AUTO-MAPPING LOGIC
        // If they just connected a Source, find a Destination and link them.
        // If they just connected a Destination, find a Source and link them.
        // ---------------------------------------------------------------------
        try {
            const oppositeType = type === 'source' ? 'destination' : 'source';
            const counterpart = await prisma.connection.findFirst({
                where: { workspaceId, type: oppositeType }
            });

            if (counterpart) {
                // Check if a pipeline already exists between these two
                const sourceId = type === 'source' ? connection.id : counterpart.id;
                const destId = type === 'destination' ? connection.id : counterpart.id;

                const existingPipeline = await prisma.pipeline.findFirst({
                    where: { sourceConnectionId: sourceId, destinationConnectionId: destId }
                });

                if (!existingPipeline) {
                    await prisma.pipeline.create({
                        data: {
                            workspaceId,
                            name: `Sync: ${type === 'source' ? connection.name : counterpart.name} to ${type === 'destination' ? connection.name : counterpart.name}`,
                            sourceConnectionId: sourceId,
                            destinationConnectionId: destId
                        }
                    });
                }
            }
        } catch (autoMapError) {
            console.error("Auto mapping error (ignoring for MVP):", autoMapError);
        }

        return NextResponse.json(connection, { status: 201 });
    } catch (error) {
        console.error("Error creating connection:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
