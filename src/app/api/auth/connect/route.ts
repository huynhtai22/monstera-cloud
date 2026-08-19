/**
 * Unified OAuth Authorization Route
 * Replaces: /api/auth/{provider}/authorize for all providers
 */

import { NextRequest, NextResponse } from "next/server";
import { 
    requireSession, 
    buildCallbackUrl,
} from "@/lib/oauth-framework/session";
import { getProvider, isProviderConfigured, isProviderEnabled } from "@/lib/oauth-framework/registry";
import { OAuthError } from "@/lib/oauth-framework/types";
import { logger } from "@/lib/logger";
import { createOAuthAttempt, oauthAttemptCookieName } from "@/lib/oauth-attempt";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { assertWorkspaceProviderEnabled, toProviderAccessResponse } from "@/lib/workspace-provider-access";

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
        if (!isProviderEnabled(providerId) || !isProviderConfigured(providerId)) {
            return NextResponse.json(
                { error: `Provider "${providerId}" is not enabled` },
                { status: 404 }
            );
        }

        await requireWorkspaceAccess({
            userId: session.userId,
            workspaceId,
            minimumRole: "member",
            operation: "connect_source",
        });
        await assertWorkspaceProviderEnabled({ workspaceId, provider: providerId });
        
        // Get provider adapter
        const provider = getProvider(providerId);
        
        // Build callback URL
        const callbackUrl = buildCallbackUrl(request, providerId);
        
        // Generate secure state
        const state = await createOAuthAttempt({
            workspaceId,
            userId: session.userId,
            provider: providerId,
        });
        
        // Build authorization URL
        const authorizeUrl = await provider.buildAuthorizeUrl({
            workspaceId,
            redirectUri: callbackUrl,
            state,
        });
        
        // Redirect to provider
        const response = NextResponse.redirect(authorizeUrl);
        response.cookies.set(oauthAttemptCookieName(providerId), state, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 10 * 60,
            path: "/api/auth/callback",
        });
        return response;
        
    } catch (error) {
        logger.error("[OAuth Connect] Error:", error);
        
        const providerDenied = toProviderAccessResponse(error);
        if (providerDenied) return providerDenied;
        const rbac = toRbacResponse(error);
        if (rbac) return rbac;

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
