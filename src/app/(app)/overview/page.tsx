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
import { HealthDashboard } from "@/components/HealthDashboard";

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
    const [syncingPipelineId, setSyncingPipelineId] = React.useState<string | null>(null);
    const [syncMsg, setSyncMsg] = React.useState<string>("");
    const { data: pipelines, error, isLoading } = useSWR(
        activeWorkspaceId ? `/api/pipelines?workspaceId=${activeWorkspaceId}` : null,
        fetcher
    );

    const activePipelinesCount = Array.isArray(pipelines) ? pipelines.length : 0;

    const { data: workspaces } = useSWR("/api/workspaces", fetcher);

    const { data: attributionData } = useSWR(
        activeWorkspaceId ? `/api/attribution/snapshots?workspaceId=${activeWorkspaceId}&days=14` : null,
        fetcher
    );
    const snapshots = (attributionData?.snapshots ?? []) as Array<{ date: string; netRoas: number; adSpend: number; attributedRevenue: number }>;
    const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;

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

    const runPipeline = async (pipelineId: string) => {
        setSyncMsg("");
        setSyncingPipelineId(pipelineId);
        try {
            const res = await fetch(`/api/pipelines/${pipelineId}/run`, { method: "POST" });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(typeof data.error === "string" ? data.error : "Sync failed");
            }
            setSyncMsg(typeof data.message === "string" ? data.message : "Sync started.");
        } catch (e: any) {
            setSyncMsg(e?.message || "Sync failed");
        } finally {
            setSyncingPipelineId(null);
        }
    };

    return (
        <div className="relative mx-auto w-full max-w-7xl animate-in px-8 py-10 fade-in duration-300">
            <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
                <div className="absolute left-[10%] top-[-10%] h-[50%] w-[50%] rounded-full bg-emerald-200/20 blur-[120px] dark:bg-emerald-900/20" />
                <div className="absolute right-[0%] top-[30%] h-[60%] w-[40%] rounded-full bg-blue-200/20 blur-[120px] dark:bg-blue-900/20" />
            </div>

            <div className="relative z-10 mb-10 flex flex-col justify-between space-y-4 sm:flex-row sm:items-start sm:space-y-0">
                <div>
                    <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                        Agency Command Center
                    </h1>
                    <p className="max-w-2xl text-base text-gray-600 dark:text-gray-400">
                        Monitor health across your entire client portfolio. Real-time data freshness and throughput monitoring.
                    </p>
                </div>
                <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-600 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400">
                    <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                    Infrastructure Stable
                </span>
            </div>

            {syncMsg ? (
                <div className="relative z-10 mb-6 rounded-lg border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                    {syncMsg}
                </div>
            ) : null}

            {/* LIVE HEALTH DASHBOARD */}
            <div className="relative z-10 mb-12">
                <HealthDashboard />
            </div>

            <div className="relative z-10 mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
                <div className="rounded-2xl border border-white bg-white/40 p-6 shadow-sm backdrop-blur-xl dark:border-slate-700/40 dark:bg-slate-900/40 md:col-span-2">
                    <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-bold text-gray-900 dark:text-white">Net ROAS (last 14 days)</div>
                        <Link href="/reports" className="text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300">
                            View reports
                        </Link>
                    </div>
                    {!latest ? (
                        <div className="text-sm text-gray-500 dark:text-gray-400">No attribution data yet.</div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            <div className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                                {Number(latest.netRoas ?? 0).toFixed(2)}
                                <span className="ml-2 text-sm font-semibold text-gray-400 dark:text-gray-500">Net ROAS</span>
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                Latest: {new Date(latest.date).toLocaleDateString()} • Spend {Number(latest.adSpend ?? 0).toFixed(2)} • Revenue {Number(latest.attributedRevenue ?? 0).toFixed(2)}
                            </div>
                        </div>
                    )}
                </div>

                <div className="rounded-2xl border border-white bg-white/40 p-6 shadow-sm backdrop-blur-xl dark:border-slate-700/40 dark:bg-slate-900/40">
                    <div className="text-sm font-bold text-gray-900 dark:text-white">Attribution Model</div>
                    <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">Time-decay</div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Weights decay with a 24h half-life.</div>
                </div>
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

                                            <div className="mt-2">
                                                <button
                                                    type="button"
                                                    onClick={() => runPipeline(pipeline.id)}
                                                    disabled={syncingPipelineId === pipeline.id}
                                                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-800"
                                                >
                                                    {syncingPipelineId === pipeline.id ? (
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    ) : (
                                                        <Zap className="h-3.5 w-3.5" />
                                                    )}
                                                    Sync now
                                                </button>
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
