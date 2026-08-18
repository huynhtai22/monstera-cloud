/**
 * OAuth Framework - Session Validation
 * Standardized session handling for all OAuth flows
 */

import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import type { SessionContext } from "./types";
import { OAuthError as OAuthErrorClass } from "./types";

export async function requireSession(): Promise<SessionContext> {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
        throw new OAuthErrorClass("unauthorized", "Session required for OAuth flow");
    }
    
    // Note: workspaceId is typically passed via state param, not session
    // This function validates the user is authenticated
    return {
        userId: session.user.id,
        workspaceId: "", // Will be set from state/param by caller
        email: session.user.email,
    };
}

export function getPublicBaseUrl(request: Request): string {
    const explicit = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
    if (explicit) return explicit;
    
    const vercel = process.env.VERCEL_URL;
    if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
    
    return new URL(request.url).origin;
}

export function buildCallbackUrl(request: Request, providerId: string): string {
    const base = getPublicBaseUrl(request);
    return `${base}/api/auth/callback?provider=${providerId}`;
}
