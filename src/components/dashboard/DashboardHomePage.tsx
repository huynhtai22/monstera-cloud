"use client";

import React from "react";
import Link from "next/link";
import {
    CheckCircle2,
    Circle,
    ListChecks,
    Zap,
    ArrowRight,
    Database,
} from "lucide-react";
import useSWR from "swr";
import { useResolvedWorkspaceId } from "@/hooks/use-resolved-workspace-id";
import { cn } from "@/lib/utils";
import { primaryButtonLinkClassName } from "@/components/ui/PrimaryButton";
import { secondaryButtonLinkClassName } from "@/components/ui/SecondaryButton";
import { HealthDashboard } from "@/components/HealthDashboard";
import { AiPerformanceSummary } from "@/components/AiPerformanceSummary";
import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusHero } from "@/components/dashboard/StatusHero";
import { MetricCardGrid } from "@/components/dashboard/MetricCardGrid";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { SetupWizard } from "@/components/dashboard/SetupWizard";
import { trackEvent, trackOnce } from "@/lib/analytics-events";

const WIZARD_DISMISS_KEY = "monstera_setup_wizard_dismissed_v1";

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

    const { data: pipelines, error, isLoading } = useSWR(
        workspaceId ? `/api/pipelines?workspaceId=${workspaceId}` : null,
        fetcher
    );

    const activePipelinesCount = Array.isArray(pipelines) ? pipelines.length : 0;

    const { data: syncLogsData } = useSWR(
        workspaceId ? `/api/sync-logs?workspaceId=${workspaceId}` : null,
        fetcher
    );
    const logs = (syncLogsData?.logs ?? []) as Array<{ status: string }>;
    const hasSuccessfulSync = logs.some((l) => l.status === "success");

    const { data: attributionData } = useSWR(
        workspaceId ? `/api/attribution/snapshots?workspaceId=${workspaceId}&days=14` : null,
        fetcher
    );
    const snapshots = (attributionData?.snapshots ?? []) as Array<{
        date: string;
        netRoas: number;
        adSpend: number;
        attributedRevenue: number;
    }>;

    const { connectedSourcesCount, connectedDestinationsCount, workspaceName } = React.useMemo(() => {
        if (!Array.isArray(workspaces) || !workspaceId) {
            return { connectedSourcesCount: 0, connectedDestinationsCount: 0, workspaceName: "" };
        }
        const ws = workspaces.find((w: any) => w.id === workspaceId) || workspaces[0];
        const conns = ws?.connections || [];
        return {
            connectedSourcesCount: conns.filter((c: any) => c.type === "source").length,
            connectedDestinationsCount: conns.filter((c: any) => c.type === "destination").length,
            workspaceName: ws?.name ?? "Workspace",
        };
    }, [workspaces, workspaceId]);

    const hasSource = connectedSourcesCount > 0;
    const hasDestination = connectedDestinationsCount > 0;
    const hasPipeline = activePipelinesCount > 0;

    const healthyCount = Array.isArray(pipelines)
        ? pipelines.filter((p: { status: string }) => p.status !== "error").length
        : 0;

    const lastSyncLabel = React.useMemo(() => {
        if (!logs.length) return null;
        const sorted = [...logs].sort(
            (a, b) => new Date((b as { createdAt?: string }).createdAt ?? 0).getTime() - new Date((a as { createdAt?: string }).createdAt ?? 0).getTime()
        );
        const t = sorted[0] as { createdAt?: string } | undefined;
        if (!t?.createdAt) return null;
        return new Date(t.createdAt).toLocaleString();
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
        if (!Array.isArray(pipelines) || pipelines.length === 0) return;
        setSyncAllBusy(true);
        setSyncMsg("");
        try {
            for (const p of pipelines as Array<{ id: string }>) {
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
                <div className="relative z-10 mb-6 rounded-lg border border-cyan-100 bg-cyan-50/70 px-4 py-3 text-sm text-cyan-700 dark:border-cyan-900/40 dark:bg-cyan-950/30 dark:text-cyan-200">
                    {syncMsg}
                </div>
            ) : null}

            <MetricCardGrid snapshots={snapshots} />

            <div className="relative z-10 mb-8">
                <AiPerformanceSummary workspaceId={workspaceId} />
            </div>

            <div className="relative z-10 mb-12">
                <HealthDashboard />
            </div>

            {!hasSuccessfulSync && hasSource ? (
                <div className="relative z-10 mb-10">
                    <SetupWizard
                        hasSource={hasSource}
                        hasDestination={hasDestination}
                        hasSuccessfulSync={hasSuccessfulSync}
                        onDismiss={dismissWizard}
                    />
                </div>
            ) : null}

            <div className="relative z-10 grid grid-cols-1 gap-8 lg:grid-cols-3">
                <div className="flex flex-col gap-6 lg:col-span-2">
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
                            <div className="mb-4 flex items-center gap-2">
                                <ListChecks className="h-5 w-5 text-primary" />
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Getting Started</h3>
                            </div>
                            <ul className="space-y-3">
                                <li className="flex items-start gap-2 text-sm">
                                    {hasSource ? (
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
                                    ) : (
                                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
                                    )}
                                    <span className={hasSource ? "text-gray-700 dark:text-gray-200" : "text-gray-500"}>Connect a data source</span>
                                </li>
                                <li className="flex items-start gap-2 text-sm">
                                    {hasDestination ? (
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
                                    ) : (
                                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
                                    )}
                                    <span className={hasDestination ? "text-gray-700 dark:text-gray-200" : "text-gray-500"}>Set a destination</span>
                                </li>
                                <li className="flex items-start gap-2 text-sm">
                                    {hasPipeline ? (
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
                                    ) : (
                                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
                                    )}
                                    <span className={hasPipeline ? "text-gray-700 dark:text-gray-200" : "text-gray-500"}>Deploy a pipeline</span>
                                </li>
                                <li className="flex items-start gap-2 text-sm text-gray-400 dark:text-gray-500">
                                    <Circle className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>Schedule sync (coming soon)</span>
                                </li>
                            </ul>
                        </div>

                        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
                            <div className="mb-4 flex items-center gap-2">
                                <Zap className="h-5 w-5 text-primary" />
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Quick Actions</h3>
                            </div>
                            <div className="flex flex-col gap-2">
                                <Link href="/sources" className={cn(primaryButtonLinkClassName, "w-full justify-between")}>
                                    Connect Source
                                    <ArrowRight className="h-4 w-4" />
                                </Link>
                                <Link href="/transformations" className={cn(secondaryButtonLinkClassName, "w-full justify-between")}>
                                    Create Pipeline
                                    <ArrowRight className="h-4 w-4" />
                                </Link>
                                <Link href="/docs" className={cn(secondaryButtonLinkClassName, "w-full justify-between")}>
                                    View Docs
                                    <ArrowRight className="h-4 w-4" />
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>

                <RecentActivity
                    pipelines={pipelines as any}
                    isLoading={isLoading}
                    error={error as any}
                    syncingPipelineId={syncingPipelineId}
                    onSync={runPipeline}
                />
            </div>
        </PageShell>
    );
}
