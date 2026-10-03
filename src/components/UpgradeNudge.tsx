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

    const title = accountHit ? "Source limit reached" : "Pipeline limit reached";
    const detail = accountHit
        ? `This workspace has ${connectionCount}/${limits.maxConnections} source connections. Review your plan to add more.`
        : `This workspace has ${pipelineCount}/${limits.maxPipelines} pipelines. Review your plan to add more.`;

    return (
        <div
            className="border-b border-line bg-panel px-4 py-3"
            role="status"
        >
            <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="flex min-w-0 items-start gap-3 sm:items-center">
                    <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-amber-400">
                        <AlertTriangle className="h-4 w-4" aria-hidden />
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-semibold text-ink">
                            {title}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-mute">
                            {detail}
                        </p>
                    </div>
                </div>
                <Link
                    href="/settings?tab=billing"
                    className="inline-flex shrink-0 items-center justify-center rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-muted"
                >
                    Review plan
                </Link>
            </div>
        </div>
    );
}
