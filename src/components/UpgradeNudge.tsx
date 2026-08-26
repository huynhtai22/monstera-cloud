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
    const { data: workspaces } = useSWR("/api/workspaces", fetcher);

    const ws = Array.isArray(workspaces)
        ? workspaces.find((w: { id: string }) => w.id === activeWorkspaceId)
        : null;
    const limits = getPlanLimits(ws?.plan ?? "pilot");
    const pipelineCount = ws?.counts?.pipelines ?? 0;
    const connectionCount = ws?.counts?.sourceConnections ?? ws?.counts?.connections ?? 0;
    const pipelineHit = limits.maxPipelines !== Infinity && pipelineCount >= limits.maxPipelines;
    const accountHit = limits.maxConnections !== Infinity && connectionCount >= limits.maxConnections;
    if (!pipelineHit && !accountHit) return null;

    const title = accountHit ? "Account limit reached" : "Pipeline limit reached";
    const detail = accountHit
        ? `This workspace has ${connectionCount}/${limits.maxConnections} source connections — the ${limits.displayName} cap. Destinations are not metered.`
        : `This workspace has ${pipelineCount}/${limits.maxPipelines} pipelines — the ${limits.displayName} cap.`;

    return (
        <div
            className="border-b border-line bg-panel px-4 py-3"
            role="status"
        >
            <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="flex min-w-0 items-start gap-3 sm:items-center">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-500/30 bg-canvas text-amber-400">
                        <AlertTriangle className="h-4 w-4" aria-hidden />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">
                            {title}
                        </p>
                        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                            {detail}
                        </p>
                    </div>
                </div>
                <Link
                    href="/settings?tab=billing"
                    className="inline-flex shrink-0 items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
                >
                    View plans
                </Link>
            </div>
        </div>
    );
}
