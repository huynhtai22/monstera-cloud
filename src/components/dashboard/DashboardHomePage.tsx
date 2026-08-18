"use client";

import React from "react";
import Link from "next/link";
import { Database, Plug, Send, ChevronRight, Plus, Loader2 } from "lucide-react";
import useSWR, { useSWRConfig } from "swr";
import { useResolvedWorkspaceId } from "@/hooks/use-resolved-workspace-id";
import { primaryButtonLinkClassName } from "@/components/ui/PrimaryButton";
import { secondaryButtonLinkClassName } from "@/components/ui/SecondaryButton";
import { AiPerformanceSummary } from "@/components/AiPerformanceSummary";
import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { MetricCardGrid } from "@/components/dashboard/MetricCardGrid";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { SetupWizard } from "@/components/dashboard/SetupWizard";
import { HealthSummaryBar } from "@/components/dashboard/HealthSummaryBar";
import { RefreshedAt } from "@/components/ui/RefreshedAt";
import {
    PipelineHealthOverview,
    type DailyVolume,
    type PipelineHealthSource,
    type SyncIncident,
} from "@/components/dashboard/PipelineHealthOverview";
import { trackEvent, trackOnce } from "@/lib/analytics-events";
import { cn } from "@/lib/utils";

const WIZARD_DISMISS_KEY = "monstera_setup_wizard_dismissed_v1";

type Snapshot = {
    date: string;
    netRoas: number;
    adSpend: number;
    attributedRevenue: number;
};

