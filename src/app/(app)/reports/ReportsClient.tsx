"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import { FileText, AlertCircle, CheckCircle2, Clock, Database } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";

const SOURCE_CHIPS: { id: string; label: string }[] = [
    { id: "", label: "All sources" },
    { id: "tiktok_business", label: "TikTok" },
    { id: "meta_ads", label: "Meta" },
    { id: "google_ads", label: "Google" },
    { id: "shopee", label: "Shopee" },
    { id: "shopify", label: "Shopify" },
];

function pipelineMatchesSource(pipelineName: string, sourceId: string): boolean {
    if (!sourceId) return true;
    const n = pipelineName.toLowerCase();
    switch (sourceId) {
        case "tiktok_business":
            return n.includes("tiktok");
        case "meta_ads":
            return n.includes("meta") || n.includes("facebook");
        case "google_ads":
            return n.includes("google");
        case "shopee":
            return n.includes("shopee");
        case "shopify":
            return n.includes("shopify");
        default:
            return true;
    }
}

export function ReportsClient() {
    const { activeWorkspaceId } = useWorkspaceStore();
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const sourceFilter = searchParams.get("source") ?? "";

    const [statusFilter, setStatusFilter] = React.useState<"all" | "success" | "error">("all");

    const fetcher = async (url: string) => {
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load");
        return data;
    };

    const statusQuery = statusFilter === "all" ? "" : `&status=${statusFilter}`;
    const { data, error, isLoading } = useSWR(
        activeWorkspaceId ? `/api/sync-logs?workspaceId=${activeWorkspaceId}${statusQuery}` : null,
        fetcher
    );

    const rawLogs = (data?.logs ?? []) as Array<{
        id: string;
        status: string;
        rowsSynced: number;
        durationMs: number;
        errorMsg?: string | null;
        createdAt: string;
        pipeline: { id: string; name: string };
    }>;

    const logs = React.useMemo(
        () => rawLogs.filter((l) => pipelineMatchesSource(l.pipeline?.name ?? "", sourceFilter)),
        [rawLogs, sourceFilter]
    );

    const setSource = (id: string) => {
        const q = new URLSearchParams(searchParams.toString());
        if (id) q.set("source", id);
        else q.delete("source");
        const qs = q.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    };

    return (
        <PageShell>
            <div className="relative z-10 mb-8">
                <div className="mb-2 flex items-center space-x-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white bg-white/50 text-indigo-600 shadow-sm backdrop-blur-md dark:border-slate-700/60 dark:bg-slate-900/50">
                        <FileText className="h-5 w-5" />
                    </div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">Reports & Logs</h1>
                </div>
                <p className="max-w-2xl text-sm text-gray-500 dark:text-gray-400">
                    Audit data throughput, investigate failed syncs, and monitor your total rows.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                    {SOURCE_CHIPS.map((c) => (
                        <button
                            key={c.id || "all"}
                            type="button"
                            onClick={() => setSource(c.id)}
                            className={cn(
                                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                                sourceFilter === c.id
                                    ? "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-900/40 dark:bg-cyan-950/30 dark:text-cyan-200"
                                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-800"
                            )}
                        >
                            {c.label}
                        </button>
                    ))}
                </div>
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
                                onClick={() => setStatusFilter(v)}
                                className={cn(
                                    "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                                    statusFilter === v
                                        ? "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/40 dark:bg-cyan-950/30 dark:text-cyan-200"
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
                ) : rawLogs.length === 0 ? (
                    <EmptyState
                        icon={<Database className="h-12 w-12" />}
                        title="No sync logs yet"
                        description="Run a sync from Sources after you connect a destination to see rows land here."
                        primaryAction={
                            <Link
                                href="/sources"
                                className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700"
                            >
                                Go to Sources
                            </Link>
                        }
                    />
                ) : logs.length === 0 ? (
                    <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                        No logs match this source filter.{" "}
                        <button type="button" onClick={() => setSource("")} className="font-semibold text-cyan-700 underline dark:text-cyan-300">
                            Clear filter
                        </button>
                    </div>
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
                                                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-1 text-xs font-bold text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-200">
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
        </PageShell>
    );
}
