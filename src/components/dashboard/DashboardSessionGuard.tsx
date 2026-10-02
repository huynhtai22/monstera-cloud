"use client";

import { useSession } from "next-auth/react";
import { DashboardHomePage } from "./DashboardHomePage";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import useSWR from "swr";
import { agentRequest } from "@/hooks/use-agent-run";
import { useResolvedWorkspaceId } from "@/hooks/use-resolved-workspace-id";

/**
 * P1: Session guard to prevent dashboard loading before auth is ready
 * This fixes "Cannot destructure property 'auth' of 'e' as it is undefined" error
 * that occurs when SWR hooks run before NextAuth session is fully initialized
 *
 * Note: AppLayout already shows a GlobeLoader during session loading,
 * so we just return null here to avoid duplicate loaders.
 */
export function DashboardSessionGuard({ onboardingEnabled = false }: { onboardingEnabled?: boolean }) {
    const { status } = useSession();

    // Wait for session to be fully loaded before rendering dashboard
    // AppLayout already shows a loader, so we return null here
    if (status === "loading") {
        return null;
    }

    // Only render dashboard when authenticated
    if (status === "authenticated") {
        return <>{onboardingEnabled && <OnboardingEntry />}<DashboardHomePage /></>;
    }

    // Unauthenticated - will be redirected by middleware
    return null;
}

function OnboardingEntry() {
    const { workspaceId } = useResolvedWorkspaceId();
    const pathname = usePathname();
    const agencyPrefix = pathname?.match(/^\/agencies\/[^/]+/)?.[0] ?? "";
    const base = `${agencyPrefix}/onboarding`;
    const target = workspaceId ? `${base}?workspaceId=${encodeURIComponent(workspaceId)}` : base;
    const router = useRouter();
    const { data, error, isValidating } = useSWR<{ requiresSetup: boolean }>(workspaceId ? `/api/agent/onboarding-entry?workspaceId=${encodeURIComponent(workspaceId)}` : null, agentRequest, { revalidateOnFocus: false, revalidateOnMount: true, dedupingInterval: 0 });
    useEffect(() => { if (data?.requiresSetup && !isValidating && !error) router.replace(target); }, [data, error, isValidating, router, target]);
    if (!data || error) return null;
    return <div className="flex justify-end px-6 pt-4"><Link className="text-xs text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]" href={target}>Set up with Monstera →</Link></div>;
}