function RoasSnapshotCard({ snapshots }: { snapshots: Snapshot[] }) {
    // Aggregate last 7 days
    const recent = snapshots.slice(0, 7);
    const totalRevenue = recent.reduce((s, r) => s + (r.attributedRevenue || 0), 0);
    const totalSpend = recent.reduce((s, r) => s + (r.adSpend || 0), 0);
    const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;

    const fmtCurrency = (n: number) =>
        n >= 1000000
            ? `$${(n / 1000000).toFixed(1)}M`
            : n >= 1000
            ? `$${(n / 1000).toFixed(1)}k`
            : `$${Math.round(n)}`;

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Performance (last 7 days)
                </p>
                <Link
                    href="/reports"
                    className="text-xs font-medium text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
                >
                    View details →
                </Link>
            </div>
            <div className="grid grid-cols-3 gap-4">
                <div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">Attributed Revenue</p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white">{fmtCurrency(totalRevenue)}</p>
                </div>
                <div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">Ad Spend</p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white">{fmtCurrency(totalSpend)}</p>
                </div>
                <div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">Blended ROAS</p>
                    <p
                        className={cn(
                            "text-lg font-bold",
                            roas >= 3
                                ? "text-emerald-600 dark:text-emerald-400"
                                : roas >= 2
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-red-600 dark:text-red-400"
                        )}
                    >
                        {roas.toFixed(2)}×
                    </p>
                </div>
            </div>
            <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">
                Combines marketplace revenue and ad spend where attribution is configured.
            </p>
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
    const [syncingPipelineId, setSyncingPipelineId] = React.useState<string | null>(null);
    const [syncAllBusy, setSyncAllBusy] = React.useState(false);
    const [syncMsg, setSyncMsg] = React.useState<string>("");
    const [wizardDismissed, setWizardDismissed] = React.useState(false);
    const [isRefreshing, setIsRefreshing] = React.useState(false);
    const [mockPipelines, setMockPipelines] = React.useState<Pipeline[] | null>(null);
    const [templateBusy, setTemplateBusy] = React.useState<string | null>(null);

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
        error,
        isLoading,
    } = useSWR<DashboardSummary, Error>(
        workspaceId ? `/api/dashboard/summary?workspaceId=${workspaceId}&days=14` : null,
        fetcher,
        { refreshInterval: 30000 }
    );

    const pipelines = mockPipelines ?? summary?.pipelines ?? [];
    const activePipelinesCount = pipelines.length;
    const logs = summary?.syncLogs ?? [];
    const hasSuccessfulSync = logs.some((l) => l.status === "success");
    const snapshots = summary?.snapshots ?? [];

    const { connections, connectedSourcesCount, connectedDestinationsCount, workspaceName } = React.useMemo(() => {
        if (!Array.isArray(workspaces) || !workspaceId) {
            return { connections: [] as Connection[], connectedSourcesCount: 0, connectedDestinationsCount: 0, workspaceName: "" };
        }
        const list = workspaces as Workspace[];
        const ws = list.find((w) => w.id === workspaceId) || list[0];
        const conns = ws?.connections ?? [];
        return {
            connections: conns,
            connectedSourcesCount: conns.filter((c) => c.type === "source").length,
            connectedDestinationsCount: conns.filter((c) => c.type === "destination").length,
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

    const runPipeline = async (pipelineId: string) => {
        setSyncMsg("");
        setSyncingPipelineId(pipelineId);
        try {
            const res = await fetch(`/api/pipelines/${pipelineId}/run`, { method: "POST" });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(typeof data.error === "string" ? data.error : "Sync failed");
            }
            const msg = data.queued
                ? `Pipeline sync queued. It will run shortly.`
                : typeof data.message === "string"
                ? data.message
                : "Sync started.";
            setSyncMsg(msg);
            trackEvent("wizard_step_completed", { step: "sync_manual", pipelineId });
            trackEvent("pipeline_manual_sync_succeeded", { pipelineId, source: "dashboard" });
        } catch (e: unknown) {
            setSyncMsg(e instanceof Error ? e.message : "Sync failed");
        } finally {
            setSyncingPipelineId(null);
        }
    };

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

    // ── Onboarding State Machine ──────────────────────────
    // Stage 0: no sources, no destinations
    // Stage 1: sources > 0, but no destinations
    // Stage 2: sources + destinations, but no pipelines
    // Stage 3: pipelines exist → full active dashboard
    const dashboardStage =
        connectedSourcesCount === 0 && connectedDestinationsCount === 0 ? 0
        : connectedSourcesCount > 0 && connectedDestinationsCount === 0 ? 1
        : connectedSourcesCount > 0 && connectedDestinationsCount > 0 && activePipelinesCount === 0 ? 2
        : 3;

    if (dashboardStage === 0) {
        if (wizardDismissed) {
            return (
                <PageShell>
                    <EmptyState
                        icon={<Database className="h-5 w-5" />}
                        title="No sources connected"
                        description="Connect an ad platform or marketplace source. After that, add a destination (like Google Sheets) so your first sync has somewhere to land."
                        primaryAction={
                            <Link href="/sources" className={primaryButtonLinkClassName} onClick={() => trackEvent("source_connect_clicked", { from: "dashboard_empty" })}>
                                Connect a source
                            </Link>
                        }
                        secondaryAction={
                            <Link
                                href="/destinations"
                                className={secondaryButtonLinkClassName}
                                onClick={() => trackEvent("destinations_opened", { from: "dashboard_empty_secondary" })}
                            >
                                Add a destination
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

    if (dashboardStage === 1) {
        return (
            <PageShell>
                <div className="mb-6">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{workspaceName}</p>
                    <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Today, {todayLabel}</h1>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Source connected — now add a destination to start syncing.</p>
                </div>
                <div className="relative grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <div className="min-w-0 rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50/80 to-white p-5 shadow-md dark:border-cyan-500/30 dark:from-cyan-500/10 dark:to-slate-900/60">
                        <div className="mb-3 flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-cyan-200 bg-cyan-100/80 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/20 dark:text-cyan-300">
                                <Plug className="h-4 w-4" />
                            </div>
                            <p className="text-sm font-bold text-gray-900 dark:text-white">Sources</p>
                            <span className="ml-auto rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-bold text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300">{connectedSourcesCount} connected</span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Your ad &amp; marketplace sources are ready to sync.</p>
                        <Link href="/sources" className={cn(secondaryButtonLinkClassName, "mt-4 inline-flex text-xs font-semibold")}>Manage sources →</Link>
                    </div>

                    {/* Animated dashed bridge */}
                    <div className="pointer-events-none absolute inset-x-0 top-1/2 hidden -translate-y-1/2 items-center justify-center sm:flex" aria-hidden>
                        <svg width="48" height="24" viewBox="0 0 48 24" fill="none" className="text-cyan-400 dark:text-cyan-600">
                            <line x1="0" y1="12" x2="48" y2="12" stroke="currentColor" strokeWidth="2" strokeDasharray="6 4"
                                className="[stroke-dashoffset:0] animate-[dash_1.5s_linear_infinite]"
                                style={{ animation: "dashMove 1.5s linear infinite" }}
                            />
                        </svg>
                    </div>

                    <div className="min-w-0 rounded-2xl border border-dashed border-gray-300 bg-gradient-to-br from-gray-50/80 to-white p-5 shadow-sm dark:border-slate-600 dark:from-slate-900/70 dark:to-slate-800/50">
                        <div className="mb-3 flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-100 text-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-500">
                                <Send className="h-4 w-4" />
                            </div>
                            <p className="text-sm font-bold text-gray-400 dark:text-slate-500">Destination</p>
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500">Add Google Sheets or Looker Studio so your data has somewhere to land.</p>
                        <Link href="/destinations" className={cn(primaryButtonLinkClassName, "mt-4 inline-flex text-xs font-semibold")} onClick={() => trackEvent("destination_cta_clicked", { from: "stage1_bridge" })}>Add a destination →</Link>
                    </div>
                </div>
            </PageShell>
        );
    }

    if (dashboardStage === 2) {
        const stage2Templates = [
            {
                id: "paid-media",
                title: "Paid Media Performance",
                subtitle: "Compare ad spend and ROI across Meta and Google Ads.",
                icons: (
                    <div className="flex items-center gap-1.5">
                        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-600 text-[10px] font-black text-white">f</div>
                        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-red-500 text-[9px] font-black text-white">G</div>
                    </div>
                ),
                href: "/pipelines/new?template=paid-media",
            },
            {
                id: "facebook-insights",
                title: "Facebook Insights",
                subtitle: "Deep dive into campaign and ad-set level metrics.",
                icons: (
                    <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-600 text-[10px] font-black text-white">f</div>
                ),
                href: "/pipelines/new?template=facebook-insights",
            },
            {
                id: "custom",
                title: "Custom Pipeline",
                subtitle: "Map your own fields and build from scratch.",
                icons: (
                    <div className="flex h-6 w-6 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-gray-400 dark:border-slate-600">
                        <Plus className="h-3.5 w-3.5" />
                    </div>
                ),
                href: "/pipelines/new",
            },
        ];

        return (
            <PageShell>
                {/* Context strip */}
                <div className="mb-5">
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{workspaceName}</p>
                    <h1 className="mt-1 text-xl font-bold tracking-tight text-gray-900 dark:text-white">Today, {todayLabel}</h1>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {connectedSourcesCount}s · {connectedDestinationsCount}d connected — pick a template to create your first pipeline.
                    </p>
                </div>

                {/* Template selection bento */}
                <div className="rounded-2xl border border-gray-200/80 bg-gray-50/60 p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-800/30">
                    <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                        Create your pipeline — start with a template
                    </p>
                    <div className="stagger-list grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {stage2Templates.map((tpl) => {
                            const isBusy = templateBusy === tpl.id;
                            return (
                                <button
                                    key={tpl.id}
                                    type="button"
                                    disabled={templateBusy !== null}
                                    className="stagger-item bento-hover group flex min-w-0 items-center justify-between gap-3 rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm disabled:opacity-60 dark:border-slate-700/60 dark:bg-slate-900/60"
                                    onClick={() => {
                                        if (templateBusy) return;
                                        trackEvent("pipeline_template_clicked", { template: tpl.id, from: "stage2" });
                                        setTemplateBusy(tpl.id);
                                        setTimeout(() => {
                                            setMockPipelines([{
                                                id: `mock-${tpl.id}`,
                                                name: tpl.title,
                                                status: "active",
                                                updatedAt: new Date().toISOString(),
                                                logs: [],
                                                sourceConnection: { name: "Source" },
                                                destinationConnection: { name: "Destination" },
                                            }]);
                                            setTemplateBusy(null);
                                        }, 600);
                                    }}
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className="shrink-0">{tpl.icons}</div>
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{tpl.title}</p>
                                            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{tpl.subtitle}</p>
                                        </div>
                                    </div>
                                    {isBusy
                                        ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cyan-500" />
                                        : <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 transition-colors group-hover:text-cyan-500 dark:text-slate-600 dark:group-hover:text-cyan-400" />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </PageShell>
        );
    }

    return (
        <PageShell>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-slate-500">{workspaceName}</p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">Operational view · {todayLabel}</p>
                </div>
                <RefreshedAt onRefresh={handleManualRefresh} loading={isRefreshing} />
            </div>

            {syncMsg ? (
                <div className={[
                    "mb-6 rounded-lg border px-4 py-3 text-sm",
                    /fail|error|could not|sorry/i.test(syncMsg)
                        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300"
                        : "border-cyan-100 bg-cyan-50/70 text-cyan-700 dark:border-cyan-900/40 dark:bg-cyan-950/30 dark:text-cyan-200"
                ].join(" ")}>
                    {syncMsg}
                </div>
            ) : null}

            <PipelineHealthOverview
                sources={sourceHealth}
                volume={warehouseVolume}
                incidents={incidents}
                onRefreshAll={runStalePipelines}
                isRefreshing={syncAllBusy}
            />

            <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-5">
                <div className="space-y-5 xl:col-span-3">

                    {/* 2 · KPI metrics — morning number check */}
                    {snapshots.length > 0 && (
                        <section>
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                                Performance
                            </p>
                            <MetricCardGrid snapshots={snapshots} />
                        </section>
                    )}

                    <section>
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                            Recent Activity
                        </p>
                        <RecentActivity
                            pipelines={pipelines}
                            isLoading={isLoading}
                            error={error}
                            syncingPipelineId={syncingPipelineId}
                            onSync={runPipeline}
                        />
                    </section>

                    <section>
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                            AI Insights
                        </p>
                        <AiPerformanceSummary workspaceId={workspaceId} />
                    </section>
                </div>
                <div className="xl:col-span-2">
                    {snapshots.length > 0 && <RoasSnapshotCard snapshots={snapshots} />}
                </div>
            </div>

            <section className="mt-4 border-t border-gray-100 pt-4 dark:border-slate-800">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                    Infrastructure
                </p>
                <HealthSummaryBar />
            </section>
        </PageShell>
    );
}
