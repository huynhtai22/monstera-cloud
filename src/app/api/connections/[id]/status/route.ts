/**
 * Connection status check API
 * P1: Used by Fix It flow to verify reconnection succeeded
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;

        const connection = await prisma.connection.findFirst({
            where: {
                id,
                workspace: {
                    members: {
                        some: {
                            userId: session.user.id,
                        },
                    },
                },
            },
            select: {
                id: true,
                status: true,
                updatedAt: true,
            },
        });

        if (!connection) {
            return NextResponse.json(
                { error: "Connection not found" },
                { status: 404 }
            );
        }

        return NextResponse.json({
            id: connection.id,
            status: connection.status,
            updatedAt: connection.updatedAt,
        });
    } catch (error) {
        logger.error("[GET /api/connections/[id]/status]", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
