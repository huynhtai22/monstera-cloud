"use client";

import Link from "next/link";
import {
    AlertTriangle,
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
    volume: DailyVolume[];
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
        dot: "bg-cyan-400 animate-pulse",
        badge: "border-cyan-500/25 bg-cyan-500/10 text-cyan-300",
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

function formatRows(value?: number | null) {
    return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value ?? 0);
}

function VolumeSparkline({ volume }: { volume: DailyVolume[] }) {
    if (volume.length === 0) {
        return <div className="flex h-24 items-center justify-center border-t border-dashed border-slate-700/80 text-xs text-slate-500">No warehouse history yet</div>;
    }
    const max = Math.max(...volume.map((day) => day.rows), 1);
    const points = volume
        .map((day, index) => {
            const x = volume.length === 1 ? 0 : (index / (volume.length - 1)) * 100;
            const y = 42 - (day.rows / max) * 34;
            return `${x},${y}`;
        })
        .join(" ");

    if (!volume.some((day) => day.rows > 0)) {
        return <div className="flex h-24 items-center justify-center border-t border-dashed border-slate-700/80 text-xs text-slate-500">No rows landed in this window</div>;
    }

    return (
        <div className="relative h-24 border-t border-slate-800 pt-3" aria-label="Seven-day warehouse row volume">
            <svg viewBox="0 0 100 48" preserveAspectRatio="none" className="h-16 w-full overflow-visible" role="img">
                <defs>
                    <linearGradient id="volume-fill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.28" />
                        <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
                    </linearGradient>
                </defs>
                <path d={`M 0 48 L ${points} L 100 48 Z`} fill="url(#volume-fill)" />
                <polyline points={points} fill="none" stroke="#2dd4bf" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="flex justify-between text-[10px] uppercase tracking-[0.12em] text-slate-600">
                <span>{new Date(volume[0].date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                <span>Today</span>
            </div>
        </div>
    );
}

export function PipelineHealthOverview({
    sources,
    volume,
    incidents = [],
    onRefreshAll,
    isRefreshing = false,
    dataExplorerHref = "/explorer",
    sourcesHref = "/sources",
}: PipelineHealthOverviewProps) {
    const counts = sources.reduce<Record<PipelineHealthState, number>>(
        (result, source) => ({ ...result, [source.state]: result[source.state] + 1 }),
        { fresh: 0, stale: 0, syncing: 0, error: 0 }
    );
    const needsAttention = counts.stale + counts.error;
    const latestRows = volume.reduce((total, day) => total + day.rows, 0);
    const headline = counts.error > 0
        ? `${counts.error} source${counts.error === 1 ? "" : "s"} failed`
        : needsAttention > 0
          ? `${needsAttention} of ${sources.length} need refresh`
          : counts.syncing > 0
            ? `${counts.syncing} sync in progress`
            : `All ${sources.length} sources fresh`;

    return (
        <section className="space-y-4" aria-labelledby="pipeline-health-title">
            <header className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950/70 px-5 py-5 shadow-[0_16px_48px_rgba(0,0,0,0.24)]">
                <div className="absolute inset-y-0 right-0 w-1/3 bg-[linear-gradient(135deg,transparent_20%,rgba(45,212,191,0.08)_20%,transparent_21%)] opacity-60" />
                <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300/65">Pipeline control</p>
                        <div className="mt-1 flex flex-wrap items-center gap-3">
                            <h1 id="pipeline-health-title" className="text-2xl font-semibold tracking-tight text-white">{headline}</h1>
                            <span className={cn("inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold", needsAttention ? "border-amber-500/25 bg-amber-500/10 text-amber-300" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300")}>
                                <span className={cn("h-1.5 w-1.5 rounded-full", needsAttention ? "bg-amber-400" : "bg-emerald-400")} />
                                {counts.fresh} fresh · {needsAttention} attention
                            </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-400">Last warehouse activity is shown per source below. Refresh only when a source is stale or failed.</p>
                    </div>
                    <button type="button" onClick={onRefreshAll} disabled={isRefreshing || needsAttention === 0} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
                        {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Refresh stale sources
                    </button>
                </div>
            </header>

            <div className="grid gap-4 xl:grid-cols-5">
                <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/70 xl:col-span-3" aria-labelledby="source-health-title">
                    <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                        <div><h2 id="source-health-title" className="text-sm font-semibold text-slate-100">Source health</h2><p className="mt-0.5 text-xs text-slate-500">Connection health and the freshness of data that landed.</p></div>
                        <Link href={sourcesHref} className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-300 hover:text-cyan-100">Manage sources <ChevronRight className="h-3.5 w-3.5" /></Link>
                    </div>
                    <div className="divide-y divide-slate-800">
                        {sources.map((source) => {
                            const style = statusStyles[source.state];
                            return <div key={source.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-4 py-3.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(110px,.7fr)_minmax(120px,.7fr)_auto] sm:items-center">
                                <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-100">{source.name}{source.accountCount ? <span className="ml-1.5 text-xs font-normal text-slate-500">{source.accountCount} accounts</span> : null}</p><p className="mt-0.5 truncate text-xs text-slate-500">{source.detail ?? "Warehouse import"}</p></div>
                                <p className="hidden text-xs text-slate-400 sm:block">{formatRows(source.rowsLastRun)} rows last run</p>
                                <p className="hidden text-xs text-slate-400 sm:block">{formatAge(source.lastSyncedAt)}</p>
                                <span className={cn("mt-2 inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold sm:mt-0", style.badge)}><span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />{style.label}</span>
                            </div>;
                        })}
                    </div>
                </section>

                <div className="space-y-4 xl:col-span-2">
                    <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4" aria-labelledby="volume-title">
                        <div className="flex items-start justify-between"><div><h2 id="volume-title" className="text-sm font-semibold text-slate-100">Warehouse volume</h2><p className="mt-0.5 text-xs text-slate-500">Rows landed, last 7 days</p></div><span className="text-sm font-semibold text-cyan-300">{formatRows(latestRows)}</span></div>
                        <div className="mt-3"><VolumeSparkline volume={volume} /></div>
                        <Link href={dataExplorerHref} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-cyan-300 hover:text-cyan-100"><Database className="h-3.5 w-3.5" /> Inspect warehouse <ChevronRight className="h-3.5 w-3.5" /></Link>
                    </section>

                    <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4" aria-labelledby="attention-title">
                        <div className="flex items-center gap-2"><ServerCog className="h-4 w-4 text-slate-400" /><h2 id="attention-title" className="text-sm font-semibold text-slate-100">Needs attention</h2></div>
                        {incidents.length ? <ul className="mt-3 space-y-2.5">{incidents.slice(0, 2).map((incident) => <li key={incident.id} className="flex gap-2.5 text-xs"><CircleAlert className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", incident.state === "error" ? "text-rose-400" : "text-cyan-400")} /><div><p className="font-medium text-slate-200">{incident.sourceName}</p><p className="mt-0.5 text-slate-500">{incident.message} · {formatAge(incident.occurredAt)}</p></div></li>)}</ul> : <div className="mt-3 flex items-center gap-2 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4" />No failed or running jobs.</div>}
                        <Link href="/reports" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-200">View sync history <ChevronRight className="h-3.5 w-3.5" /></Link>
                    </section>
                </div>
            </div>
        </section>
    );
}
