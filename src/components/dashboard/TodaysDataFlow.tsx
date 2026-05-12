"use client";

import useSWR from "swr";
import { Database, ArrowRight, TrendingUp, CheckCircle2 } from "lucide-react";
import { useResolvedWorkspaceId } from "@/hooks/use-resolved-workspace-id";
import { cn } from "@/lib/utils";
import Link from "next/link";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface SyncLog {
    id: string;
    status: string;
    rowsSynced: number;
    createdAt: string;
    pipeline: {
        id: string;
        name: string;
        sourceConnectionId: string;
    };
}

function getSourceProvider(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes("facebook") || lower.includes("meta")) return "Meta";
    if (lower.includes("tiktok")) return "TikTok";
    if (lower.includes("google")) return "Google";
    if (lower.includes("shopify")) return "Shopify";
    if (lower.includes("shopee")) return "Shopee";
    if (lower.includes("lazada")) return "Lazada";
    return "Other";
}

function getSourceColor(provider: string): string {
    const colors: Record<string, string> = {
        Meta: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
        TikTok: "bg-black text-white dark:bg-gray-800",
        Google: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
        Shopify: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
        Shopee: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
        Lazada: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
        Other: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    };
    return colors[provider] || colors.Other;
}

export function TodaysDataFlow() {
    const { workspaceId } = useResolvedWorkspaceId();
    const { data, isLoading } = useSWR(
        workspaceId ? `/api/sync-logs?workspaceId=${workspaceId}&status=success` : null,
        fetcher,
        { refreshInterval: 30000 }
    );

    const shell =
        "relative overflow-hidden rounded-3xl border border-gray-200/90 bg-white p-6 shadow-sm ring-1 ring-black/[0.03] dark:border-slate-700/70 dark:bg-slate-900/40 dark:ring-white/[0.05] sm:p-7";

    if (isLoading) {
        return (
            <div className={shell}>
                <div className="flex items-center gap-3 text-sm font-semibold text-gray-700 dark:text-slate-200">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/15 to-teal-500/10 text-cyan-600 dark:from-cyan-400/20 dark:to-teal-500/5 dark:text-cyan-300">
                        <Database className="h-5 w-5" />
                    </span>
                    Today&apos;s data flow
                </div>
                <div className="mt-4 h-8 w-32 animate-pulse rounded bg-gray-100 dark:bg-[#16181c]" />
            </div>
        );
    }

    const logs: SyncLog[] = data?.logs ?? [];

    // Filter to today's logs only
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLogs = logs.filter((log) => new Date(log.createdAt) >= today);

    // Calculate totals
    const totalRows = todayLogs.reduce((sum, log) => sum + (log.rowsSynced || 0), 0);

    // Group by source provider
    const bySource: Record<string, number> = {};
    todayLogs.forEach((log) => {
        const provider = getSourceProvider(log.pipeline.name);
        bySource[provider] = (bySource[provider] || 0) + (log.rowsSynced || 0);
    });

    // Last sync time
    const lastSync = todayLogs[0]?.createdAt
        ? new Date(todayLogs[0].createdAt)
        : null;
    const lastSyncText = lastSync
        ? lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : null;

    // If no data today
    if (todayLogs.length === 0) {
        return (
            <div className={shell}>
                <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-500/10" />
                <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/20 to-teal-500/10 text-cyan-700 shadow-inner dark:from-cyan-400/25 dark:to-teal-500/10 dark:text-cyan-200">
                            <Database className="h-5 w-5" />
                        </span>
                        <div>
                            <p className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Today&apos;s data flow</p>
                            <p className="mt-1 max-w-md text-sm text-gray-500 dark:text-slate-400">
                                Row volume from successful syncs today. Connect sources and run a pipeline to see numbers here.
                            </p>
                        </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-amber-200/80 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200">
                        No syncs yet today
                    </span>
                </div>
                <Link
                    href="/sources"
                    className="relative mt-5 inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                >
                    Go to Sources
                    <ArrowRight className="h-4 w-4" />
                </Link>
            </div>
        );
    }

    return (
        <div className={shell}>
            <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-emerald-400/10 blur-3xl dark:bg-emerald-500/10" />
            <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/20 to-teal-500/10 text-cyan-700 dark:from-cyan-400/25 dark:to-teal-500/10 dark:text-cyan-200">
                        <Database className="h-5 w-5" />
                    </span>
                    <div>
                        <p className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Today&apos;s data flow</p>
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">Synced rows in your timezone</p>
                    </div>
                </div>
                {lastSyncText && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/90 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-200">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Last sync {lastSyncText}
                    </span>
                )}
            </div>

            {/* Total row count */}
            <div className="relative mt-6 flex flex-wrap items-end gap-3 rounded-2xl bg-gray-50/90 px-5 py-4 dark:bg-slate-800/40">
                <span className="text-3xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-white">
                    {totalRows.toLocaleString()}
                </span>
                <span className="pb-1 text-sm font-medium text-gray-500 dark:text-slate-400">records synced today</span>
                <TrendingUp className="ml-auto h-5 w-5 text-emerald-500 dark:text-emerald-400" />
            </div>

            {/* Source breakdown */}
            {Object.keys(bySource).length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                    {Object.entries(bySource).map(([provider, count]) => (
                        <span
                            key={provider}
                            className={cn(
                                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium",
                                getSourceColor(provider)
                            )}
                        >
                            {provider}: {count.toLocaleString()}
                        </span>
                    ))}
                </div>
            )}

            <Link
                href="/sources"
                className="relative mt-5 inline-flex items-center gap-2 text-sm font-semibold text-cyan-700 hover:text-cyan-800 dark:text-cyan-400 dark:hover:text-cyan-300"
            >
                View source details
                <ArrowRight className="h-4 w-4" />
            </Link>
        </div>
    );
}
