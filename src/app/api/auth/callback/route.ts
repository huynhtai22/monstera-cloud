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
import { assertCanCreateSourceConnections, PlanLimitError } from "@/lib/plan-entitlements";
import { buildGoogleAdsMccBindings } from "@/lib/google-ads-mcc-binding";
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
        
        // Special handling for Shopee which sends shop_id, shopId, or main_account_id separately
        const shopId =
            searchParams.get("shop_id") ||
            searchParams.get("shopId") ||
            searchParams.get("main_account_id");
        const exchangeCode = shopId ? `${code}|${shopId}` : code;
        
        // Exchange code for credentials
        const callbackUrl = buildCallbackUrl(request, providerId);
        const { credentials, metadata } = await provider.exchangeCode({
            code: exchangeCode,
            redirectUri: callbackUrl,
            metadata: { workspaceId, userId },
        });

        const googleAdsBindings = providerId === "google_ads"
            ? buildGoogleAdsMccBindings({
                roots: metadata.extraFields?.googleAdsRoots,
                credentials,
                extraFields: metadata.extraFields,
            })
            : [];
        
        // P1: Handle reconnection flow - preserve existing pipelines and warehouse rows
        if (reconnectConnectionId) {
            const existing = await prisma.connection.findFirst({
                where: { id: reconnectConnectionId, workspaceId, provider: providerId },
                select: { id: true, workspaceId: true, lastSyncAt: true, remoteAccountId: true },
            });
            if (!existing) {
                throw new OAuthError("invalid_state", "Reconnect target does not match this workspace and provider", providerId);
            }
            const existingGoogleAdsIdentity = existing.remoteAccountId.replace(/\D/g, "");
            const googleAdsBinding = providerId === "google_ads"
                ? googleAdsBindings.find((binding) => {
                    if (binding.remoteAccountId === existingGoogleAdsIdentity) return true;
                    const discovered = binding.credentials.discoveredCustomerIds;
                    return Array.isArray(discovered) && discovered.includes(existingGoogleAdsIdentity);
                })
                : undefined;
            if (providerId === "google_ads" && !googleAdsBinding) {
                throw new OAuthError(
                    "provider_error",
                    "The Google account you authorized does not have access to this MCC. Reconnect with a Google user that has access to the selected manager account.",
                    providerId,
                );
            }

            // Older versions persisted an arbitrary child from Google's mixed
            // accessible-account list as the connection identity. Preserve the
            // connection row (and its pipelines/warehouse history) but migrate
            // that identity to the discovered MCC when it is unambiguous.
            const migrateLegacyGoogleAdsIdentity = Boolean(
                googleAdsBinding && googleAdsBinding.remoteAccountId !== existingGoogleAdsIdentity,
            );
            if (migrateLegacyGoogleAdsIdentity && googleAdsBinding) {
                const managerConnection = await prisma.connection.findFirst({
                    where: {
                        workspaceId,
                        provider: "google_ads",
                        remoteAccountId: googleAdsBinding.remoteAccountId,
                        NOT: { id: existing.id },
                    },
                    select: { id: true },
                });
                if (managerConnection) {
                    throw new OAuthError(
                        "provider_error",
                        "This MCC already has a separate source connection. Reconnect that MCC source instead; the existing connection was not changed.",
                        providerId,
                    );
                }
            }

            const updated = await prisma.connection.updateMany({
                where: { id: reconnectConnectionId, workspaceId, provider: providerId },
                data: {
                    credentials: encrypt(JSON.stringify({
                        ...(googleAdsBinding?.credentials ?? { ...credentials, ...metadata.extraFields }),
                    })),
                    status: "connected",
                    lastError: null,
                    name: googleAdsBinding?.name ?? metadata.name,
                    ...(migrateLegacyGoogleAdsIdentity && googleAdsBinding
                        ? { remoteAccountId: googleAdsBinding.remoteAccountId }
                        : {}),
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
        
        // Google Ads authorization can reveal more than one unrelated MCC. A
        // connection is created per root identity, never per child customer.
        const connectionInputs = googleAdsBindings.length > 0
            ? googleAdsBindings
            : [{
                remoteAccountId: metadata.accountIdentifiers?.[0] ??
                    (metadata.name ? metadata.name.replace(/\s+/g, "_").toLowerCase() : providerId),
                name: metadata.name,
                credentials: { ...credentials, ...metadata.extraFields },
                discoveredCustomerCount: metadata.accountIdentifiers?.length ?? 0,
            }];

        await assertCanCreateSourceConnections({
            workspaceId,
            connections: connectionInputs.map((input) => ({
                provider: providerId,
                remoteAccountId: input.remoteAccountId,
                credentials: input.credentials,
            })),
        });

        const connections = [];
        for (const input of connectionInputs) {
            const connection = await upsertSourceConnection({
                workspaceId,
                provider: providerId,
                remoteAccountId: input.remoteAccountId,
                name: input.name,
                type: "source",
                credentials: input.credentials,
                status: "connected",
            });
            connections.push(connection);
            await prisma.auditEvent.create({ data: { workspaceId, actorUserId: userId, action: "connection.connected", resource: "connection", resourceId: connection.id, metadata: { provider: providerId } } });
        }

        const connection = connections[0];

        // Google Ads customer discovery happens during the OAuth exchange. Log
        // the root-specific outcome against every resulting MCC connection so
        // a second manager login is observable before its first import.
        if (providerId === "google_ads") {
            for (let index = 0; index < connections.length; index += 1) {
                try {
                    await (prisma as any).providerSyncRun.create({
                        data: {
                            workspaceId,
                            connectionId: connections[index].id,
                            provider: "google_ads",
                            environment: "production",
                            endpoint: "customers:listAccessibleCustomers",
                            httpStatus: 200,
                            status: "success",
                            rowsReceived: connectionInputs[index].discoveredCustomerCount,
                            rowsWritten: 0,
                            startedAt: new Date(),
                            completedAt: new Date(),
                        },
                    });
                } catch (activityError) {
                    // Observability must never make a completed OAuth connection
                    // look failed if an older environment lacks this table.
                    logger.warn("[OAuth Callback] Google Ads discovery activity could not be recorded", activityError);
                }
            }
        }

        for (const createdConnection of connections) {
            try {
                const { job } = await enqueueOauthWarehouseBackfill({
                    workspaceId,
                    userId,
                    connectionId: createdConnection.id,
                    connectionWorkspaceId: createdConnection.workspaceId,
                    kind: createdConnection.created ? "initial" : "catchup",
                    lastSyncAt: createdConnection.lastSyncAt,
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
            error: error instanceof PlanLimitError ? "plan_limit" : "oauth_failed",
            provider: providerId || "unknown",
        });
        
        if (error instanceof PlanLimitError) {
            errorParams.set("error_code", error.code);
            errorParams.set("message", error.message);
            errorParams.set("upgrade", error.upgradeHref);
        } else if (error instanceof OAuthError) {
            errorParams.set("error_code", error.code);
            errorParams.set("message", error.message);
        } else if (error instanceof Error) {
            errorParams.set("message", error.message);
        }
        
        return NextResponse.redirect(new URL(`/sources?${errorParams.toString()}`, origin));
    }
}
