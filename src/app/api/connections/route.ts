import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { upsertSourceConnection } from "@/lib/connection-upsert";

export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { workspaceId, clientId, name, type, provider, credentials, remoteAccountId: bodyRemoteAccountId } = body;

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

        // Upsert connection by identity triple (workspaceId + provider + remoteAccountId)
        const remoteAccountId = bodyRemoteAccountId ||
            (name ? name.replace(/\s+/g, "_").toLowerCase() : provider);

        const connection = await upsertSourceConnection({
            workspaceId,
            provider,
            remoteAccountId,
            name,
            type,
            credentials: credentials || "{}",
            status: body.status || "connected",
            clientId: clientId || undefined,
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
            logger.error("Auto mapping error (ignoring for MVP):", autoMapError);
        }

        return NextResponse.json(connection, { status: 201 });
    } catch (error) {
        logger.error("Error creating connection:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
