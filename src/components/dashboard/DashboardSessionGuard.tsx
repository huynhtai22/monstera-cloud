"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { DashboardSkeleton } from "./DashboardSkeleton";
import { DashboardHomePage } from "./DashboardHomePage";

export function DashboardSessionGuard() {
    const { status } = useSession();

    // Keep the real layout structure present while session verification runs.
    if (status === "loading") {
        return <DashboardSkeleton />;
    }

    // Only render dashboard when authenticated
    if (status === "authenticated") {
        return <DashboardHomePage />;
    }

    return <div className="p-8"><h1 className="text-xl text-ink">Your session has ended</h1><Link className="mt-4 inline-block underline" href="/login">Sign in to your workspace</Link></div>;
}
