"use client";

import React from 'react';
import useSWR from "swr";
import { FileText, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { cn } from "@/lib/utils";

export default function ReportsPage() {
    const { activeWorkspaceId } = useWorkspaceStore();
    const [filter, setFilter] = React.useState<"all" | "success" | "error">("all");

    const fetcher = async (url: string) => {
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load");
        return data;
    };

    const statusQuery = filter === "all" ? "" : `&status=${filter}`;
    const { data, error, isLoading } = useSWR(
        activeWorkspaceId ? `/api/sync-logs?workspaceId=${activeWorkspaceId}${statusQuery}` : null,
        fetcher
    );

    const logs = (data?.logs ?? []) as Array<{
        id: string;
        status: string;
        rowsSynced: number;
        durationMs: number;
        errorMsg?: string | null;
        createdAt: string;
        pipeline: { id: string; name: string };
    }>;

    return (
        <div className="relative max-w-7xl mx-auto px-8 py-10 w-full animate-in fade-in duration-300">
            <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-[0%] right-[10%] w-[40%] h-[40%] rounded-full bg-indigo-200/20 dark:bg-indigo-900/20 blur-[120px]" />
                <div className="absolute bottom-[10%] left-[0%] w-[50%] h-[50%] rounded-full bg-emerald-200/20 dark:bg-emerald-900/20 blur-[120px]" />
            </div>

            <div className="mb-8 relative z-10">
                <div className="flex items-center space-x-3 mb-2">
                    <div className="w-10 h-10 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md border border-white dark:border-slate-700/60 rounded-xl flex items-center justify-center shadow-sm text-indigo-600">
                        <FileText className="w-5 h-5" />
                    </div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">Reports & Logs</h1>
                </div>
                <p className="text-gray-500 dark:text-gray-400 text-sm max-w-2xl">
                    Audit data throughput, investigate failed syncs, and monitor your total rows.
                </p>
            </div>

            <div className="relative z-10 rounded-3xl border border-white bg-white/40 p-6 shadow-sm backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-900/40">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Sync Logs</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Last 100 syncs in this workspace.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {(["all", "success", "error"] as const).map((v) => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => setFilter(v)}
                                className={cn(
                                    "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                                    filter === v
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-800"
                                )}
                            >
                                {v === "all" ? "All" : v === "success" ? "Success" : "Error"}
                            </button>
                        ))}
                    </div>
                </div>

                {isLoading ? (
                    <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Loading logs…</div>
                ) : error ? (
                    <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-200">
                        <AlertCircle className="h-4 w-4" />
                        Failed to load sync logs.
                    </div>
                ) : logs.length === 0 ? (
                    <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">No sync logs yet.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 text-xs font-bold uppercase tracking-wide text-gray-400 dark:border-slate-700 dark:text-gray-500">
                                    <th className="py-3 pr-4">Pipeline</th>
                                    <th className="py-3 pr-4">Status</th>
                                    <th className="py-3 pr-4">Rows</th>
                                    <th className="py-3 pr-4">Duration</th>
                                    <th className="py-3 pr-4">When</th>
                                    <th className="py-3">Error</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((l) => (
                                    <tr key={l.id} className="border-b border-gray-50 dark:border-slate-800">
                                        <td className="py-3 pr-4 font-semibold text-gray-900 dark:text-white">{l.pipeline?.name ?? "Pipeline"}</td>
                                        <td className="py-3 pr-4">
                                            {l.status === "success" ? (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
                                                    <CheckCircle2 className="h-3.5 w-3.5" /> Success
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs font-bold text-red-700 dark:bg-red-950/20 dark:text-red-200">
                                                    <AlertCircle className="h-3.5 w-3.5" /> Error
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-3 pr-4 text-gray-700 dark:text-gray-200">{l.rowsSynced ?? 0}</td>
                                        <td className="py-3 pr-4 text-gray-700 dark:text-gray-200">{Math.round((l.durationMs ?? 0) / 100) / 10}s</td>
                                        <td className="py-3 pr-4 text-gray-500 dark:text-gray-400">
                                            <span className="inline-flex items-center gap-1">
                                                <Clock className="h-3.5 w-3.5" />
                                                {new Date(l.createdAt).toLocaleString()}
                                            </span>
                                        </td>
                                        <td className="py-3 text-gray-500 dark:text-gray-400">{l.errorMsg ?? ""}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
