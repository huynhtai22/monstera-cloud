"use client";

import React from "react";
import Link from "next/link";
import {
    Activity,
    Database,
    Clock,
    AlertCircle,
    Loader2,
    CheckCircle2,
    Circle,
    ListChecks,
    Zap,
    ArrowRight,
} from "lucide-react";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { cn } from "@/lib/utils";
import { primaryButtonLinkClassName } from "@/components/ui/PrimaryButton";
import { secondaryButtonLinkClassName } from "@/components/ui/SecondaryButton";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || "Failed to fetch data");
    }
    return data;
};

export default function OverviewPage() {
    const { activeWorkspaceId } = useWorkspaceStore();
    const { data: pipelines, error, isLoading } = useSWR(
        activeWorkspaceId ? `/api/pipelines?workspaceId=${activeWorkspaceId}` : null,
        fetcher
    );

    const activePipelinesCount = Array.isArray(pipelines) ? pipelines.length : 0;

    const { data: workspaces } = useSWR("/api/workspaces", fetcher);

    const { connectedSourcesCount, connectedDestinationsCount } = React.useMemo(() => {
        if (!Array.isArray(workspaces) || !activeWorkspaceId) {
            return { connectedSourcesCount: 0, connectedDestinationsCount: 0 };
        }
        const ws = workspaces.find((w: any) => w.id === activeWorkspaceId) || workspaces[0];
        const conns = ws?.connections || [];
        return {
            connectedSourcesCount: conns.filter((c: any) => c.type === "source").length,
            connectedDestinationsCount: conns.filter((c: any) => c.type === "destination").length,
        };
    }, [workspaces, activeWorkspaceId]);

    const hasSource = connectedSourcesCount > 0;
    const hasDestination = connectedDestinationsCount > 0;
    const hasPipeline = activePipelinesCount > 0;

    return (
        <div className="relative mx-auto w-full max-w-7xl animate-in px-8 py-10 fade-in duration-300">
            <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
                <div className="absolute left-[10%] top-[-10%] h-[50%] w-[50%] rounded-full bg-emerald-200/20 blur-[120px] dark:bg-emerald-900/20" />
                <div className="absolute right-[0%] top-[30%] h-[60%] w-[40%] rounded-full bg-blue-200/20 blur-[120px] dark:bg-blue-900/20" />
            </div>

            <div className="relative z-10 mb-10 flex flex-col justify-between space-y-4 sm:flex-row sm:items-start sm:space-y-0">
                <div>
                    <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                        Platform Overview
                    </h1>
                    <p className="max-w-2xl text-base text-gray-600 dark:text-gray-400">
                        Monitor your workspace health, recent pipeline activity, and total data throughput.
                    </p>
                </div>
                <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-600 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400">
                    <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                    All Systems Operational
                </span>
            </div>

            <div className="relative z-10 mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
                <div className="group relative overflow-hidden rounded-2xl border border-white bg-white/40 p-6 shadow-sm backdrop-blur-xl transition-all hover:shadow-md dark:border-slate-700/40 dark:bg-slate-900/40">
                    <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-gradient-to-br from-emerald-100 to-transparent opacity-50 blur-2xl transition-transform duration-700 group-hover:scale-150" />
                    <div className="relative mb-4 flex items-start justify-between">
                        <div className="rounded-xl border border-gray-100 bg-white p-2.5 text-gray-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            <Database className="h-5 w-5" />
                        </div>
                    </div>
                    <h3 className="mb-1 text-sm font-medium text-gray-500 dark:text-gray-400">Connected Sources</h3>
                    <p className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">{connectedSourcesCount}</p>
                </div>

                <div className="group relative overflow-hidden rounded-2xl border border-white bg-white/40 p-6 shadow-sm backdrop-blur-xl transition-all hover:shadow-md dark:border-slate-700/40 dark:bg-slate-900/40">
                    <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-gradient-to-br from-blue-100 to-transparent opacity-50 blur-2xl transition-transform duration-700 group-hover:scale-150" />
                    <div className="relative mb-4 flex items-start justify-between">
                        <div className="rounded-xl border border-gray-100 bg-white p-2.5 text-gray-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            <Activity className="h-5 w-5" />
                        </div>
                    </div>
                    <h3 className="mb-1 text-sm font-medium text-gray-500 dark:text-gray-400">Active Pipelines</h3>
                    <p className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                        {isLoading ? "…" : activePipelinesCount}
                        <span className="ml-1 text-lg font-normal text-gray-400 dark:text-gray-500">connected</span>
                    </p>
                </div>

                <div className="group relative overflow-hidden rounded-2xl border border-white bg-white/40 p-6 shadow-sm backdrop-blur-xl transition-all hover:shadow-md dark:border-slate-700/40 dark:bg-slate-900/40">
                    <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-gradient-to-br from-indigo-100 to-transparent opacity-50 blur-2xl transition-transform duration-700 group-hover:scale-150" />
                    <div className="relative mb-4 flex items-start justify-between">
                        <div className="rounded-xl border border-gray-100 bg-white p-2.5 text-gray-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            <Clock className="h-5 w-5" />
                        </div>
                    </div>
                    <h3 className="mb-1 text-sm font-medium text-gray-500 dark:text-gray-400">Workspace Status</h3>
                    <p className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Active</p>
                </div>
            </div>

            <div className="relative z-10 mb-6 rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-4 py-3 text-sm text-gray-600 dark:border-slate-600 dark:bg-slate-800/50 dark:text-gray-400">
                <span className="mr-2 inline-flex items-center rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    Soon
                </span>
                Sync Volume Analytics — charts for row throughput and sync history will appear here when pipeline analytics ship.
            </div>

            <div className="relative z-10 grid grid-cols-1 gap-8 lg:grid-cols-3">
                <div className="flex flex-col gap-6 lg:col-span-2">
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
                            <div className="mb-4 flex items-center gap-2">
                                <ListChecks className="h-5 w-5 text-primary" />
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Getting Started</h3>
                            </div>
                            <ul className="space-y-3">
                                <li className="flex items-start gap-2 text-sm">
                                    {hasSource ? (
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                                    ) : (
                                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
                                    )}
                                    <span className={hasSource ? "text-gray-700 dark:text-gray-200" : "text-gray-500"}>
                                        Connect a data source
                                    </span>
                                </li>
                                <li className="flex items-start gap-2 text-sm">
                                    {hasDestination ? (
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                                    ) : (
                                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
                                    )}
                                    <span className={hasDestination ? "text-gray-700 dark:text-gray-200" : "text-gray-500"}>
                                        Set a destination
                                    </span>
                                </li>
                                <li className="flex items-start gap-2 text-sm">
                                    {hasPipeline ? (
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                                    ) : (
                                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
                                    )}
                                    <span className={hasPipeline ? "text-gray-700 dark:text-gray-200" : "text-gray-500"}>
                                        Deploy a transformation / pipeline
                                    </span>
                                </li>
                                <li className="flex items-start gap-2 text-sm text-gray-400 dark:text-gray-500">
                                    <Circle className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>Schedule sync (coming soon)</span>
                                </li>
                            </ul>
                        </div>

                        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
                            <div className="mb-4 flex items-center gap-2">
                                <Zap className="h-5 w-5 text-primary" />
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Quick Actions</h3>
                            </div>
                            <div className="flex flex-col gap-2">
                                <Link
                                    href="/console"
                                    className={cn(primaryButtonLinkClassName, "w-full justify-between")}
                                >
                                    Connect Source
                                    <ArrowRight className="h-4 w-4" />
                                </Link>
                                <Link
                                    href="/transformations"
                                    className={cn(secondaryButtonLinkClassName, "w-full justify-between")}
                                >
                                    Create Pipeline
                                    <ArrowRight className="h-4 w-4" />
                                </Link>
                                <Link
                                    href="/docs"
                                    className={cn(secondaryButtonLinkClassName, "w-full justify-between")}
                                >
                                    View Docs
                                    <ArrowRight className="h-4 w-4" />
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex h-[400px] flex-col rounded-2xl border border-white bg-white/40 p-6 shadow-sm backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-900/40">
                    <h3 className="mb-1 text-lg font-bold text-gray-900 dark:text-white">Recent Activity</h3>
                    <p className="mb-6 border-b border-gray-100 pb-4 text-sm text-gray-500 dark:border-slate-700 dark:text-gray-400">
                        Latest events from your pipelines.
                    </p>

                    <div className="flex-1 space-y-5 overflow-y-auto pr-2">
                        {isLoading ? (
                            <div className="flex h-full flex-col items-center justify-center py-10 text-center">
                                <Loader2 className="mb-3 h-6 w-6 animate-spin text-emerald-500" />
                                <span className="text-sm text-gray-500">Loading activity...</span>
                            </div>
                        ) : error ? (
                            <div className="flex h-full flex-col items-center justify-center py-10 text-center text-red-500">
                                <AlertCircle className="mb-2 h-6 w-6" />
                                <span className="text-sm">Failed to load activity feed.</span>
                            </div>
                        ) : Array.isArray(pipelines) && pipelines.length > 0 ? (
                            pipelines.map((pipeline: any, index: number) => {
                                const isLast = index === pipelines.length - 1;
                                const isError = pipeline.status === "error";
                                const latestLog = pipeline.logs?.[0];

                                return (
                                    <div key={pipeline.id} className={`flex items-start space-x-3 ${isLast ? "opacity-80" : ""}`}>
                                        <div className="relative mt-1 shrink-0">
                                            <div
                                                className={`h-2.5 w-2.5 rounded-full ${isError ? "bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.1)]" : "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.1)]"}`}
                                            />
                                            {!isLast && (
                                                <div className="absolute bottom-[-16px] left-[5px] top-4 w-px bg-gray-200 dark:bg-slate-700" />
                                            )}
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-gray-900 dark:text-white">
                                                {pipeline.name} {isError ? "Failed" : "Synced"}
                                            </p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                {isError
                                                    ? `Error connecting ${pipeline.sourceConnection?.name} to ${pipeline.destinationConnection?.name}.`
                                                    : latestLog
                                                      ? `Successfully synced ${latestLog.rowsSynced} rows to ${pipeline.destinationConnection?.name}.`
                                                      : `Pipeline established: ${pipeline.sourceConnection?.name} → ${pipeline.destinationConnection?.name}`}
                                            </p>
                                            <div className="mt-1 flex items-center text-[10px] font-bold uppercase text-gray-400 dark:text-gray-500">
                                                <Clock className="mr-1 h-3 w-3" />
                                                {new Date(pipeline.updatedAt).toLocaleTimeString([], {
                                                    hour: "2-digit",
                                                    minute: "2-digit",
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="flex flex-1 flex-col items-center justify-center px-2 py-10 text-center">
                                <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                                    No pipeline runs yet. Connect a source and destination to see sync activity here.
                                </p>
                                <Link href="/console" className={cn(primaryButtonLinkClassName, "text-sm")}>
                                    Go to Data Sources
                                </Link>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
