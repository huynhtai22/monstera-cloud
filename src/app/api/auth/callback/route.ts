/**
 * Unified OAuth Callback Route
 * Replaces: /api/auth/{provider}/callback for all providers
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { buildCallbackUrl } from "@/lib/oauth-framework/session";
import { getProvider, isProviderEnabled } from "@/lib/oauth-framework/registry";
import { OAuthError } from "@/lib/oauth-framework/types";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { upsertSourceConnection } from "@/lib/connection-upsert";
import { consumeOAuthAttempt, oauthAttemptCookieName } from "@/lib/oauth-attempt";
import { requireWorkspaceAccess } from "@/lib/rbac";
import { assertWorkspaceProviderEnabled, ProviderAccessError } from "@/lib/workspace-provider-access";
import { emitMonitor } from "@/lib/observability/monitors";
import { enqueueOauthWarehouseBackfill } from "@/lib/oauth-warehouse-backfill";
import { after } from "next/server";
import { claimImportJob } from "@/lib/warehouse-import-job";
import { runDurableImportWorker } from "@/app/api/data-explorer/warehouse/import-batch/route";

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

        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            throw new OAuthError("unauthorized", "Sign in again before connecting a source", providerId);
        }
        const cookieState = request.cookies.get(oauthAttemptCookieName(providerId))?.value;
        const attemptToken = state || cookieState;
        if (!attemptToken) {
            throw new OAuthError("invalid_state", "OAuth attempt cookie and state are missing", providerId);
        }
        const attempt = await consumeOAuthAttempt({
            token: attemptToken,
            provider: providerId,
            sessionUserId: session.user.id,
        });
        const workspaceId = attempt.workspaceId;
        const userId = attempt.userId;
        const reconnectConnectionId = attempt.reconnectConnectionId ?? undefined;

        await requireWorkspaceAccess({
            userId,
            workspaceId,
            minimumRole: "member",
            operation: reconnectConnectionId ? "reconnect_source" : "connect_source",
        });
        try {
            await assertWorkspaceProviderEnabled({ workspaceId, provider: providerId });
        } catch (error) {
            if (error instanceof ProviderAccessError) {
                throw new OAuthError("configuration_error", error.message, providerId);
            }
            throw error;
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
        
        // P1: Handle reconnection flow - preserve existing pipelines and warehouse rows
        if (reconnectConnectionId) {
            const existing = await prisma.connection.findFirst({
                where: { id: reconnectConnectionId, workspaceId, provider: providerId },
                select: { id: true, workspaceId: true, lastSyncAt: true },
            });
            if (!existing) {
                throw new OAuthError("invalid_state", "Reconnect target does not match this workspace and provider", providerId);
            }
            const updated = await prisma.connection.updateMany({
                where: { id: reconnectConnectionId, workspaceId, provider: providerId },
                data: {
                    credentials: encrypt(JSON.stringify({
                        ...credentials,
                        ...metadata.extraFields,
                    })),
                    status: "connected",
                    lastError: null,
                    name: metadata.name, // Update name if account changed
                    updatedAt: new Date(),
                },
            });
            if (updated.count !== 1) {
                throw new OAuthError("invalid_state", "Reconnect target does not match this workspace and provider", providerId);
            }
            await prisma.auditEvent.create({ data: { workspaceId, actorUserId: userId, action: "connection.reconnected", resource: "connection", resourceId: reconnectConnectionId, metadata: { provider: providerId } } });

            try {
                const { job } = await enqueueOauthWarehouseBackfill({
                    workspaceId,
                    userId,
                    connectionId: existing.id,
                    connectionWorkspaceId: existing.workspaceId,
                    kind: "catchup",
                    lastSyncAt: existing.lastSyncAt,
                });
                after(async () => {
                    try {
                        const claim = await claimImportJob(job.id);
                        if (claim.claimed && claim.leaseId) {
                            await runDurableImportWorker(job.id, claim.leaseId);
                        }
                    } catch (err) {
                        logger.error("[OAuth Callback] catch-up worker error", err);
                    }
                });
            } catch (err) {
                logger.warn("[OAuth Callback] catch-up enqueue failed", err);
            }
            
            // Redirect to sources page with success message
            const successParams = new URLSearchParams({
                reconnected: "true",
                provider: providerId,
            });
            const response = NextResponse.redirect(new URL(`/sources?${successParams.toString()}`, origin));
            response.cookies.delete(oauthAttemptCookieName(providerId));
            return response;
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
        await prisma.auditEvent.create({ data: { workspaceId, actorUserId: userId, action: "connection.connected", resource: "connection", resourceId: connection.id, metadata: { provider: providerId } } });

        try {
            const { job } = await enqueueOauthWarehouseBackfill({
                workspaceId,
                userId,
                connectionId: connection.id,
                connectionWorkspaceId: connection.workspaceId,
                kind: connection.created ? "initial" : "catchup",
                lastSyncAt: connection.lastSyncAt,
            });
            after(async () => {
                try {
                    const claim = await claimImportJob(job.id);
                    if (claim.claimed && claim.leaseId) {
                        await runDurableImportWorker(job.id, claim.leaseId);
                    }
                } catch (err) {
                    logger.error("[OAuth Callback] initial backfill worker error", err);
                }
            });
        } catch (err) {
            logger.warn("[OAuth Callback] warehouse backfill enqueue failed", err);
        }

        // Redirect to explicit setup flow (replaces auto-pipeline creation)
        // User chooses destination or skips if using add-on/Looker
        const response = NextResponse.redirect(
            new URL(
                `/sources/setup?newConnectionId=${encodeURIComponent(connection.id)}&provider=${encodeURIComponent(providerId)}`,
                origin
            )
        );
        response.cookies.delete(oauthAttemptCookieName(providerId));
        return response;
        
    } catch (error) {
        emitMonitor("oauth_failure", {
            provider: providerId || "unknown",
            code: error instanceof OAuthError ? error.code : "oauth_failed",
        });
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
