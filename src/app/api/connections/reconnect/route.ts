/**
 * Fix It Flow API - Initiate reconnection for expired/failed connections
 * P1: One-click reconnection that preserves existing pipelines
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getProviderRegistry } from "@/lib/oauth-framework/registry";
import { logger } from "@/lib/logger";
import { createOAuthAttempt, oauthAttemptCookieName } from "@/lib/oauth-attempt";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

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
        await requireWorkspaceAccess({
            userId: session.user.id,
            workspaceId: connection.workspaceId,
            minimumRole: "member",
            operation: "reconnect_source",
        });
        if (connection.provider !== providerId) {
            return NextResponse.json({ error: "Provider does not match connection" }, { status: 400 });
        }

        const providerAccess = await prisma.workspaceProviderAccess.findUnique({
            where: {
                workspaceId_provider: {
                    workspaceId: connection.workspaceId,
                    provider: providerId,
                },
            },
            select: { enabled: true },
        });
        if (!providerAccess?.enabled) {
            return NextResponse.json({ error: "Provider is not enabled for this workspace" }, { status: 403 });
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
        const reconnectState = await createOAuthAttempt({
            userId: session.user.id,
            workspaceId: connection.workspaceId,
            provider: providerId,
            reconnectConnectionId: connectionId,
        });

        // Generate authorization URL
        const authUrl = adapter.buildAuthorizeUrl({
            redirectUri: callbackUrl,
            state: reconnectState,
            workspaceId: connection.workspaceId,
        });

        const response = NextResponse.json({
            authUrl,
            connectionId,
            provider: providerId,
        });
        response.cookies.set(oauthAttemptCookieName(providerId), reconnectState, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 10 * 60,
            path: "/api/auth/callback",
        });
        return response;
    } catch (error) {
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;
        logger.error("[POST /api/connections/reconnect]", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
