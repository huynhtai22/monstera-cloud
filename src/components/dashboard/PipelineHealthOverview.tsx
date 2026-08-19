"use client";

import Link from "next/link";
import {
    CheckCircle2,
    ChevronRight,
    CircleAlert,
    Database,
    Loader2,
    RefreshCw,
    ServerCog,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type PipelineHealthState = "fresh" | "stale" | "syncing" | "error";

export type PipelineHealthSource = {
    id: string;
    name: string;
    accountCount?: number;
    state: PipelineHealthState;
    lastSyncedAt?: string | null;
    rowsLastRun?: number | null;
    detail?: string | null;
};

export type DailyVolume = {
    date: string;
    rows: number;
};

export type SyncIncident = {
    id: string;
    sourceName: string;
    state: "error" | "syncing";
    message: string;
    occurredAt: string;
};

type PipelineHealthOverviewProps = {
    sources: PipelineHealthSource[];
    volume?: DailyVolume[];
    incidents?: SyncIncident[];
    onRefreshAll: () => void;
    isRefreshing?: boolean;
    dataExplorerHref?: string;
    sourcesHref?: string;
};

const statusStyles: Record<PipelineHealthState, { label: string; dot: string; badge: string }> = {
    fresh: {
        label: "Fresh",
        dot: "bg-emerald-400",
        badge: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    },
    stale: {
        label: "Needs refresh",
        dot: "bg-amber-400",
        badge: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    },
    syncing: {
        label: "Syncing",
        dot: "bg-accent animate-pulse",
        badge: "border-line text-ink",
    },
    error: {
        label: "Error",
        dot: "bg-rose-400",
        badge: "border-rose-500/25 bg-rose-500/10 text-rose-300",
    },
};

function formatAge(value?: string | null) {
    if (!value) return "Never synced";
    const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

export function formatCompactRows(value?: number | null) {
    return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value ?? 0);
}

export function PipelineHealthOverview({
    sources,
    incidents = [],
    onRefreshAll,
    isRefreshing = false,
    dataExplorerHref = "/explorer",
    sourcesHref = "/sources",
}: PipelineHealthOverviewProps) {
    const needsAttention = sources.filter((s) => s.state === "stale" || s.state === "error").length;

    return (
        <div className="grid gap-4 xl:grid-cols-5">
            <section className="overflow-hidden rounded-lg border border-line bg-panel xl:col-span-3" aria-labelledby="source-health-title">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                    <div>
                        <h2 id="source-health-title" className="text-sm font-semibold text-ink">Source health</h2>
                        <p className="mt-0.5 text-xs text-ink-mute">Freshness of connected platforms.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Link href={sourcesHref} className="inline-flex items-center gap-1 text-xs font-medium text-ink-mute hover:text-ink">
                            Manage sources <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </Link>
                        <button
                            type="button"
                            onClick={onRefreshAll}
                            disabled={isRefreshing || needsAttention === 0}
                            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />}
                            Refresh stale
                        </button>
                    </div>
                </div>
                {sources.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-ink-mute">No sources in this workspace.</p>
                ) : (
                    <div className="divide-y divide-line">
                        {sources.map((source) => {
                            const style = statusStyles[source.state];
                            return (
                                <div
                                    key={source.id}
                                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-4 py-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(110px,.7fr)_minmax(110px,.7fr)_auto] sm:items-center"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-ink">
                                            {source.name}
                                            {source.accountCount ? (
                                                <span className="ml-1.5 text-xs font-normal text-ink-mute">{source.accountCount} accounts</span>
                                            ) : null}
                                        </p>
                                        <p className="mt-0.5 truncate text-xs text-ink-mute">{source.detail ?? "Warehouse import"}</p>
                                    </div>
                                    <p className="hidden text-xs text-ink-mute sm:block">{formatCompactRows(source.rowsLastRun)} last run</p>
                                    <p className="hidden text-xs text-ink-mute sm:block">{formatAge(source.lastSyncedAt)}</p>
                                    <span className={cn("mt-2 inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium sm:mt-0", style.badge)}>
                                        <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
                                        {style.label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            <aside className="space-y-4 xl:col-span-2">
                <section className="rounded-lg border border-line bg-panel p-4" aria-labelledby="attention-title">
                    <div className="flex items-center gap-2">
                        <ServerCog className="h-4 w-4 text-ink-mute" strokeWidth={1.5} />
                        <h2 id="attention-title" className="text-sm font-semibold text-ink">Needs attention</h2>
                    </div>
                    {incidents.length ? (
                        <ul className="mt-3 space-y-2.5">
                            {incidents.slice(0, 3).map((incident) => (
                                <li key={incident.id} className="flex gap-2.5 text-xs">
                                    <CircleAlert
                                        className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", incident.state === "error" ? "text-rose-400" : "text-accent")}
                                        strokeWidth={1.5}
                                    />
                                    <div>
                                        <p className="font-medium text-ink">{incident.sourceName}</p>
                                        <p className="mt-0.5 text-ink-mute">{incident.message} · {formatAge(incident.occurredAt)}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="mt-3 flex items-center gap-2 text-xs text-ink-mute">
                            <CheckCircle2 className="h-4 w-4 text-accent" strokeWidth={1.5} />
                            No failed or running jobs.
                        </div>
                    )}
                    <Link href="/reports" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ink-mute hover:text-ink">
                        Open logs <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </Link>
                </section>
                <Link
                    href={dataExplorerHref}
                    className="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-3 text-sm text-ink governed-hover"
                >
                    <span className="inline-flex items-center gap-2">
                        <Database className="h-4 w-4 text-ink-mute" strokeWidth={1.5} />
                        Query warehouse
                    </span>
                    <ChevronRight className="h-4 w-4 text-ink-mute" strokeWidth={1.5} />
                </Link>
            </aside>
        </div>
    );
}
