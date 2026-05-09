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

    if (isLoading) {
        return (
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-[#2f3336] dark:bg-[#000000]">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-slate-400">
                    <Database className="h-4 w-4" />
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
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-[#2f3336] dark:bg-[#000000]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-slate-400">
                        <Database className="h-4 w-4" />
                        Today&apos;s data flow
                    </div>
                    <span className="text-xs text-gray-400 dark:text-slate-500">No syncs yet today</span>
                </div>
                <Link
                    href="/sources"
                    className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300"
                >
                    Go to Sources
                    <ArrowRight className="h-3 w-3" />
                </Link>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-[#2f3336] dark:bg-[#000000]">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-slate-400">
                    <Database className="h-4 w-4" />
                    Today&apos;s data flow
                </div>
                {lastSyncText && (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Last sync {lastSyncText}
                    </span>
                )}
            </div>

            {/* Total row count */}
            <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-gray-900 dark:text-white">
                    {totalRows.toLocaleString()}
                </span>
                <span className="text-sm text-gray-500 dark:text-slate-400">records synced</span>
                <TrendingUp className="ml-auto h-4 w-4 text-emerald-500" />
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
                className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300"
            >
                View source details
                <ArrowRight className="h-3 w-3" />
            </Link>
        </div>
    );
}
