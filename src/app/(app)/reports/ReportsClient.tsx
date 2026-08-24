"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Clock, Database, Bookmark, Info, RefreshCw, Search } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { cn } from "@/lib/utils";
import { PageShell, SyncLogDiagnosticsDrawer, type SyncLogWithPipeline } from "@/components/ui";
import { EmptyState } from "@/components/ui/EmptyState";
import { REPORTS_SOURCE_CHIPS, pipelineMatchesSourceFilter } from "@/lib/reports-source-filters";
import { SyncActivityTableSkeleton } from "@/components/reports/SyncActivityLoadingState";

const REPORTS_VIEW_STORAGE = "monstera_reports_view_v1";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to load");
    return data;
};

export function ReportsClient() {
    const { activeWorkspaceId } = useWorkspaceStore();
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const sourceFilter = searchParams.get("source") ?? "";
    const clientFilter = searchParams.get("clientId") ?? "";

    const [statusFilter, setStatusFilter] = React.useState<"all" | "success" | "error">("all");
    const [dateFrom, setDateFrom] = React.useState("");
    const [dateTo, setDateTo] = React.useState("");
    const [selectedLog, setSelectedLog] = React.useState<SyncLogWithPipeline | null>(null);
    const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);

    const { data: workspaces } = useSWR("/api/workspaces", fetcher);
    const { data: clientsPayload } = useSWR(
        activeWorkspaceId ? `/api/clients?workspaceId=${activeWorkspaceId}` : null,
        fetcher
    );
    const clients = React.useMemo(() => {
        const raw = Array.isArray(clientsPayload)
            ? clientsPayload
            : Array.isArray(clientsPayload?.clients)
                ? clientsPayload.clients
                : [];
        return raw as Array<{ id: string; name: string }>;
    }, [clientsPayload]);
    const activeWorkspace = React.useMemo(() => {
        if (!Array.isArray(workspaces) || !activeWorkspaceId) return null;
        return workspaces.find((w: { id: string }) => w.id === activeWorkspaceId) ?? null;
    }, [workspaces, activeWorkspaceId]);

    React.useEffect(() => {
        try {
            const raw = localStorage.getItem(REPORTS_VIEW_STORAGE);
            if (!raw) return;
            const v = JSON.parse(raw) as {
                source?: string;
                statusFilter?: "all" | "success" | "error";
                dateFrom?: string;
                dateTo?: string;
            };
            if (v.statusFilter) setStatusFilter(v.statusFilter);
            if (typeof v.dateFrom === "string") setDateFrom(v.dateFrom);
            if (typeof v.dateTo === "string") setDateTo(v.dateTo);
            if (v.source !== undefined && v.source !== (searchParams.get("source") ?? "")) {
                const q = new URLSearchParams(searchParams.toString());
                if (v.source) q.set("source", v.source);
                else q.delete("source");
                const qs = q.toString();
                router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
            }
        } catch {
            /* ignore */
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- restore once on mount

    const statusQuery = statusFilter === "all" ? "" : `&status=${statusFilter}`;
    const clientQuery = clientFilter ? `&clientId=${encodeURIComponent(clientFilter)}` : "";
    const { data, error, isLoading, isValidating, mutate: retryLogs } = useSWR(
        activeWorkspaceId ? `/api/sync-logs?workspaceId=${activeWorkspaceId}${statusQuery}${clientQuery}` : null,
        fetcher
    );

    const handleOpenDrawer = React.useCallback((log: SyncLogWithPipeline) => {
        setSelectedLog(log);
        setIsDrawerOpen(true);
    }, []);

    const rawLogs = React.useMemo(() => (data?.logs ?? []) as Array<{
        id: string;
        status: string;
        rowsSynced: number;
        durationMs: number;
        errorMsg?: string | null;
        createdAt: string;
        pipeline: { id: string; name: string; sourceConnectionId: string; clientId?: string | null };
    }>, [data?.logs]);

    const sourceFiltered = React.useMemo(
        () => rawLogs.filter((l) => pipelineMatchesSourceFilter(l.pipeline?.name ?? "", sourceFilter)),
        [rawLogs, sourceFilter]
    );

    const logs = React.useMemo(() => {
        let rows = sourceFiltered;
        if (dateFrom) {
            const from = new Date(dateFrom);
            from.setHours(0, 0, 0, 0);
            rows = rows.filter((l) => new Date(l.createdAt) >= from);
        }
        if (dateTo) {
            const to = new Date(dateTo);
            to.setHours(23, 59, 59, 999);
            rows = rows.filter((l) => new Date(l.createdAt) <= to);
        }
        return rows;
    }, [sourceFiltered, dateFrom, dateTo]);

    const summary = React.useMemo(() => {
        if (logs.length === 0) return null;
        let errors = 0;
        let rowsSum = 0;
        let newest: Date | null = null;
        for (const l of logs) {
            if (l.status === "error") errors += 1;
            rowsSum += l.rowsSynced ?? 0;
            const t = new Date(l.createdAt);
            if (!Number.isNaN(t.getTime()) && (!newest || t > newest)) newest = t;
        }
        return {
            shown: logs.length,
            errors,
            rowsSum,
            newest: newest ? newest.toLocaleString() : "—",
        };
    }, [logs]);

    const saveDefaultView = () => {
        try {
            localStorage.setItem(
                REPORTS_VIEW_STORAGE,
                JSON.stringify({
                    source: sourceFilter,
                    statusFilter,
                    dateFrom,
                    dateTo,
                })
            );
            toast.success("Saved as your default Sync Activity view on this browser.");
        } catch {
            toast.error("Could not save view.");
        }
    };

    const setSource = (id: string) => {
        const q = new URLSearchParams(searchParams.toString());
        if (id) q.set("source", id);
        else q.delete("source");
        const qs = q.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    };

    const setClient = (id: string) => {
        const q = new URLSearchParams(searchParams.toString());
        if (id) q.set("clientId", id);
        else q.delete("clientId");
        const qs = q.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    };

    const resetFilters = () => {
        const q = new URLSearchParams(searchParams.toString());
        q.delete("source");
        q.delete("clientId");
        const qs = q.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        setDateFrom("");
        setDateTo("");
        setStatusFilter("all");
    };

    const activeSourceLabel = REPORTS_SOURCE_CHIPS.find((chip) => chip.id === sourceFilter)?.label ?? "All sources";
    const activeClientLabel = clients.find((client) => client.id === clientFilter)?.name ?? "All clients";
    const activeStatusLabel = statusFilter === "all" ? "any status" : `${statusFilter === "success" ? "Success" : "Error"} status`;
    const hasActiveFilters = Boolean(sourceFilter || clientFilter || dateFrom || dateTo || statusFilter !== "all");

    return (
        <PageShell>
            <div className="relative z-10 mb-5">
                <div className="mb-3">
                    <h1 className="text-xl font-semibold tracking-tight text-ink">Sync activity</h1>
                    <p className="mt-1 max-w-2xl text-sm text-ink-mute">
                        Destination pipeline run history and row counts for {activeWorkspace?.name ?? "the active workspace"}.
                    </p>
                </div>
                <div className="flex max-w-3xl items-start gap-2 rounded-md border border-line bg-panel px-3 py-2 text-xs text-ink-mute">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink" aria-hidden="true" />
                    <p>
                        This page records source-to-destination pipeline runs. Manual and nightly Warehouse source refresh status lives on{" "}
                        <Link href="/sources" className="font-medium text-ink underline underline-offset-2">Sources</Link>.
                    </p>
                </div>
                {clients.length > 0 ? (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute">Client</span>
                        <button
                            type="button"
                            onClick={() => setClient("")}
                            className={cn(
                                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                                clientFilter === ""
                                    ? "border-line bg-white/[0.06] text-ink"
                                    : "border-line bg-panel text-ink-mute hover:text-ink"
                            )}
                        >
                            All clients
                        </button>
                        {clients.map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => setClient(c.id)}
                                className={cn(
                                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                                    clientFilter === c.id
                                        ? "border-line bg-white/[0.06] text-ink"
                                        : "border-line bg-panel text-ink-mute hover:text-ink"
                                )}
                            >
                                {c.name}
                            </button>
                        ))}
                    </div>
                ) : null}
                <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
                    <div className="flex flex-wrap gap-2">
                        {REPORTS_SOURCE_CHIPS.map((c) => (
                            <button
                                key={c.id || "all"}
                                type="button"
                                onClick={() => setSource(c.id)}
                                className={cn(
                                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                                    sourceFilter === c.id
                                        ? "border-line bg-white/[0.06] text-ink"
                                        : "border-line bg-panel text-ink-mute hover:text-ink"
                                )}
                            >
                                {c.label}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-slate-400">
                            From
                            <input
                                type="date"
                                value={dateFrom}
                                onChange={(e) => setDateFrom(e.target.value)}
                                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs dark:border-[#2f3336] dark:bg-[#16181c] dark:text-slate-100"
                            />
                        </label>
                        <label className="flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-slate-400">
                            To
                            <input
                                type="date"
                                value={dateTo}
                                onChange={(e) => setDateTo(e.target.value)}
                                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs dark:border-[#2f3336] dark:bg-[#16181c] dark:text-slate-100"
                            />
                        </label>
                        <button
                            type="button"
                            onClick={saveDefaultView}
                            className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-3 py-1.5 text-xs font-medium text-ink hover:bg-white/[0.04]"
                        >
                            <Bookmark className="h-3.5 w-3.5" />
                            Save view
                        </button>
                    </div>
                </div>
            </div>

            <div className="relative z-10 rounded-lg border border-line bg-panel p-5">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-sm font-semibold text-ink">Logs</h2>
                        <p className="text-xs text-ink-mute">Last 100 destination pipeline runs in this workspace.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {(["all", "success", "error"] as const).map((v) => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => setStatusFilter(v)}
                                className={cn(
                                    "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                                    statusFilter === v
                                        ? "border-line bg-white/[0.06] text-ink"
                                        : "border-line bg-canvas text-ink-mute hover:text-ink"
                                )}
                            >
                                {v === "all" ? "All" : v === "success" ? "Success" : "Error"}
                            </button>
                        ))}
                    </div>
                </div>

                {summary ? (
                    <div className="mb-4 flex flex-wrap gap-3 rounded-md border border-line bg-canvas px-4 py-3 text-xs">
                        <span className="font-semibold text-gray-700 dark:text-slate-200">
                            Shown: <span className="text-gray-900 dark:text-white">{summary.shown}</span> syncs
                        </span>
                        <span className="text-slate-300 dark:text-slate-600">|</span>
                        <span className="font-semibold text-gray-700 dark:text-slate-200">
                            Errors:{" "}
                            <span className={summary.errors > 0 ? "text-red-600 dark:text-red-300" : "text-gray-900 dark:text-white"}>
                                {summary.errors}
                            </span>
                        </span>
                        <span className="text-slate-300 dark:text-slate-600">|</span>
                        <span className="font-semibold text-gray-700 dark:text-slate-200">
                            Rows written: <span className="text-gray-900 dark:text-white">{summary.rowsSum.toLocaleString()}</span>
                        </span>
                        <span className="text-slate-300 dark:text-slate-600">|</span>
                        <span className="font-semibold text-gray-700 dark:text-slate-200">
                            Newest: <span className="font-normal text-gray-600 dark:text-slate-300">{summary.newest}</span>
                        </span>
                    </div>
                ) : null}

                {isLoading ? (
                    <SyncActivityTableSkeleton />
                ) : error ? (
                    <div role="alert" className="flex flex-col gap-4 rounded-lg border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-100 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-start gap-2">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            <div>
                                <p className="font-semibold">Sync activity could not load</p>
                                <p className="mt-1 text-xs text-red-200/80">Your filters are still selected. Trying again only reloads this history; it will not start a sync.</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => void retryLogs()}
                            disabled={isValidating}
                            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-red-400/30 bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-100 transition-colors hover:bg-red-900/40 disabled:cursor-wait disabled:opacity-60"
                        >
                            <RefreshCw className={cn("h-3.5 w-3.5", isValidating && "motion-safe:animate-spin motion-reduce:animate-none")} aria-hidden="true" />
                            {isValidating ? "Trying again…" : "Try again"}
                        </button>
                    </div>
                ) : rawLogs.length === 0 && !hasActiveFilters ? (
                    <EmptyState
                        icon={<Database className="h-12 w-12" />}
                        title="No destination pipeline runs yet"
                        description="Connect a destination and run its pipeline to create activity here. Direct Warehouse source refreshes are tracked on Sources."
                        primaryAction={
                            <Link
                                href="/sources"
                                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
                            >
                                Go to Sources
                            </Link>
                        }
                        secondaryAction={
                            <Link
                                href="/explorer"
                                className="inline-flex items-center justify-center rounded-md border border-line bg-canvas px-4 py-2.5 text-sm font-semibold text-ink hover:bg-white/[0.04]"
                            >
                                Open Warehouse
                            </Link>
                        }
                    />
                ) : logs.length === 0 ? (
                    <EmptyState
                        icon={<Search className="h-12 w-12" />}
                        title="No pipeline runs match this view"
                        description={`No destination pipeline runs match ${activeSourceLabel}, ${activeClientLabel}, and ${activeStatusLabel}${dateFrom || dateTo ? " in the selected date range" : ""}.`}
                        primaryAction={hasActiveFilters ? (
                            <button
                                type="button"
                                onClick={resetFilters}
                                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
                            >
                                Reset filters
                            </button>
                        ) : undefined}
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <caption className="sr-only">Destination pipeline sync activity for {activeWorkspace?.name ?? "the active workspace"}</caption>
                            <thead>
                                <tr className="border-b border-line text-[10px] font-bold uppercase tracking-wider text-ink-mute">
                                    <th className="py-3 pr-4">Pipeline</th>
                                    <th className="py-3 pr-4">Status</th>
                                    <th className="py-3 pr-4">Rows</th>
                                    <th className="py-3 pr-4">Duration</th>
                                    <th className="py-3 pr-4">When</th>
                                    <th className="py-3 pr-4">Error</th>
                                    <th className="py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((l) => {
                                    const srcId = l.pipeline?.sourceConnectionId;
                                    const name = l.pipeline?.name ?? "Pipeline";
                                    const pipelineCell =
                                        srcId ? (
                                            <Link
                                                href={`/sources/${srcId}`}
                                                onClick={(e) => e.stopPropagation()}
                                                className="font-semibold text-white underline underline-offset-2 hover:text-neutral-300"
                                            >
                                                {name}
                                            </Link>
                                        ) : (
                                            <span className="font-semibold text-ink">{name}</span>
                                        );
                                    return (
                                        <tr 
                                            key={l.id} 
                                            onClick={() => handleOpenDrawer(l as any)}
                                            className="border-b border-line cursor-pointer hover:bg-white/[0.02] transition-colors"
                                        >
                                            <td className="py-3 pr-4">{pipelineCell}</td>
                                            <td className="py-3 pr-4">
                                                {l.status === "success" ? (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] font-semibold text-white">
                                                        <CheckCircle2 className="h-3 w-3" /> Success
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-red-900/40 bg-red-950/30 px-2 py-0.5 text-[10px] font-semibold text-red-200">
                                                        <AlertCircle className="h-3 w-3" /> Error
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-3 pr-4 text-ink">{l.rowsSynced ?? 0}</td>
                                            <td className="py-3 pr-4 text-ink-mute">
                                                {Math.round((l.durationMs ?? 0) / 100) / 10}s
                                            </td>
                                            <td className="py-3 pr-4 text-gray-500 dark:text-slate-400">
                                                <span className="inline-flex items-center gap-1">
                                                    <Clock className="h-3.5 w-3.5" />
                                                    {new Date(l.createdAt).toLocaleString()}
                                                </span>
                                            </td>
                                            <td className="py-3 pr-4 text-gray-500 dark:text-slate-400 max-w-[200px] truncate" title={l.errorMsg ?? ""}>
                                                {l.errorMsg ?? ""}
                                            </td>
                                            <td className="py-3 text-right">
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleOpenDrawer(l as any);
                                                    }}
                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-[#2f3336] dark:bg-[#16181c] dark:text-slate-200 dark:hover:bg-slate-800 transition"
                                                >
                                                    Inspect
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <SyncLogDiagnosticsDrawer
                isOpen={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                log={selectedLog}
                workspaceId={activeWorkspaceId ?? ""}
                workspaceName={activeWorkspace?.name ?? undefined}
            />
        </PageShell>
    );
}
