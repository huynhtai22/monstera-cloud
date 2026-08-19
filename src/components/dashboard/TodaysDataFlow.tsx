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
        "relative overflow-hidden rounded-lg border border-line bg-panel p-6 sm:p-7";

    if (isLoading) {
        return (
            <div className={shell}>
                <div className="flex items-center gap-3 text-xs font-semibold text-ink">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-canvas border border-line text-white">
                        <Database className="h-4 w-4" />
                    </span>
                    Today&apos;s data flow
                </div>
                <div className="mt-4 h-8 w-32 animate-pulse rounded bg-canvas" />
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
                <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-canvas border border-line text-white">
                            <Database className="h-4 w-4" />
                        </span>
                        <div>
                            <p className="text-sm font-semibold tracking-tight text-ink">Today&apos;s data flow</p>
                            <p className="mt-1 max-w-md text-xs text-ink-mute">
                                Row volume from successful refreshes today. Connect a source and choose Sync now to see numbers here.
                            </p>
                        </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-line bg-canvas px-3 py-1 text-[11px] font-semibold text-ink-mute">
                        No syncs yet today
                    </span>
                </div>
                <Link
                    href="/sources"
                    className="relative mt-5 inline-flex items-center gap-1.5 rounded-md bg-white px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-neutral-200 shadow-xs"
                >
                    Go to Sources
                    <ArrowRight className="h-3.5 w-3.5" />
                </Link>
            </div>
        );
    }

    return (
        <div className={shell}>
            <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-canvas border border-line text-white">
                        <Database className="h-4 w-4" />
                    </span>
                    <div>
                        <p className="text-sm font-semibold tracking-tight text-ink">Today&apos;s data flow</p>
                        <p className="mt-0.5 text-xs text-ink-mute">Synced rows in your timezone</p>
                    </div>
                </div>
                {lastSyncText && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-1 text-[11px] font-semibold text-white">
                        <CheckCircle2 className="h-3 w-3" />
                        Last sync {lastSyncText}
                    </span>
                )}
            </div>

            {/* Total row count */}
            <div className="relative mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-canvas px-5 py-4">
                <span className="text-3xl font-bold tabular-nums tracking-tight text-white">
                    {totalRows.toLocaleString()}
                </span>
                <span className="pb-1 text-xs font-medium text-ink-mute">records synced today</span>
                <TrendingUp className="ml-auto h-4 w-4 text-white" />
            </div>

            {/* Source breakdown */}
            {Object.keys(bySource).length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                    {Object.entries(bySource).map(([provider, count]) => (
                        <span
                            key={provider}
                            className={cn(
                                "inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 py-1 text-xs font-medium text-ink",
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
                className="relative mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-white hover:text-neutral-300 transition-colors"
            >
                View source details
                <ArrowRight className="h-3.5 w-3.5" />
            </Link>
        </div>
    );
}
