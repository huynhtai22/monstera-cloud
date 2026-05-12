/**
 * Unified OAuth Callback Route
 * Replaces: /api/auth/{provider}/callback for all providers
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { parseState, buildCallbackUrl } from "@/lib/oauth-framework/session";
import { getProvider, isProviderEnabled } from "@/lib/oauth-framework/registry";
import { OAuthError } from "@/lib/oauth-framework/types";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { upsertSourceConnection } from "@/lib/connection-upsert";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const origin = request.nextUrl.origin;
    const searchParams = request.nextUrl.searchParams;
    const providerId = searchParams.get("provider");
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");
    
    // Handle provider errors
    if (error) {
        const params = new URLSearchParams({
            error: "provider_error",
            provider: providerId || "unknown",
            message: errorDescription || error,
        });
        return NextResponse.redirect(new URL(`/sources?${params.toString()}`, origin));
    }
    
    try {
        if (!providerId) {
            throw new OAuthError("configuration_error", "Missing provider in callback");
        }
        
        if (!code) {
            throw new OAuthError("provider_error", "Authorization code not received", providerId);
        }

        if (!isProviderEnabled(providerId)) {
            throw new OAuthError("configuration_error", "Provider not enabled", providerId);
        }

        let workspaceId: string;
        let userId: string;
        let reconnectConnectionId: string | undefined;

        if (state) {
            const stateData = parseState(state);
            workspaceId = stateData.workspaceId;
            userId = stateData.userId;
            reconnectConnectionId = stateData.reconnectConnectionId;
        } else {
            // Shopee / Lazada sometimes omit `state` on the redirect URL even when it was sent on auth.
            const marketplaceFallback = providerId === "shopee" || providerId === "lazada";
            const session = await getServerSession(authOptions);
            if (!marketplaceFallback || !session?.user?.id) {
                throw new OAuthError(
                    "invalid_state",
                    marketplaceFallback
                        ? "State parameter missing — sign in again, then connect from Sources."
                        : "State parameter missing",
                    providerId
                );
            }
            userId = session.user.id;
            const owned = await prisma.workspace.findFirst({
                where: { ownerId: userId },
                orderBy: { updatedAt: "desc" },
                select: { id: true },
            });
            const workspace =
                owned ??
                (await prisma.workspace.findFirst({
                    where: { members: { some: { userId } } },
                    orderBy: { createdAt: "asc" },
                    select: { id: true },
                }));
            if (!workspace) {
                throw new OAuthError(
                    "configuration_error",
                    "No workspace found for this account",
                    providerId
                );
            }
            workspaceId = workspace.id;
            logger.warn(
                `[OAuth Callback] Missing state; using oldest workspace ${workspaceId} for ${providerId} (user=${userId})`
            );
        }
        
        // Get provider adapter
        const provider = getProvider(providerId);
        
        // Special handling for Shopee which sends shop_id separately
        const shopId = searchParams.get("shop_id");
        const exchangeCode = shopId ? `${code}|${shopId}` : code;
        
        // Exchange code for credentials
        const callbackUrl = buildCallbackUrl(request, providerId);
        const { credentials, metadata } = await provider.exchangeCode({
            code: exchangeCode,
            redirectUri: callbackUrl,
            metadata: { workspaceId, userId },
        });
        
        // P1: Handle reconnection flow - preserve existing pipelines
        if (reconnectConnectionId) {
            // Update existing connection with new credentials
            await prisma.connection.update({
                where: { id: reconnectConnectionId },
                data: {
                    credentials: encrypt(JSON.stringify({
                        ...credentials,
                        ...metadata.extraFields,
                    })),
                    status: "connected",
                    name: metadata.name, // Update name if account changed
                    updatedAt: new Date(),
                },
            });
            
            // Redirect to sources page with success message
            const successParams = new URLSearchParams({
                reconnected: "true",
                provider: providerId,
            });
            return NextResponse.redirect(new URL(`/sources?${successParams.toString()}`, origin));
        }
        
        // Upsert connection by identity triple (workspaceId + provider + remoteAccountId)
        const remoteAccountId =
            metadata.accountIdentifiers?.[0] ??
            (metadata.name ? metadata.name.replace(/\s+/g, "_").toLowerCase() : providerId);

        const connection = await upsertSourceConnection({
            workspaceId,
            provider: providerId,
            remoteAccountId,
            name: metadata.name,
            type: "source",
            credentials: {
                ...credentials,
                ...metadata.extraFields,
            },
            status: "connected",
        });

        // Redirect to explicit setup flow (replaces auto-pipeline creation)
        // User chooses destination or skips if using add-on/Looker
        return NextResponse.redirect(
            new URL(
                `/sources/setup?newConnectionId=${encodeURIComponent(connection.id)}&provider=${encodeURIComponent(providerId)}`,
                origin
            )
        );
        
    } catch (error) {
        logger.error("[OAuth Callback] Error:", error);
        
        const errorParams = new URLSearchParams({
            error: "oauth_failed",
            provider: providerId || "unknown",
        });
        
        if (error instanceof OAuthError) {
            errorParams.set("error_code", error.code);
            errorParams.set("message", error.message);
        } else if (error instanceof Error) {
            errorParams.set("message", error.message);
        }
        
        return NextResponse.redirect(new URL(`/sources?${errorParams.toString()}`, origin));
    }
}
