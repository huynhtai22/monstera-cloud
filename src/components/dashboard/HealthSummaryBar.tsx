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
                        className="h-8 w-40 animate-pulse rounded-xl bg-gray-100 dark:bg-[#16181c]"
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
                ? "text-emerald-700 bg-gradient-to-br from-emerald-50 to-emerald-50/60 border-emerald-200 dark:text-emerald-300 dark:from-emerald-500/10 dark:to-emerald-500/5 dark:border-emerald-500/30 shadow-sm dark:shadow-emerald-950/20"
                : "text-amber-700 bg-gradient-to-br from-amber-50 to-amber-50/60 border-amber-200 dark:text-amber-300 dark:from-amber-500/10 dark:to-amber-500/5 dark:border-amber-500/30 shadow-sm dark:shadow-amber-950/20",
        },
        {
            icon: <Activity className="h-3.5 w-3.5" />,
            label: `${overall.totalConnections ?? 0} streams operational`,
            className:
                "text-indigo-700 bg-gradient-to-br from-indigo-50 to-indigo-50/60 border-indigo-200 dark:text-indigo-300 dark:from-indigo-500/10 dark:to-indigo-500/5 dark:border-indigo-500/30 shadow-sm dark:shadow-indigo-950/20",
        },
        {
            icon: <BarChart3 className="h-3.5 w-3.5" />,
            label: `${weeklyRows.toLocaleString()} rows this week`,
            className:
                "text-gray-700 bg-gradient-to-br from-gray-50 to-gray-50/60 border-gray-200 dark:text-gray-300 dark:from-slate-800/60 dark:to-slate-700/40 dark:border-[#2f3336] shadow-sm dark:shadow-slate-950/10",
        },
    ];

    return (
        <div className="flex flex-wrap items-center gap-3">
            {chips.map((chip, idx) => (
                <span
                    key={chip.label}
                    className={cn(
                        "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition-all duration-300",
                        "hover:shadow-md hover:scale-105 hover:-translate-y-0.5",
                        chip.className,
                        "pillar-fade"
                    )}
                    style={{ animationDelay: `${idx * 60}ms` }}
                >
                    {chip.icon}
                    {chip.label}
                </span>
            ))}
            <Link
                href="/ops"
                className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 transition-all duration-200 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:gap-2 group"
            >
                Full system view
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </Link>
        </div>
    );
}
