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
        
        // Parse state to get workspace and user
        const { workspaceId, userId } = parseState(state);
        
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
        
        // Create connection record
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
        
        // Redirect to sources with success param
        // The UI will handle showing a "Link to Destination" prompt
        const params = new URLSearchParams({
            newConnectionId: connection.id,
            setup: "choose-destination",
        });
        
        return NextResponse.redirect(`/sources?${params.toString()}`);
        
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
