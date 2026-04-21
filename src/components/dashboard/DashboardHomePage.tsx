"use client";

import React from "react";
import Link from "next/link";
import { Database } from "lucide-react";
import useSWR from "swr";
import { useResolvedWorkspaceId } from "@/hooks/use-resolved-workspace-id";
import { primaryButtonLinkClassName } from "@/components/ui/PrimaryButton";
import { HealthDashboard } from "@/components/HealthDashboard";
import { AiPerformanceSummary } from "@/components/AiPerformanceSummary";
import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusHero } from "@/components/dashboard/StatusHero";
import { MetricCardGrid } from "@/components/dashboard/MetricCardGrid";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { SetupWizard } from "@/components/dashboard/SetupWizard";
import { PillarGrid } from "@/components/dashboard/PillarGrid";
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
    const [syncingPipelineId, setSyncingPipelineId] = React.useState<string | null>(null);
    const [syncAllBusy, setSyncAllBusy] = React.useState(false);
    const [syncMsg, setSyncMsg] = React.useState<string>("");
    const [wizardDismissed, setWizardDismissed] = React.useState(false);

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
                    description="We couldn’t load a workspace for your account. Try refreshing or contact support."
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
                onSyncAll={runAllPipelines}
                syncing={syncAllBusy}
            />

            {syncMsg ? (
                <div className="mb-6 rounded-lg border border-cyan-100 bg-cyan-50/70 px-4 py-3 text-sm text-cyan-700 dark:border-cyan-900/40 dark:bg-cyan-950/30 dark:text-cyan-200">
                    {syncMsg}
                </div>
            ) : null}

            {/* ── KPI Row ──────────────────────────────────────── */}
            {snapshots.length > 0 && (
                <div className="mb-8">
                    <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                        Today's Performance
                    </p>
                    <MetricCardGrid snapshots={snapshots} />
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

            {/* ── Main Body: 2 column on large screens ─────────── */}
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">

                {/* Left column — primary content (3/5 width) */}
                <div className="space-y-6 xl:col-span-3">
                    {/* AI Insights */}
                    <section>
                        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                            Performance Insights
                        </p>
                        <AiPerformanceSummary workspaceId={workspaceId} />
                    </section>

                    {/* Recent Syncs */}
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
                </div>

                {/* Right column — connections (2/5 width) */}
                <div className="xl:col-span-2">
                    <section>
                        <div className="mb-3 flex items-center justify-between">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                                Connections
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
                            latestNetRoas={snapshots.length ? snapshots[snapshots.length - 1].netRoas : null}
                        />
                    </section>
                </div>
            </div>

            {/* ── System Health — full width ────────────────────── */}
            <section className="mt-4">
                <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                    System Health
                </p>
                <HealthDashboard />
            </section>
        </PageShell>
    );
}
