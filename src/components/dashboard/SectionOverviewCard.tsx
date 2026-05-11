"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { secondaryButtonLinkClassName } from "@/components/ui/SecondaryButton";

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
    /** Optional per-card accent (helps differentiate sections in dark mode). */
    accent?: "cyan" | "indigo" | "emerald" | "amber" | "rose" | "slate";
    footerSlot?: React.ReactNode;
};

function StatusDot({ status, isStale }: { status?: OverviewStatus; isStale?: boolean }) {
    const label =
        status === "ok" ? "Connected" :
        status === "error" ? "Error" :
        status === "pending" ? "Pending" :
        "Idle";
    
    if (status === "ok" && !isStale) return (
        <span className="pulse-healthy inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full">
            <CheckCircle2 aria-label={label} className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
        </span>
    );
    if (status === "ok" && isStale) return (
        <span className="pulse-stale inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full">
            <CheckCircle2 aria-label={label} className="h-3.5 w-3.5 text-amber-500" />
        </span>
    );
    if (status === "error") return (
        <span className="pulse-error inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full">
            <AlertCircle aria-label={label} className="h-3.5 w-3.5 text-red-500" />
        </span>
    );
    if (status === "pending") return (
        <span className="pulse-stale inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full">
            <Circle aria-label={label} className="h-3.5 w-3.5 text-amber-500" />
        </span>
    );
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
    accent = "slate",
    footerSlot,
}: SectionOverviewCardProps) {
    const titleId = `section-${title.replace(/\s+/g, "-").toLowerCase()}`;
    const safeItems = items ?? [];
    const hasItems = Array.isArray(items) && items.length > 0;

    const hasError = Array.isArray(items) && items.some((i) => i.status === "error");

    const accentBarClass = {
        cyan: "from-cyan-500 via-teal-400 to-emerald-500",
        indigo: "from-indigo-500 via-violet-500 to-fuchsia-500",
        emerald: "from-emerald-500 via-lime-400 to-teal-400",
        amber: "from-amber-500 via-orange-400 to-rose-400",
        rose: "from-rose-500 via-pink-500 to-fuchsia-500",
        slate: "from-slate-400 via-slate-300 to-slate-400 dark:from-slate-600 dark:via-slate-500 dark:to-slate-600",
    }[accent];

    return (
        <section
            aria-labelledby={titleId}
            className={cn(
                "group relative flex h-full min-w-0 flex-col overflow-hidden rounded-3xl border shadow-sm transition-shadow duration-300 hover:shadow-lg",
                "bento-hover pillar-fade",
                emphasis
                    ? "border-cyan-200/85 bg-gradient-to-br from-cyan-50/60 via-white to-white ring-1 ring-cyan-500/15 dark:border-cyan-500/35 dark:from-cyan-950/45 dark:via-slate-900 dark:to-slate-950 dark:ring-cyan-400/10"
                    : "border-gray-200/90 bg-white ring-black/[0.03] dark:border-slate-700/75 dark:bg-slate-900/55 dark:ring-white/[0.06]",
                hasError && "animate-[errorPulse_2s_ease-in-out_infinite]",
                className,
            )}
        >
            {emphasis ? (
                <div
                    className={cn("h-1 w-full shrink-0 bg-gradient-to-r", accentBarClass)}
                    aria-hidden
                />
            ) : (
                <div
                    className="h-px w-full shrink-0 bg-gradient-to-r from-transparent via-gray-200 to-transparent dark:via-slate-600/70"
                    aria-hidden
                />
            )}

            {/* Hover wash (pipelines card) */}
            {emphasis && (
                <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-br from-cyan-400/0 to-teal-500/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-hover:from-cyan-400/10 dark:group-hover:from-cyan-400/15" />
            )}

            <div className="relative z-10 flex flex-1 flex-col px-5 pb-5 pt-4">
                {/* Header: icon + title on one row, KPI chip + subtitle on next row */}
                <div className="mb-3">
                    <div className="flex items-center gap-2">
                        <div
                            className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border shadow-sm transition-all",
                                "group-hover:shadow-md group-hover:scale-110 duration-300",
                                emphasis
                                    ? "border-cyan-200 bg-gradient-to-br from-cyan-100/80 to-cyan-50/60 text-cyan-700 dark:border-cyan-500/30 dark:from-cyan-500/20 dark:to-cyan-500/5 dark:text-cyan-300"
                                    : "border-gray-200 bg-gradient-to-br from-gray-100 to-white text-gray-700 dark:border-[#2f3336] dark:from-slate-800 dark:to-slate-700/80 dark:text-slate-200",
                                accentClassName
                            )}
                        >
                            {icon}
                        </div>
                        <h3 id={titleId} className="min-w-0 flex-1 text-base font-semibold leading-tight tracking-tight text-gray-900 dark:text-white">
                            {title}
                        </h3>
                    </div>
                    {/* Second row: subtitle left, KPI chip right */}
                    <div className="mt-2 flex items-center justify-between gap-2 pl-10">
                        {subtitle ? (
                            <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
                        ) : <span />}
                        {kpi ? (
                            <div
                                className={cn(
                                    "shrink-0 rounded-lg border px-2.5 py-1 text-right",
                                    "border-gray-200/80 bg-white/60 shadow-sm backdrop-blur-sm dark:border-[#2f3336]/60 dark:bg-[#000000]/50",
                                )}
                            >
                                <div
                                    className={cn(
                                        "text-base font-semibold leading-none tabular-nums [font-variant-numeric:tabular-nums]",
                                        kpi.label.toLowerCase().includes("healthy") || kpi.label.toLowerCase().includes("connected") || kpi.label.toLowerCase().includes("success")
                                            ? "text-emerald-700 dark:text-emerald-300"
                                            : "text-gray-900 dark:text-white"
                                    )}
                                >
                                    {kpi.value}
                                </div>
                                <div className="text-[9px] font-semibold uppercase leading-none tracking-wider text-gray-400 dark:text-gray-500 mt-0.5">
                                    {kpi.label}
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>

                {hasItems ? (
                    <ul className="mb-4 flex flex-col gap-0.5">
                        {safeItems.slice(0, 3).map((item) => (
                            <li
                                key={item.id}
                                className="flex items-center gap-2 rounded-xl px-2 py-2 transition-colors hover:bg-gray-50/90 dark:hover:bg-slate-800/50"
                                title={item.sub}
                            >
                                {/* Logo or status dot */}
                                <div className="relative shrink-0">
                                    {item.logoSrc ? (
                                        <>
                                            <div className="relative flex h-6 w-6 items-center justify-center rounded-md bg-white p-0.5 shadow-sm dark:bg-white">
                                                <img
                                                    src={item.logoSrc}
                                                    alt=""
                                                    width={16}
                                                    height={16}
                                                    className="h-4 w-4 object-contain"
                                                />
                                            </div>
                                            {item.accountCount && item.accountCount > 1 && (
                                                <span className="absolute -right-1.5 -top-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-cyan-500 px-0.5 text-[7px] font-bold text-white shadow-sm">
                                                    {item.accountCount}
                                                </span>
                                            )}
                                        </>
                                    ) : (
                                        <StatusDot status={item.status} isStale={item.sub?.includes("may need attention")} />
                                    )}
                                </div>
                                {/* Label + sub stacked */}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <span className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">{item.label}</span>
                                        {item.logoSrc && (
                                            <StatusDot status={item.status} isStale={item.sub?.includes("may need attention")} />
                                        )}
                                    </div>
                                    {item.sub ? (
                                        <p
                                            className={cn(
                                                "truncate text-[10px] leading-tight mt-0.5",
                                                item.status === "error"
                                                    ? "text-red-500 dark:text-red-400"
                                                    : item.status === "pending"
                                                        ? "text-amber-600 dark:text-amber-400"
                                                        : "text-gray-400 dark:text-gray-500"
                                            )}
                                        >
                                            {item.sub}
                                        </p>
                                    ) : null}
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
                        {emptyHint ?? "Nothing connected yet."}
                    </p>
                )}
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-100/90 pt-4 dark:border-slate-700/60">
                    {ctaHref && ctaLabel ? (
                        <Link href={ctaHref} className={"inline-flex items-center gap-1.5 text-sm font-semibold " + secondaryButtonLinkClassName}>
                            {ctaLabel}
                            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                    ) : (
                        <span />
                    )}
                    {footerSlot ? <div className="shrink-0">{footerSlot}</div> : null}
                </div>
            </div>
        </section>
    );
}
