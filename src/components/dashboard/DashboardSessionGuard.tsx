"use client";

import { useSession } from "next-auth/react";
import { DashboardHomePage } from "./DashboardHomePage";

/**
 * P1: Session guard to prevent dashboard loading before auth is ready
 * This fixes "Cannot destructure property 'auth' of 'e' as it is undefined" error
 * that occurs when SWR hooks run before NextAuth session is fully initialized
 * 
 * Note: AppLayout already shows a GlobeLoader during session loading,
 * so we just return null here to avoid duplicate loaders.
 */
export function DashboardSessionGuard() {
    const { status } = useSession();

    // Wait for session to be fully loaded before rendering dashboard
    // AppLayout already shows a loader, so we return null here
    if (status === "loading") {
        return null;
    }

    // Only render dashboard when authenticated
    if (status === "authenticated") {
        return <DashboardHomePage />;
    }

    // Unauthenticated - will be redirected by middleware
    return null;
}
