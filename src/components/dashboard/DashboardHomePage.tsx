"use client";

import React from "react";
import Link from "next/link";
import { Database } from "lucide-react";
import useSWR, { useSWRConfig } from "swr";
import { useResolvedWorkspaceId } from "@/hooks/use-resolved-workspace-id";
import { primaryButtonLinkClassName } from "@/components/ui/PrimaryButton";
import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { SetupWizard } from "@/components/dashboard/SetupWizard";
import { RefreshedAt } from "@/components/ui/RefreshedAt";
import {
    PipelineHealthOverview,
    formatCompactRows,
    type DailyVolume,
    type PipelineHealthSource,
    type SyncIncident,
} from "@/components/dashboard/PipelineHealthOverview";
import { PillarGrid } from "@/components/dashboard/PillarGrid";
import { trackEvent, trackOnce } from "@/lib/analytics-events";

const WIZARD_DISMISS_KEY = "monstera_setup_wizard_dismissed_v1";

type Snapshot = {
    date: string;
    netRoas: number;
    adSpend: number;
    attributedRevenue: number;
};

function fmtCurrency(n: number) {
    if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
    return `$${Math.round(n)}`;
}

function MorningKpis({
    snapshots,
    rows7d,
    sources,
}: {
    snapshots: Snapshot[];
    rows7d: number;
    sources: PipelineHealthSource[];
}) {
    const recent = snapshots.slice(0, 7);
    const totalSpend = recent.reduce((s, r) => s + (r.adSpend || 0), 0);
    const totalRevenue = recent.reduce((s, r) => s + (r.attributedRevenue || 0), 0);
    const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const fresh = sources.filter((s) => s.state === "fresh").length;
    const attention = sources.filter((s) => s.state === "stale" || s.state === "error").length;

    const cells = [
        { label: "Spend · 7d", value: snapshots.length ? fmtCurrency(totalSpend) : "—" },
        { label: "ROAS · 7d", value: snapshots.length ? `${roas.toFixed(2)}×` : "—" },
        { label: "Rows · 7d", value: formatCompactRows(rows7d) },
        { label: "Sources", value: sources.length ? `${fresh} fresh` : "—", hint: attention > 0 ? `${attention} need attention` : sources.length ? "All clear" : "None connected" },
    ];

    return (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {cells.map((c) => (
                <div key={c.label} className="rounded-lg border border-line bg-panel px-4 py-3">
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-mute">{c.label}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{c.value}</p>
                    {c.hint ? <p className="mt-0.5 text-[11px] text-ink-mute">{c.hint}</p> : null}
                </div>
            ))}
        </div>
    );
}

type Connection = {
    id: string;
    type: string;
    provider: string;
    status?: string | null;
    name?: string | null;
    updatedAt?: string | null;
};

type Workspace = {
    id: string;
    name?: string | null;
    connections?: Connection[];
};

type Pipeline = {
    id: string;
    name: string;
    status: string;
    updatedAt: string;
    logs?: Array<{ rowsSynced?: number; status?: string; createdAt?: string }>;
    sourceConnection?: { id?: string; name?: string };
    destinationConnection?: { name?: string };
};

type SyncLog = {
    id: string;
    status: string;
    createdAt: string;
    rowsSynced?: number | null;
    message?: string | null;
    pipeline?: { id: string; name: string; sourceConnectionId?: string | null } | null;
};

type AttributionSnapshot = {
    date: string;
    netRoas: number;
    adSpend: number;
    attributedRevenue: number;
};

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || "Failed to fetch data");
    }
    return data;
};

