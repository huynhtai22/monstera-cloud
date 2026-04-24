"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type OverviewStatus = "ok" | "pending" | "error" | "neutral";

export type OverviewLineItem = {
    id: string;
    label: string;
    sub?: string;
    logoSrc?: string;
    status?: OverviewStatus;
    /** P1: Account count for multi-account sources (e.g., Meta with 3 ad accounts) */
    accountCount?: number;
    /** P1: First account hint for quick identification */
    accountHint?: string;
};

type SectionOverviewCardProps = {
    icon: React.ReactNode;
    title: string;
    subtitle?: string;
    kpi?: { label: string; value: string };
    items?: OverviewLineItem[];
    emptyHint?: string;
    ctaLabel?: string;
    ctaHref?: string;
    accentClassName?: string;
    className?: string;
    emphasis?: boolean;
    footerSlot?: React.ReactNode;
};

function StatusDot({ status, isStale }: { status?: OverviewStatus; isStale?: boolean }) {
    const label =
        status === "ok" ? "Connected" :
        status === "error" ? "Error" :
        status === "pending" ? "Pending" :
        "Idle";
    
    // P1: Pulse animation for error and stale states to draw attention
    const pulseClass = (status === "error" || isStale) ? "animate-pulse" : "";
    
    if (status === "ok") return <CheckCircle2 aria-label={label} className={cn("h-3.5 w-3.5 shrink-0 text-cyan-500 dark:text-cyan-400", pulseClass)} />;
    if (status === "error") return <AlertCircle aria-label={label} className={cn("h-3.5 w-3.5 shrink-0 text-red-500", pulseClass)} />;
    if (status === "pending") return <Circle aria-label={label} className={cn("h-3.5 w-3.5 shrink-0 text-amber-500", pulseClass)} />;
    return <Circle aria-label={label} className="h-3.5 w-3.5 shrink-0 text-gray-300 dark:text-gray-600" />;
}

export function SectionOverviewCard({
    icon,
    title,
    subtitle,
    kpi,
    items,
    emptyHint,
    ctaLabel,
    ctaHref,
    accentClassName,
    className,
    emphasis,
    footerSlot,
}: SectionOverviewCardProps) {
    const hasItems = Array.isArray(items) && items.length > 0;

    return (
        <div
            className={cn(
                "group relative flex h-full flex-col justify-between rounded-2xl border p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
                emphasis
                    ? "border-cyan-200 bg-gradient-to-br from-cyan-50/80 via-white/80 to-white/80 dark:border-cyan-500/30 dark:from-cyan-500/10 dark:via-slate-900/60 dark:to-slate-900/60"
                    : "border-gray-200/80 bg-white/80 dark:border-slate-700/60 dark:bg-slate-900/60",
                className
            )}
        >
            <div>
                <div className="mb-3 space-y-1">
                    <div className="flex items-center gap-2">
                        <div
                            className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border shadow-sm",
                                emphasis
                                    ? "border-cyan-200 bg-cyan-100/70 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300"
                                    : "border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
                                accentClassName
                            )}
                        >
                            {icon}
                        </div>
                        <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900 dark:text-white">{title}</h3>
                        {kpi ? (
                            <div className="shrink-0 text-right">
                                <div className="text-2xl font-black leading-none tracking-tight text-gray-900 dark:text-white">
                                    {kpi.value}
                                </div>
                                <div className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                                    {kpi.label}
                                </div>
                            </div>
                        ) : null}
                    </div>
                    {subtitle ? (
                        <p className="pl-10 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
                    ) : null}
                </div>

                {hasItems ? (
                    <ul className="mb-4 flex flex-col gap-1.5">
                        {items!.slice(0, 3).map((item) => (
                            <li
                                key={item.id}
                                className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm text-gray-700 dark:text-gray-200"
                                title={item.sub} // P1: Tooltip showing full status/sub text
                            >
                                {item.logoSrc ? (
                                    // P1: Logo with account count badge for multi-account sources
                                    <div className="relative shrink-0">
                                        <img
                                            src={item.logoSrc}
                                            alt=""
                                            width={16}
                                            height={16}
                                            className="h-4 w-4 object-contain"
                                        />
                                        {item.accountCount && item.accountCount > 1 && (
                                            <span className="absolute -right-1.5 -top-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-cyan-500 px-0.5 text-[7px] font-bold text-white">
                                                {item.accountCount}
                                            </span>
                                        )}
                                    </div>
                                ) : (
                                    <StatusDot status={item.status} isStale={item.sub?.includes("may need attention")} />
                                )}
                                <span className="truncate font-medium">{item.label}</span>
                                {/* P1: Account hint for quick identification */}
                                {item.accountHint && (
                                    <span className="ml-1 truncate text-[10px] text-gray-400 dark:text-gray-500 max-w-[60px]">
                                        {item.accountHint}
                                    </span>
                                )}
                                {item.sub ? (
                                    <span
                                        className={cn(
                                            "ml-auto truncate text-xs",
                                            item.status === "error"
                                                ? "text-red-500 dark:text-red-400"
                                                : item.status === "pending"
                                                    ? "text-amber-600 dark:text-amber-400"
                                                    : "text-gray-500 dark:text-gray-400"
                                        )}
                                    >
                                        {item.sub}
                                    </span>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                        {emptyHint ?? "Nothing connected yet."}
                    </p>
                )}
            </div>

            <div className="flex items-center justify-between gap-3">
                {ctaHref && ctaLabel ? (
                    <Link
                        href={ctaHref}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-700 transition-colors hover:text-cyan-800 dark:text-cyan-300 dark:hover:text-cyan-200"
                    >
                        {ctaLabel}
                        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                ) : (
                    <div />
                )}
                {footerSlot ? <div className="shrink-0">{footerSlot}</div> : null}
            </div>
        </div>
    );
}
