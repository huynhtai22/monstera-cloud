"use client";

import React from "react";
import Link from "next/link";
import { Database } from "lucide-react";
import useSWR, { useSWRConfig } from "swr";
import { useResolvedWorkspaceId } from "@/hooks/use-resolved-workspace-id";
import { primaryButtonLinkClassName } from "@/components/ui/PrimaryButton";
import { AiPerformanceSummary } from "@/components/AiPerformanceSummary";
import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusHero } from "@/components/dashboard/StatusHero";
import { MetricCardGrid } from "@/components/dashboard/MetricCardGrid";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { SetupWizard } from "@/components/dashboard/SetupWizard";
import { PillarGrid } from "@/components/dashboard/PillarGrid";
import { HealthSummaryBar } from "@/components/dashboard/HealthSummaryBar";
import { RefreshedAt } from "@/components/ui/RefreshedAt";
import { trackEvent, trackOnce } from "@/lib/analytics-events";

const WIZARD_DISMISS_KEY = "monstera_setup_wizard_dismissed_v1";

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
    logs?: Array<{ rowsSynced?: number }>;
    sourceConnection?: { name?: string };
    destinationConnection?: { name?: string };
};

type SyncLog = {
    id: string;
    status: string;
    createdAt: string;
    pipeline?: { id: string; name: string } | null;
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

    const handleManualRefresh = React.useCallback(async () => {
        setIsRefreshing(true);
        await mutate(() => true, undefined, { revalidate: true });
        setIsRefreshing(false);
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

    const { data: pipelines, error, isLoading } = useSWR<Pipeline[], Error>(
        workspaceId ? `/api/pipelines?workspaceId=${workspaceId}` : null,
        fetcher
    );

    const activePipelinesCount = pipelines?.length ?? 0;

    const { data: syncLogsData } = useSWR<{ logs: SyncLog[] }>(
        workspaceId ? `/api/sync-logs?workspaceId=${workspaceId}` : null,
        fetcher
    );
    const logs = syncLogsData?.logs ?? [];
    const hasSuccessfulSync = logs.some((l) => l.status === "success");

    const { data: attributionData } = useSWR<{ snapshots: AttributionSnapshot[] }>(
        workspaceId ? `/api/attribution/snapshots?workspaceId=${workspaceId}&days=14` : null,
        fetcher
    );
    const snapshots = attributionData?.snapshots ?? [];

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
    const hasDestination = connectedDestinationsCount > 0;

    const healthyCount = pipelines
        ? pipelines.filter((p) => p.status !== "error").length
        : 0;

    const lastSyncLabel = React.useMemo(() => {
        if (!logs.length) return null;
        const latest = logs.reduce((acc, l) =>
            new Date(l.createdAt).getTime() > new Date(acc.createdAt).getTime() ? l : acc
        );
        if (!latest?.createdAt) return null;
        return new Date(latest.createdAt).toLocaleString();
    }, [logs]);

    const lastSyncDate = React.useMemo(() => {
        if (!logs.length) return null;
        const latest = logs.reduce((acc, l) =>
            new Date(l.createdAt).getTime() > new Date(acc.createdAt).getTime() ? l : acc
        );
        return latest?.createdAt ? new Date(latest.createdAt) : null;
    }, [logs]);

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
            setSyncMsg(typeof data.message === "string" ? data.message : "Sync started.");
            trackEvent("wizard_step_completed", { step: "sync_manual", pipelineId });
            trackEvent("pipeline_manual_sync_succeeded", { pipelineId, source: "dashboard" });
        } catch (e: unknown) {
            setSyncMsg(e instanceof Error ? e.message : "Sync failed");
        } finally {
            setSyncingPipelineId(null);
        }
    };

    const runAllPipelines = async () => {
        if (!pipelines || pipelines.length === 0) return;
        setSyncAllBusy(true);
        setSyncMsg("");
        try {
            for (const p of pipelines) {
                await fetch(`/api/pipelines/${p.id}/run`, { method: "POST" });
            }
            setSyncMsg("Sync requested for all pipelines.");
            trackEvent("wizard_step_completed", { step: "sync_all", count: pipelines.length });
            trackEvent("pipeline_manual_sync_succeeded", { count: pipelines.length, source: "dashboard_sync_all" });
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
                    icon={<Database className="h-12 w-12" />}
                    title="No workspace"
                    description="We couldn't load a workspace for your account. Try refreshing or contact support."
                />
            </PageShell>
        );
    }

    if (connectedSourcesCount === 0) {
        if (wizardDismissed) {
            return (
                <PageShell>
                    <EmptyState
                        icon={<Database className="h-12 w-12" />}
                        title="No sources connected"
                        description="Connect TikTok, Meta, Google Ads, or Shopee to start syncing data into your workspace."
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
                    hasDestination={hasDestination}
                    hasSuccessfulSync={hasSuccessfulSync}
                    onDismiss={dismissWizard}
                />
            </PageShell>
        );
    }

    return (
        <PageShell>
            {/* ── Header strip ─────────────────────────────────── */}
            <StatusHero
                workspaceName={workspaceName}
                todayLabel={todayLabel}
                healthyCount={healthyCount}
                totalPipelines={activePipelinesCount}
                lastSyncLabel={lastSyncLabel}
                lastSyncDate={lastSyncDate}
                onSyncAll={runAllPipelines}
                syncing={syncAllBusy}
            />

            {/* X1: last-refreshed indicator */}
            <div className="mb-2 flex justify-end">
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

            {/* D7: warn when data is flowing but nowhere to land */}
            {hasSource && !hasDestination && connectedSourcesCount > 0 && (
                <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200/90 bg-amber-50/90 px-4 py-3 dark:border-amber-800/50 dark:bg-amber-950/30">
                    <span className="mt-0.5 text-amber-500 dark:text-amber-400">⚠</span>
                    <div className="text-sm">
                        <span className="font-semibold text-amber-900 dark:text-amber-100">Your data has nowhere to land. </span>
                        <span className="text-amber-800 dark:text-amber-200">
                            Sources are syncing but no destination is connected — data is being dropped.{" "}
                        </span>
                        <a href="/destinations" className="font-semibold underline underline-offset-2 text-amber-900 hover:text-amber-700 dark:text-amber-100 dark:hover:text-amber-300">
                            Add Google Sheets →
                        </a>
                    </div>
                </div>
            )}

            {/* ── Setup Wizard (shown inline, full-width) ────── */}
            {!hasSuccessfulSync && hasSource ? (
                <div className="mb-8">
                    <SetupWizard
                        hasSource={hasSource}
                        hasDestination={hasDestination}
                        hasSuccessfulSync={hasSuccessfulSync}
                        onDismiss={dismissWizard}
                    />
                </div>
            ) : null}

            {/* ── Main Body ─────────────────────────────────────── */}
            {/*
                Priority reading order (matches 10AM check-in AND 2AM emergency):
                1. Status snapshot  → PillarGrid (right col rendered FIRST on mobile via order-first)
                2. KPI numbers      → MetricCardGrid (did the numbers look good?)
                3. What ran/failed  → RecentActivity (specific pipeline detail)
                4. Deeper analysis  → AiPerformanceSummary (when you have time)
                5. Infrastructure   → HealthSummaryBar (confirmation strip, not discovery)
            */}
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">

                {/* ── RIGHT: Status snapshot (2/5) — shown FIRST on mobile via order-first */}
                <div className="order-first xl:order-last xl:col-span-2">
                    <div className="mb-3 flex items-center justify-between">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                            Status
                        </p>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-slate-800 dark:text-slate-400">
                            {connectedSourcesCount}s · {connectedDestinationsCount}d
                        </span>
                    </div>
                    <PillarGrid
                        connections={connections}
                        syncLogs={logs}
                        healthyCount={healthyCount}
                        totalPipelines={activePipelinesCount}
                    />
                </div>

                {/* ── LEFT: Detail (3/5) — KPIs → Activity → AI Digest */}
                <div className="space-y-8 xl:col-span-3">

                    {/* 2 · KPI metrics — morning number check */}
                    {snapshots.length > 0 && (
                        <section>
                            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                                Performance
                            </p>
                            <MetricCardGrid snapshots={snapshots} />
                        </section>
                    )}

                    {/* 3 · Recent Activity — what ran, what failed, one-click re-sync */}
                    <section>
                        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
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

                    {/* 4 · AI Digest — deeper analysis, read when you have time */}
                    <section>
                        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                            AI Insights
                        </p>
                        <AiPerformanceSummary workspaceId={workspaceId} />
                    </section>
                </div>
            </div>

            {/* 5 · System Health — confirmation strip, not discovery */}
            <section className="mt-8 border-t border-gray-100 pt-6 dark:border-slate-800">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                    Infrastructure
                </p>
                <HealthSummaryBar />
            </section>
        </PageShell>
    );
}
