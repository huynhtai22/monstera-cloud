"use client";

import Link from "next/link";
import { RefreshCw, Loader2 } from "lucide-react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";

type StatusHeroProps = {
    workspaceName: string;
    todayLabel: string;
    healthyCount: number;
    totalPipelines: number;
    lastSyncLabel: string | null;
    onSyncAll: () => void;
    syncing: boolean;
};

export function StatusHero({
    workspaceName,
    todayLabel,
    healthyCount,
    totalPipelines,
    lastSyncLabel,
    onSyncAll,
    syncing,
}: StatusHeroProps) {
    const allHealthy = totalPipelines > 0 && healthyCount === totalPipelines;
    const summary =
        totalPipelines === 0
            ? "No pipelines yet. Connect a source and destination to sync."
            : `${healthyCount} of ${totalPipelines} sync${totalPipelines === 1 ? "" : "s"} healthy${allHealthy ? "." : " — check failed pipelines in Reports."}`;

    return (
        <div className="relative z-10 mb-8 flex flex-col gap-4 border-b border-gray-200/80 pb-8 dark:border-slate-700/80 sm:flex-row sm:items-start sm:justify-between">
            <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{workspaceName}</p>
                <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                    Today, {todayLabel}
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
                    {summary}{" "}
                    {lastSyncLabel ? (
                        <>
                            Last sync <span className="font-medium text-gray-800 dark:text-slate-200">{lastSyncLabel}</span>.
                        </>
                    ) : null}
                </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <Link
                    href="/reports"
                    className="text-sm font-semibold text-cyan-700 underline dark:text-cyan-300"
                >
                    See all logs
                </Link>
                <PrimaryButton
                    type="button"
                    onClick={onSyncAll}
                    disabled={syncing || totalPipelines === 0}
                    className="inline-flex items-center gap-2"
                >
                    {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Sync all
                </PrimaryButton>
            </div>
        </div>
    );
}
