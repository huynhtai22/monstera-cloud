"use client";

import Link from "next/link";
import useSWR from "swr";
import { Users, Activity, BarChart3, ArrowRight } from "lucide-react";
import { useResolvedWorkspaceId } from "@/hooks/use-resolved-workspace-id";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function HealthSummaryBar() {
    const { workspaceId } = useResolvedWorkspaceId();
    const { data, isLoading } = useSWR(
        workspaceId ? `/api/workspaces/${workspaceId}/health-stats` : null,
        fetcher,
        { refreshInterval: 30000 }
    );

    if (isLoading) {
        return (
            <div className="flex flex-wrap gap-2">
                {[1, 2, 3].map((i) => (
                    <div
                        key={i}
                        className="h-8 w-40 animate-pulse rounded-xl bg-gray-100 dark:bg-slate-800"
                    />
                ))}
            </div>
        );
    }

    const { overall = {}, chartData = [] } = data || {};
    const weeklyRows: number = (chartData as { count: number }[]).reduce(
        (acc, curr) => acc + curr.count,
        0
    );
    const allHealthy =
        (overall.totalClients ?? 0) > 0 &&
        overall.healthyClients === overall.totalClients;

    const chips = [
        {
            icon: <Users className="h-3.5 w-3.5" />,
            label: `${overall.healthyClients ?? 0}/${overall.totalClients ?? 0} clients healthy`,
            className: allHealthy
                ? "text-cyan-700 bg-cyan-50 border-cyan-200 dark:text-cyan-300 dark:bg-cyan-500/10 dark:border-cyan-500/30"
                : "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-500/10 dark:border-amber-500/30",
        },
        {
            icon: <Activity className="h-3.5 w-3.5" />,
            label: `${overall.totalConnections ?? 0} streams operational`,
            className:
                "text-indigo-700 bg-indigo-50 border-indigo-200 dark:text-indigo-300 dark:bg-indigo-500/10 dark:border-indigo-500/30",
        },
        {
            icon: <BarChart3 className="h-3.5 w-3.5" />,
            label: `${weeklyRows.toLocaleString()} rows this week`,
            className:
                "text-gray-600 bg-gray-50 border-gray-200 dark:text-gray-300 dark:bg-slate-800 dark:border-slate-700",
        },
    ];

    return (
        <div className="flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
                <span
                    key={chip.label}
                    className={cn(
                        "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold",
                        chip.className
                    )}
                >
                    {chip.icon}
                    {chip.label}
                </span>
            ))}
            <Link
                href="/ops"
                className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-gray-400 transition-colors hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
            >
                Full system view
                <ArrowRight className="h-3 w-3" />
            </Link>
        </div>
    );
}
