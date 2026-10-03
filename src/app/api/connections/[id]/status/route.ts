/**
 * Connection status check API
 * P1: Used by Fix It flow to verify reconnection succeeded
 */

import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getAccountHealth } from "@/lib/provider-account-health";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getAuthSession();
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
                lastError: true,
                updatedAt: true,
            },
        });

        if (!connection) {
            return NextResponse.json(
                { error: "Connection not found" },
                { status: 404 }
            );
        }

        const accounts = await getAccountHealth(connection.id);

        return NextResponse.json({
            id: connection.id,
            status: connection.status,
            hasError: Boolean(connection.lastError),
            lastError: connection.lastError,
            updatedAt: connection.updatedAt,
            accounts: accounts.map((acc) => ({
                accountId: acc.accountId,
                accountName: acc.accountName,
                status: acc.status,
                errorCategory: acc.errorCategory,
                consecutiveFailures: acc.consecutiveFailures,
                lastError: acc.lastError,
                lastErrorAt: acc.lastErrorAt,
                lastSuccessAt: acc.lastSuccessAt,
            })),
        });
    } catch (error) {
        logger.error("[GET /api/connections/[id]/status]", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
