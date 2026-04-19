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
};

type SectionOverviewCardProps = {
    icon: React.ReactNode;
    title: string;
    subtitle?: string;
    kpi?: { label: string; value: string };
    items?: OverviewLineItem[];
    emptyHint?: string;
    ctaLabel: string;
    ctaHref: string;
    accentClassName?: string;
    className?: string;
};

function StatusDot({ status }: { status?: OverviewStatus }) {
    if (status === "ok") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-cyan-500 dark:text-cyan-400" />;
    if (status === "error") return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />;
    if (status === "pending") return <Circle className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
    return <Circle className="h-3.5 w-3.5 shrink-0 text-gray-300 dark:text-gray-600" />;
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
    accentClassName = "text-primary",
    className,
}: SectionOverviewCardProps) {
    const hasItems = Array.isArray(items) && items.length > 0;

    return (
        <div
            className={cn(
                "group relative flex h-full flex-col justify-between rounded-2xl border border-gray-200/80 bg-white/80 p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700/60 dark:bg-slate-900/60",
                className
            )}
        >
            <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                        <div
                            className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
                                accentClassName
                            )}
                        >
                            {icon}
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-gray-900 dark:text-white">{title}</h3>
                            {subtitle ? (
                                <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
                            ) : null}
                        </div>
                    </div>
                    {kpi ? (
                        <div className="shrink-0 text-right">
                            <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                {kpi.label}
                            </div>
                            <div className="text-lg font-extrabold tracking-tight text-gray-900 dark:text-white">
                                {kpi.value}
                            </div>
                        </div>
                    ) : null}
                </div>

                {hasItems ? (
                    <ul className="mb-4 flex flex-col gap-1.5">
                        {items!.slice(0, 3).map((item) => (
                            <li
                                key={item.id}
                                className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm text-gray-700 dark:text-gray-200"
                            >
                                {item.logoSrc ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={item.logoSrc}
                                        alt=""
                                        width={16}
                                        height={16}
                                        className="h-4 w-4 shrink-0 object-contain"
                                    />
                                ) : (
                                    <StatusDot status={item.status} />
                                )}
                                <span className="truncate font-medium">{item.label}</span>
                                {item.sub ? (
                                    <span className="ml-auto truncate text-xs text-gray-500 dark:text-gray-400">
                                        {item.sub}
                                    </span>
                                ) : null}
                                {item.logoSrc ? (
                                    <span className="shrink-0">
                                        <StatusDot status={item.status} />
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

            <Link
                href={ctaHref}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-700 transition-colors hover:text-cyan-800 dark:text-cyan-300 dark:hover:text-cyan-200"
            >
                {ctaLabel}
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
        </div>
    );
}
