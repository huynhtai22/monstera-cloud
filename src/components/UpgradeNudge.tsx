"use client";

import Link from "next/link";
import useSWR from "swr";
import { AlertTriangle } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { getPlanLimits } from "@/lib/plan-config";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * In-app upgrade banner when workspace pipeline count hits the plan ceiling (P2).
 */
export function UpgradeNudge() {
    const { activeWorkspaceId } = useWorkspaceStore();
    const { data: planData } = useSWR("/api/user/plan", fetcher);
    const { data: workspaces } = useSWR("/api/workspaces", fetcher);

    const plan = (planData?.plan as string) ?? "free";
    const limits = getPlanLimits(plan);
    if (limits.maxPipelines === Infinity) return null;

    const ws = Array.isArray(workspaces)
        ? workspaces.find((w: { id: string }) => w.id === activeWorkspaceId)
        : null;
    const pipelineCount = Array.isArray(ws?.pipelines) ? ws.pipelines.length : 0;

    if (pipelineCount < limits.maxPipelines) return null;

    return (
        <div
            className="border-b border-amber-200/80 bg-amber-50/95 px-4 py-2.5 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-50"
            role="status"
        >
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-2 text-center sm:justify-between sm:text-left">
                <span className="inline-flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>
                        You&apos;re at your plan&apos;s pipeline limit ({limits.maxPipelines}). Upgrade for more syncs and
                        higher cadence.
                    </span>
                </span>
                <Link
                    href="/pricing"
                    className="shrink-0 font-semibold text-amber-900 underline decoration-amber-700/50 hover:text-amber-950 dark:text-amber-100 dark:hover:text-white"
                >
                    View plans
                </Link>
            </div>
        </div>
    );
}
