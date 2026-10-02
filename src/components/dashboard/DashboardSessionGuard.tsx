"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import useSWR from "swr";
import { agentRequest } from "@/hooks/use-agent-run";
import { useResolvedWorkspaceId } from "@/hooks/use-resolved-workspace-id";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { DashboardSkeleton } from "./DashboardSkeleton";
import { DashboardHomePage } from "./DashboardHomePage";

export function DashboardSessionGuard({ onboardingEnabled = false }: { onboardingEnabled?: boolean }) {
    const { status } = useSession();

    // Keep the real layout structure present while session verification runs.
    if (status === "loading") {
        return <DashboardSkeleton />;
    }

    // Only render dashboard when authenticated
    if (status === "authenticated") {
        return <>{onboardingEnabled && <OnboardingEntry />}<DashboardHomePage /></>;
    }

    return <div className="p-8"><h1 className="text-xl text-ink">Your session has ended</h1><Link className="mt-4 inline-block underline" href="/login">Sign in to your workspace</Link></div>;
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
