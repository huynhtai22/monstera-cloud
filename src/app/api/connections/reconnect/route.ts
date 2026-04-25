/**
 * Fix It Flow API - Initiate reconnection for expired/failed connections
 * P1: One-click reconnection that preserves existing pipelines
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getProviderRegistry } from "@/lib/oauth-framework/registry";
import { buildCallbackUrl } from "@/lib/oauth-framework/session";
import { logger } from "@/lib/logger";

export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const { connectionId, provider: providerId } = body;

        if (!connectionId || !providerId) {
            return NextResponse.json(
                { error: "Missing connectionId or provider" },
                { status: 400 }
            );
        }

        // Get connection details
        const connection = await prisma.connection.findFirst({
            where: {
                id: connectionId,
                workspace: {
                    members: {
                        some: {
                            userId: session.user.id,
                        },
                    },
                },
            },
            include: {
                workspace: true,
            },
        });

        if (!connection) {
            return NextResponse.json(
                { error: "Connection not found or access denied" },
                { status: 404 }
            );
        }

        // Get provider adapter
        const registry = getProviderRegistry();
        const adapter = registry[providerId];
        
        if (!adapter) {
            return NextResponse.json(
                { error: `Provider ${providerId} not supported` },
                { status: 400 }
            );
        }

        // Build state with reconnection context
        const callbackUrl = `${process.env.NEXTAUTH_URL?.replace(/\/$/, "") || "https://" + process.env.VERCEL_URL}/api/auth/callback?provider=${providerId}`;
        const reconnectState = {
            userId: session.user.id,
            workspaceId: connection.workspaceId,
            providerId,
            reconnectConnectionId: connectionId, // P1: Key flag for reconnection flow
            preservePipelines: true,
        };

        // Generate authorization URL
        const authUrl = adapter.buildAuthorizeUrl({
            redirectUri: callbackUrl,
            state: Buffer.from(JSON.stringify(reconnectState)).toString("base64url"),
            workspaceId: connection.workspaceId,
        });

        return NextResponse.json({
            authUrl,
            connectionId,
            provider: providerId,
        });
    } catch (error) {
        logger.error("[POST /api/connections/reconnect]", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
