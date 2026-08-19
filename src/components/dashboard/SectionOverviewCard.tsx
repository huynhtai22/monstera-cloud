"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, AlertCircle, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export type OverviewStatus = "ok" | "pending" | "error" | "neutral";

export type OverviewLineItem = {
    id: string;
    label: string;
    sub?: string;
    logoSrc?: string;
    status?: OverviewStatus;
    accountCount?: number;
    accountHint?: string;
    badge?: string;
    href?: string;
};

export type SectionOverviewCardProps = {
    stepNumber?: string;
    stepLabel?: string;
    icon: React.ReactNode;
    title: string;
    subtitle?: string;
    kpi?: { label: string; value: string };
    items?: OverviewLineItem[];
    emptyHint?: string;
    emptyAction?: { label: string; href: string };
    ctaLabel?: string;
    ctaHref?: string;
    accentClassName?: string;
    className?: string;
    emphasis?: boolean;
    accent?: "indigo" | "emerald" | "amber" | "rose" | "slate";
    footerSlot?: React.ReactNode;
};

function StatusDot({ status, isStale }: { status?: OverviewStatus; isStale?: boolean }) {
    const label =
        status === "ok" ? "Connected" :
        status === "error" ? "Error" :
        status === "pending" ? "Pending" :
        "Idle";
    
    if (status === "ok" && !isStale) return (
        <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-400" title={label} />
    );
    if (status === "ok" && isStale) return (
        <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-400" title="Needs refresh" />
    );
    if (status === "error") return (
        <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-red-500 animate-pulse" title={label} />
    );
    if (status === "pending") return (
        <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-400 animate-pulse" title={label} />
    );
    return <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-neutral-600" title={label} />;
}

export function SectionOverviewCard({
    stepNumber,
    stepLabel,
    icon,
    title,
    subtitle,
    kpi,
    items,
    emptyHint,
    emptyAction,
    ctaLabel,
    ctaHref,
    accentClassName,
    className,
    emphasis,
    footerSlot,
}: SectionOverviewCardProps) {
    const titleId = `section-${title.replace(/\s+/g, "-").toLowerCase()}`;
    const safeItems = items ?? [];
    const hasItems = Array.isArray(items) && items.length > 0;
    const hasError = Array.isArray(items) && items.some((i) => i.status === "error");

    return (
        <section
            aria-labelledby={titleId}
            className={cn(
                "group relative flex h-full min-w-0 flex-col overflow-hidden rounded-lg border shadow-xs transition-all duration-200",
                "border-line bg-panel hover:border-[#383838]",
                emphasis && "ring-1 ring-white/10",
                hasError && "border-red-900/50 bg-red-950/10",
                className,
            )}
        >
            {/* Top Stage Indicator Header */}
            <div className="flex items-center justify-between border-b border-line/80 px-4 py-2.5 bg-canvas/40">
                <div className="flex items-center gap-2">
                    {stepNumber ? (
                        <span className="font-mono text-[10px] font-bold tracking-widest text-ink-mute">
                            {stepNumber}
                        </span>
                    ) : null}
                    {stepLabel ? (
                        <>
                            <span className="text-[10px] text-neutral-600">/</span>
                            <span className="font-mono text-[10px] font-semibold tracking-wider text-ink-mute uppercase">
                                {stepLabel}
                            </span>
                        </>
                    ) : null}
                </div>
                {kpi ? (
                    <div className="inline-flex items-center gap-1.5 font-mono text-[10px] px-2 py-0.5 rounded border border-line bg-canvas">
                        <span className="text-ink-mute uppercase tracking-wider">{kpi.label}:</span>
                        <span className="font-bold tabular-nums text-ink">{kpi.value}</span>
                    </div>
                ) : null}
            </div>

            {/* Card Content Area */}
            <div className="relative z-10 flex flex-1 flex-col p-4 sm:p-5">
                {/* Title and Subtitle */}
                <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                        <div
                            className={cn(
                                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-canvas text-white shadow-xs",
                                accentClassName
                            )}
                        >
                            {icon}
                        </div>
                        <div>
                            <h3 id={titleId} className="text-sm font-semibold tracking-tight text-ink leading-none">
                                {title}
                            </h3>
                            {subtitle ? (
                                <p className="text-[11px] text-ink-mute mt-1 leading-none">{subtitle}</p>
                            ) : null}
                        </div>
                    </div>
                </div>

                {/* Items List */}
                {hasItems ? (
                    <ul className="mb-4 flex flex-1 flex-col gap-1.5">
                        {safeItems.slice(0, 4).map((item) => {
                            const ItemWrapper = item.href ? Link : "div";
                            return (
                                <li key={item.id}>
                                    <ItemWrapper
                                        href={item.href || "#"}
                                        className={cn(
                                            "group/item flex items-center justify-between gap-2.5 rounded-md border border-transparent px-2.5 py-2 transition-all",
                                            item.href
                                                ? "hover:border-line hover:bg-canvas cursor-pointer"
                                                : "bg-canvas/50 border-line/40"
                                        )}
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            {item.logoSrc ? (
                                                <div className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white p-0.5 shadow-2xs">
                                                    <img
                                                        src={item.logoSrc}
                                                        alt=""
                                                        width={14}
                                                        height={14}
                                                        className="h-3.5 w-3.5 object-contain"
                                                    />
                                                </div>
                                            ) : (
                                                <StatusDot status={item.status} isStale={item.sub?.includes("stale") || item.sub?.includes("attention")} />
                                            )}

                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <p className="truncate text-xs font-medium text-ink group-hover/item:text-white transition-colors">
                                                        {item.label}
                                                    </p>
                                                    {item.accountCount && item.accountCount > 1 ? (
                                                        <span className="font-mono text-[9px] font-semibold px-1 rounded border border-line bg-canvas text-ink-mute">
                                                            {item.accountCount} accts
                                                        </span>
                                                    ) : null}
                                                </div>
                                                {item.sub ? (
                                                    <p className="truncate font-mono text-[10px] text-ink-mute mt-0.5">
                                                        {item.sub}
                                                    </p>
                                                ) : null}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {item.badge ? (
                                                <span className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded border border-line bg-canvas text-ink-mute">
                                                    {item.badge}
                                                </span>
                                            ) : item.logoSrc ? (
                                                <StatusDot status={item.status} isStale={item.sub?.includes("stale") || item.sub?.includes("attention")} />
                                            ) : null}
                                            {item.href ? (
                                                <ChevronRight className="h-3.5 w-3.5 text-neutral-600 group-hover/item:text-white group-hover/item:translate-x-0.5 transition-all" />
                                            ) : null}
                                        </div>
                                    </ItemWrapper>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <div className="mb-4 flex flex-1 flex-col items-center justify-center rounded-md border border-dashed border-line bg-canvas/40 p-5 text-center">
                        <p className="text-xs text-ink-mute mb-2">
                            {emptyHint ?? "Nothing connected yet."}
                        </p>
                        {emptyAction ? (
                            <Link
                                href={emptyAction.href}
                                className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold text-white hover:underline uppercase tracking-wider"
                            >
                                <span>+ {emptyAction.label}</span>
                            </Link>
                        ) : null}
                    </div>
                )}

                {/* Bottom Action Bar */}
                <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3">
                    {ctaHref && ctaLabel ? (
                        <Link
                            href={ctaHref}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-mute hover:text-white transition-colors group/cta"
                        >
                            <span>{ctaLabel}</span>
                            <ArrowRight className="h-3 w-3 text-neutral-500 group-hover/cta:text-white group-hover/cta:translate-x-0.5 transition-all" />
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
