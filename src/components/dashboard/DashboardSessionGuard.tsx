"use client";

import { useSession } from "next-auth/react";
import { DashboardHomePage } from "./DashboardHomePage";
import { GlobeLoader } from "@/components/GlobeLoader";

/**
 * P1: Session guard to prevent dashboard loading before auth is ready
 * This fixes "Cannot destructure property 'auth' of 'e' as it is undefined" error
 * that occurs when SWR hooks run before NextAuth session is fully initialized
 */
export function DashboardSessionGuard() {
    const { status } = useSession();

    // Wait for session to be fully loaded before rendering dashboard
    if (status === "loading") {
        return (
            <div className="flex h-screen items-center justify-center">
                <GlobeLoader className="h-12 w-12" />
            </div>
        );
    }

    // Only render dashboard when authenticated
    if (status === "authenticated") {
        return <DashboardHomePage />;
    }

    // Unauthenticated - will be redirected by middleware, but show loader anyway
    return (
        <div className="flex h-screen items-center justify-center">
            <GlobeLoader className="h-12 w-12" />
        </div>
    );
}
