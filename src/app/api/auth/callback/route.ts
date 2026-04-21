/**
 * Unified OAuth Callback Route
 * Replaces: /api/auth/{provider}/callback for all providers
 */

import { NextRequest, NextResponse } from "next/server";
import { parseState, buildCallbackUrl } from "@/lib/oauth-framework/session";
import { getProvider, isProviderEnabled } from "@/lib/oauth-framework/registry";
import { OAuthError } from "@/lib/oauth-framework/types";
import prisma from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";

export async function GET(request: NextRequest) {
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
        return NextResponse.redirect(`/sources?${params.toString()}`);
    }
    
    try {
        if (!providerId) {
            throw new OAuthError("configuration_error", "Missing provider in callback");
        }
        
        if (!code) {
            throw new OAuthError("provider_error", "Authorization code not received", providerId);
        }
        
        if (!state) {
            throw new OAuthError("invalid_state", "State parameter missing", providerId);
        }
        
        if (!isProviderEnabled(providerId)) {
            throw new OAuthError("configuration_error", "Provider not enabled", providerId);
        }
        
        // Parse state to get workspace, user, and reconnection context
        const stateData = parseState(state);
        const { workspaceId, userId, reconnectConnectionId } = stateData as {
            workspaceId: string;
            userId: string;
            reconnectConnectionId?: string;
        };
        
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
            return NextResponse.redirect(`/sources?${successParams.toString()}`);
        }
        
        // Create new connection record
        const connection = await prisma.connection.create({
            data: {
                workspaceId,
                name: metadata.name,
                type: "source",
                provider: providerId,
                credentials: encrypt(JSON.stringify({
                    ...credentials,
                    ...metadata.extraFields,
                })),
                status: "connected",
            },
        });
        
        // Redirect to explicit setup flow (replaces auto-pipeline creation)
        // User chooses destination or skips if using add-on/Looker
        return NextResponse.redirect(
            `/sources/setup?newConnectionId=${connection.id}&provider=${providerId}`
        );
        
    } catch (error) {
        console.error("[OAuth Callback] Error:", error);
        
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
        
        return NextResponse.redirect(`/sources?${errorParams.toString()}`);
    }
}
