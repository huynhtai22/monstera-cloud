"use client";

import Link from "next/link";
import { RefreshCw, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { PrimaryButton, primaryButtonLinkClassName } from "@/components/ui/PrimaryButton";
import { secondaryButtonLinkClassName } from "@/components/ui/SecondaryButton";

type StatusHeroProps = {
    workspaceName: string;
    todayLabel: string;
    healthyCount: number;
    totalPipelines: number;
    lastSyncLabel: string | null;
    lastSyncDate?: Date | null;
    onSyncAll: () => void;
    syncing: boolean;
};

export function StatusHero({
    workspaceName,
    todayLabel,
    healthyCount,
    totalPipelines,
    lastSyncLabel,
    lastSyncDate,
    onSyncAll,
    syncing,
}: StatusHeroProps) {
    const allHealthy = totalPipelines > 0 && healthyCount === totalPipelines;
    const failedCount = totalPipelines - healthyCount;

    // D5: stale if no sync in >24h
    const isStale = lastSyncDate
        ? Date.now() - lastSyncDate.getTime() > 24 * 60 * 60 * 1000
        : false;

    const summary =
        totalPipelines === 0
            ? "No pipelines yet. Connect a source and destination to sync."
            : allHealthy
              ? `All ${totalPipelines} pipeline${totalPipelines === 1 ? "" : "s"} healthy.`
              : `${failedCount} of ${totalPipelines} pipeline${totalPipelines === 1 ? "" : "s"} need attention.`;

    return (
        <div className="relative z-10 mb-8 flex flex-col gap-4 border-b border-gray-200/80 pb-8 dark:border-slate-700/80 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{workspaceName}</p>
                <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                    Today, {todayLabel}
                </h1>

                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Monstera moves ad and marketplace data into Google Sheets &amp; Looker Studio — managed pipelines and automatic syncs.</p>

                {/* D2: Colour-coded health pill */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {totalPipelines === 0 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                            No pipelines yet
                        </span>
                    ) : allHealthy ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                            <CheckCircle2 className="h-3 w-3" />
                            {summary}
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300">
                            <AlertTriangle className="h-3 w-3" />
                            {summary}
                            <Link href="/reports" className={"ml-1 " + secondaryButtonLinkClassName}>
                                See logs →
                            </Link>
                        </span>
                    )}

                    {/* D5: stale sync warning */}
                    {isStale && lastSyncLabel && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300">
                            <AlertTriangle className="h-3 w-3" />
                            Last sync was {lastSyncLabel} — pipelines may be paused
                        </span>
                    )}

                    {lastSyncLabel && !isStale && (
                        <span className="text-xs text-gray-400 dark:text-slate-500">
                            Last sync{" "}
                            <span className="font-medium text-gray-600 dark:text-slate-300">{lastSyncLabel}</span>
                        </span>
                    )}
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                <Link href="/reports" className="text-sm font-semibold text-cyan-700 underline dark:text-cyan-300">
                    See all logs
                </Link>
                <PrimaryButton
                    type="button"
                    onClick={onSyncAll}
                    disabled={syncing || totalPipelines === 0}
                    title={totalPipelines > 0 ? `Manually trigger all ${totalPipelines} pipelines` : undefined}
                    className="inline-flex items-center gap-2"
                >
                    {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Sync all
                </PrimaryButton>
            </div>
        </div>
    );
}
