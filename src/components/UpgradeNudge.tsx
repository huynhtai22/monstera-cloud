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
    if (limits.maxPipelines === Infinity) return null;
    const pipelineCount = ws?.counts?.pipelines ?? 0;

    if (pipelineCount < limits.maxPipelines) return null;

    return (
        <div
            className="border-b border-cyan-200/40 bg-gradient-to-r from-cyan-50/90 via-white to-violet-50/80 px-4 py-3 dark:border-cyan-900/30 dark:from-cyan-950/40 dark:via-slate-950/80 dark:to-violet-950/30"
            role="status"
        >
            <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="flex min-w-0 items-start gap-3 sm:items-center">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-amber-200/80 bg-white/80 text-amber-600 shadow-sm dark:border-amber-800/60 dark:bg-[#000000]/80 dark:text-amber-400">
                        <AlertTriangle className="h-4 w-4" aria-hidden />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            Pipeline limit reached
                        </p>
                        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                            Your workspace has{" "}
                            <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                                {pipelineCount}/{limits.maxPipelines}
                            </span>{" "}
                            pipelines — the maximum for your current plan. Upgrade to add more pipelines and unlock higher
                            workspace capacity.
                        </p>
                    </div>
                </div>
                <Link
                    href="/support"
                    className="inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-cyan-500 to-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-cyan-900/20 ring-1 ring-cyan-400/30 transition hover:from-cyan-400 hover:to-cyan-500 hover:shadow-lg dark:shadow-black/40"
                >
                    Contact pilot support
                </Link>
            </div>
        </div>
    );
}
