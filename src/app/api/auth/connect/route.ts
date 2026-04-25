/**
 * Unified OAuth Authorization Route
 * Replaces: /api/auth/{provider}/authorize for all providers
 */

import { NextRequest, NextResponse } from "next/server";
import { 
    requireSession, 
    buildCallbackUrl, 
    generateState 
} from "@/lib/oauth-framework/session";
import { getProvider, isProviderEnabled } from "@/lib/oauth-framework/registry";
import { OAuthError } from "@/lib/oauth-framework/types";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
    try {
        // Validate session
        const session = await requireSession();
        
        // Get provider from query param
        const searchParams = request.nextUrl.searchParams;
        const providerId = searchParams.get("provider");
        const workspaceId = searchParams.get("workspaceId");
        
        if (!providerId) {
            return NextResponse.json(
                { error: "Missing provider parameter" },
                { status: 400 }
            );
        }
        
        if (!workspaceId) {
            return NextResponse.json(
                { error: "Missing workspaceId parameter" },
                { status: 400 }
            );
        }
        
        // Check provider is enabled
        if (!isProviderEnabled(providerId)) {
            return NextResponse.json(
                { error: `Provider "${providerId}" is not enabled` },
                { status: 404 }
            );
        }
        
        // Get provider adapter
        const provider = getProvider(providerId);
        
        // Build callback URL
        const callbackUrl = buildCallbackUrl(request, providerId);
        
        // Generate secure state
        const state = generateState({
            workspaceId,
            userId: session.userId,
        });
        
        // Build authorization URL
        const authorizeUrl = await provider.buildAuthorizeUrl({
            workspaceId,
            redirectUri: callbackUrl,
            state,
        });
        
        // Redirect to provider
        return NextResponse.redirect(authorizeUrl);
        
    } catch (error) {
        logger.error("[OAuth Connect] Error:", error);
        
        if (error instanceof OAuthError) {
            const params = new URLSearchParams({
                error: error.code,
                error_description: error.message,
            });
            return NextResponse.redirect(`/sources?${params.toString()}`);
        }
        
        return NextResponse.json(
            { error: "Authorization failed" },
            { status: 500 }
        );
    }
}