export function DashboardHomePage() {
    const { workspaceId, workspaces, isLoading: workspacesLoading } = useResolvedWorkspaceId();
    const { mutate } = useSWRConfig();
    const [syncAllBusy, setSyncAllBusy] = React.useState(false);
    const [syncMsg, setSyncMsg] = React.useState<string>("");
    const [wizardDismissed, setWizardDismissed] = React.useState(false);
    const [isRefreshing, setIsRefreshing] = React.useState(false);

    const handleManualRefresh = React.useCallback(async () => {
        setIsRefreshing(true);
        try {
            // Exclude /api/auth/* to avoid unnecessary session endpoint revalidation during dashboard refreshes.
            await mutate(
                (key) => typeof key === "string" && key.startsWith("/api/") && !key.startsWith("/api/auth/"),
                undefined,
                { revalidate: true }
            );
        } catch (e) {
            console.warn("[Dashboard] Refresh failed:", e);
            // Silently fail — individual SWR hooks will retry on their own
        } finally {
            setIsRefreshing(false);
        }
    }, [mutate]);

    React.useEffect(() => {
        try {
            if (typeof window !== "undefined" && localStorage.getItem(WIZARD_DISMISS_KEY)) {
                setWizardDismissed(true);
            }
        } catch {
            /* ignore */
        }
    }, []);

    React.useEffect(() => {
        trackOnce("mc_dashboard_session", "dashboard_viewed", { path: "/" });
        trackEvent("dashboard_viewed", { path: "/" });
    }, []);

    type DashboardSummary = {
        pipelines: Pipeline[];
        syncLogs: SyncLog[];
        snapshots: AttributionSnapshot[];
    };

    const {
        data: summary,
    } = useSWR<DashboardSummary, Error>(
        workspaceId ? `/api/dashboard/summary?workspaceId=${workspaceId}&days=14` : null,
        fetcher,
        { refreshInterval: 30000 }
    );

    const pipelines = summary?.pipelines ?? [];
    const logs = summary?.syncLogs ?? [];
    const hasSuccessfulSync = logs.some((l) => l.status === "success");
    const snapshots = summary?.snapshots ?? [];

    const { connections, connectedSourcesCount, workspaceName } = React.useMemo(() => {
        if (!Array.isArray(workspaces) || !workspaceId) {
            return { connections: [] as Connection[], connectedSourcesCount: 0, workspaceName: "" };
        }
        const list = workspaces as Workspace[];
        const ws = list.find((w) => w.id === workspaceId) || list[0];
        const conns = ws?.connections ?? [];
        return {
            connections: conns,
            connectedSourcesCount: conns.filter((c) => c.type === "source").length,
            workspaceName: ws?.name ?? "Workspace",
        };
    }, [workspaces, workspaceId]);

    const hasSource = connectedSourcesCount > 0;

    const { sourceHealth, warehouseVolume, incidents, stalePipelineIds } = React.useMemo(() => {
        const sources = connections.filter((connection) => connection.type === "source");
        const orderedLogs = [...logs].sort(
            (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        );
        const logsBySource = new Map<string, SyncLog[]>();
        for (const log of orderedLogs) {
            const sourceId = log.pipeline?.sourceConnectionId;
            if (!sourceId) continue;
            const group = logsBySource.get(sourceId) ?? [];
            group.push(log);
            logsBySource.set(sourceId, group);
        }

        const pipelineIdsBySource = new Map<string, string[]>();
        for (const pipeline of pipelines) {
            const sourceId = pipeline.sourceConnection?.id;
            if (!sourceId) continue;
            const group = pipelineIdsBySource.get(sourceId) ?? [];
            group.push(pipeline.id);
            pipelineIdsBySource.set(sourceId, group);
        }

        const staleIds = new Set<string>();
        const sourceRows: PipelineHealthSource[] = sources.map((source) => {
            const sourceLogs = logsBySource.get(source.id) ?? [];
            const latest = sourceLogs[0];
            const latestSuccess = sourceLogs.find((log) => log.status === "success");
            const ageMs = latestSuccess ? Date.now() - new Date(latestSuccess.createdAt).getTime() : Infinity;
            const stale = ageMs > 24 * 60 * 60 * 1000;
            let state: PipelineHealthSource["state"] = "fresh";
            if (source.status === "error" || latest?.status === "error") state = "error";
            else if (latest?.status === "running" || latest?.status === "queued") state = "syncing";
            else if (stale) state = "stale";
            if (state === "stale" || state === "error") {
                for (const id of pipelineIdsBySource.get(source.id) ?? []) staleIds.add(id);
            }
            const accountCount = source.name?.match(/(\d+)\s*accounts?/i);
            return {
                id: source.id,
                name: source.name?.trim() || source.provider.replace(/_/g, " "),
                accountCount: accountCount ? Number(accountCount[1]) : undefined,
                state,
                lastSyncedAt: latestSuccess?.createdAt ?? source.updatedAt,
                rowsLastRun: latestSuccess?.rowsSynced ?? 0,
                detail: state === "error" ? latest?.message || "Latest sync failed" : "Warehouse import",
            };
        });

        const days = Array.from({ length: 7 }, (_, index) => {
            const date = new Date();
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() - (6 - index));
            return { date: date.toISOString(), rows: 0 };
        });
        const byDay = new Map(days.map((day, index) => [day.date.slice(0, 10), index]));
        for (const log of logs) {
            if (log.status !== "success") continue;
            const index = byDay.get(new Date(log.createdAt).toISOString().slice(0, 10));
            if (index !== undefined) days[index].rows += log.rowsSynced ?? 0;
        }

        const incidentRows: SyncIncident[] = orderedLogs
            .filter((log) => log.status === "error" || log.status === "running" || log.status === "queued")
            .slice(0, 3)
            .map((log) => ({
                id: log.id,
                sourceName: log.pipeline?.name ?? "Pipeline sync",
                state: log.status === "error" ? "error" : "syncing",
                message: log.status === "error" ? log.message || "Latest sync failed" : "Sync is in progress",
                occurredAt: log.createdAt,
            }));
        return { sourceHealth: sourceRows, warehouseVolume: days as DailyVolume[], incidents: incidentRows, stalePipelineIds: [...staleIds] };
    }, [connections, logs, pipelines]);

    const todayLabel = new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
    });

    const runStalePipelines = async () => {
        const targetIds = stalePipelineIds;
        if (targetIds.length === 0) return;
        setSyncAllBusy(true);
        setSyncMsg("");
        try {
            const CONCURRENCY = 3;
            const allIds: string[] = [];
            for (let i = 0; i < targetIds.length; i += CONCURRENCY) {
                const batch = targetIds.slice(i, i + CONCURRENCY);
                const results = await Promise.allSettled(
                    batch.map((pipelineId) => fetch(`/api/pipelines/${pipelineId}/run`, { method: "POST" }))
                );
                results.forEach((r, idx) => {
                    if (r.status === "fulfilled" && r.value.ok) {
                        allIds.push(batch[idx]);
                    }
                });
            }
            setSyncMsg(`Refresh requested for ${allIds.length} of ${targetIds.length} affected pipelines.`);
            trackEvent("wizard_step_completed", { step: "sync_all", count: allIds.length });
            trackEvent("pipeline_manual_sync_succeeded", { count: allIds.length, source: "dashboard_refresh_stale" });
        } catch {
            setSyncMsg("Some syncs may have failed — check Reports.");
        } finally {
            setSyncAllBusy(false);
        }
    };

    const dismissWizard = () => {
        try {
            localStorage.setItem(WIZARD_DISMISS_KEY, String(Date.now()));
        } catch {
            /* ignore */
        }
        setWizardDismissed(true);
    };

    if (workspacesLoading || workspaces === undefined) {
        return (
            <PageShell>
                <div className="animate-pulse space-y-6 p-2">
                    <div className="h-10 max-w-md rounded-lg bg-slate-200/80 dark:bg-slate-700/80" />
                    <div className="h-36 rounded-2xl bg-slate-100 dark:bg-slate-800/80" />
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="h-48 rounded-xl bg-slate-100 dark:bg-slate-800/80" />
                        <div className="h-48 rounded-xl bg-slate-100 dark:bg-slate-800/80" />
                    </div>
                </div>
            </PageShell>
        );
    }

    if (!workspaceId) {
        return (
            <PageShell>
                <EmptyState
                    icon={<Database className="h-5 w-5" />}
                    title="No workspace"
                    description="We couldn't load a workspace for your account. Try refreshing or contact support."
                />
            </PageShell>
        );
    }

    if (!hasSource) {
        if (wizardDismissed) {
            return (
                <PageShell>
                    <EmptyState
                        icon={<Database className="h-5 w-5" />}
                        title="No sources connected"
                        description="Connect Meta Ads, Google Ads, TikTok Ads, or Shopee. Then open Data Explorer to query warehouse rows."
                        primaryAction={
                            <Link href="/sources" className={primaryButtonLinkClassName} onClick={() => trackEvent("source_connect_clicked", { from: "dashboard_empty" })}>
                                Connect a source
                            </Link>
                        }
                    />
                </PageShell>
            );
        }
        return (
            <PageShell>
                <SetupWizard
                    hasSource={hasSource}
                    hasSuccessfulSync={hasSuccessfulSync}
                    onDismiss={dismissWizard}
                />
            </PageShell>
        );
    }

    const rows7d = warehouseVolume.reduce((sum, day) => sum + day.rows, 0);
    const attentionCount = sourceHealth.filter((s) => s.state === "stale" || s.state === "error").length;

    return (
        <PageShell>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight text-ink">Dashboard</h1>
                    <p className="mt-1 text-sm text-ink-mute">
                        {workspaceName} · {todayLabel}
                        {attentionCount > 0 ? ` · ${attentionCount} need attention` : " · All sources fresh"}
                    </p>
                </div>
                <RefreshedAt onRefresh={handleManualRefresh} loading={isRefreshing} />
            </div>

            {syncMsg ? (
                <div
                    className={[
                        "mb-4 rounded-lg border px-4 py-3 text-sm",
                        /fail|error|could not|sorry/i.test(syncMsg)
                            ? "border-red-500/30 bg-red-950/20 text-red-300"
                            : "border-line bg-panel text-ink",
                    ].join(" ")}
                >
                    {syncMsg}
                </div>
            ) : null}

            <MorningKpis snapshots={snapshots} rows7d={rows7d} sources={sourceHealth} />

            <div className="mt-6">
                <PillarGrid
                    connections={connections}
                    healthyCount={sourceHealth.filter((s) => s.state === "fresh").length}
                />
            </div>

            <div className="mt-6">
                <PipelineHealthOverview
                    sources={sourceHealth}
                    volume={warehouseVolume}
                    incidents={incidents}
                    onRefreshAll={runStalePipelines}
                    isRefreshing={syncAllBusy}
                />
            </div>
        </PageShell>
    );
}
