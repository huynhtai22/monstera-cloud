"use client";

import React from "react";
import Link from "next/link";
import { Database, Loader2, RefreshCw } from "lucide-react";
import useSWR, { useSWRConfig } from "swr";
import { useResolvedWorkspaceId } from "@/hooks/use-resolved-workspace-id";
import { PrimaryButton, primaryButtonLinkClassName } from "@/components/ui/PrimaryButton";
import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { SetupWizard } from "@/components/dashboard/SetupWizard";
import { PillarGrid } from "@/components/dashboard/PillarGrid";
import { HealthSummaryBar } from "@/components/dashboard/HealthSummaryBar";
import { TodaysDataFlow } from "@/components/dashboard/TodaysDataFlow";
import { RefreshedAt } from "@/components/ui/RefreshedAt";
import { trackEvent, trackOnce } from "@/lib/analytics-events";
import { cn } from "@/lib/utils";

const WIZARD_DISMISS_KEY = "monstera_setup_wizard_dismissed_v1";

const consoleShellClass =
    "mx-auto w-full max-w-[min(100%,1560px)] px-5 py-10 sm:px-8 sm:py-12 lg:px-12 lg:py-14";

function DashboardSectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={cn("mb-4 flex items-center gap-2.5", className)}>
            <span
                className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-cyan-400 to-teal-500 shadow-[0_0_12px_rgba(34,211,238,0.45)]"
                aria-hidden
            />
            <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">{children}</span>
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
    lastSyncAt?: string | null;
};

type Workspace = {
    id: string;
    name?: string | null;
    connections?: Connection[];
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

    const { data: connectionsData = [] } = useSWR<Connection[]>(
        workspaceId ? `/api/workspaces/${workspaceId}/connections` : null,
        fetcher,
    );

    const { connections, connectedSourcesCount, workspaceName } = React.useMemo(() => {
        if (!workspaceId || !Array.isArray(workspaces)) {
            return { connections: [] as Connection[], connectedSourcesCount: 0, workspaceName: "" };
        }
        const list = workspaces as Workspace[];
        const ws = list.find((w) => w.id === workspaceId) || list[0];
        const conns = Array.isArray(connectionsData) ? connectionsData : [];
        return {
            connections: conns,
            connectedSourcesCount: conns.filter((c) => c.type === "source").length,
            workspaceName: ws?.name ?? "Workspace",
        };
    }, [workspaces, workspaceId, connectionsData]);

    const hasSource = connectedSourcesCount > 0;
    const sourceConnections = React.useMemo(() => connections.filter((connection) => connection.type === "source"), [connections]);
    const hasSuccessfulSync = sourceConnections.some((connection) => Boolean(connection.lastSyncAt));
    const freshCutoff = Date.now() - 26 * 60 * 60 * 1000;
    const healthyCount = sourceConnections.filter((connection) =>
        connection.status === "connected" && connection.lastSyncAt && new Date(connection.lastSyncAt).getTime() >= freshCutoff
    ).length;

    const lastSyncLabel = React.useMemo(() => {
        const synced = sourceConnections.filter((connection) => connection.lastSyncAt);
        if (!synced.length) return null;
        const latest = synced.reduce((acc, connection) =>
            new Date(connection.lastSyncAt!).getTime() > new Date(acc.lastSyncAt!).getTime() ? connection : acc
        );
        return latest.lastSyncAt ? new Date(latest.lastSyncAt).toLocaleString() : null;
    }, [sourceConnections]);

    const todayLabel = new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
    });

    const runAllPipelines = async () => {
        if (!workspaceId || sourceConnections.length === 0) return;
        setSyncAllBusy(true);
        setSyncMsg("");
        try {
            const response = await fetch("/api/data-explorer/warehouse/import-batch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    workspaceId,
                    since: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
                    until: new Date().toISOString().slice(0, 10),
                    items: sourceConnections.map((connection) => ({ connectionId: connection.id })),
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) throw new Error(payload.error || payload.message || "Refresh failed");
            setSyncMsg(`${payload.okCount}/${payload.totalJobs} sources refreshed; ${Number(payload.approximateRows || 0).toLocaleString()} rows processed.`);
            await handleManualRefresh();
            trackEvent("warehouse_manual_refresh_completed", { count: sourceConnections.length });
        } catch (refreshError: unknown) {
             setSyncMsg(refreshError instanceof Error ? refreshError.message : "Some imports failed — check Sync activity.");
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
        <PageShell className={consoleShellClass}>
                <div className="animate-pulse space-y-6 p-2">
                    <div className="h-10 max-w-md rounded-lg bg-slate-200/80 dark:bg-[#1d1f23]/80" />
                    <div className="h-36 rounded-2xl bg-slate-100 dark:bg-[#16181c]/80" />
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="h-48 rounded-xl bg-slate-100 dark:bg-[#16181c]/80" />
                        <div className="h-48 rounded-xl bg-slate-100 dark:bg-[#16181c]/80" />
                    </div>
                </div>
            </PageShell>
        );
    }

    if (!workspaceId) {
        return (
            <PageShell className={consoleShellClass}>
                <EmptyState
                    icon={<Database className="h-5 w-5" />}
                    title="No workspace"
                    description="We couldn't load a workspace for your account. Try refreshing or contact support."
                />
            </PageShell>
        );
    }

    // ── Onboarding State Machine ──────────────────────────
    // Stage 0: no sources
    // Stage 1: sources > 0, but no pipelines
    const dashboardStage = connectedSourcesCount === 0 ? 0 : 1;

    if (dashboardStage === 0) {
        if (wizardDismissed) {
            return (
                <PageShell className={consoleShellClass}>
                    <EmptyState
                        icon={<Database className="h-5 w-5" />}
                        title="No sources connected"
                        description="Connect an ad platform or marketplace source to get started."
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
            <PageShell className={consoleShellClass}>
                <SetupWizard
                    hasSource={hasSource}
                    hasSuccessfulSync={hasSuccessfulSync}
                    onDismiss={dismissWizard}
                />
            </PageShell>
        );
    }

    return (
        <PageShell className={consoleShellClass}>
            {/* Hero */}
            <div className="relative z-10 mb-10 overflow-hidden rounded-3xl border border-gray-200/85 bg-gradient-to-br from-white via-cyan-50/35 to-teal-50/25 p-6 shadow-md ring-1 ring-black/[0.04] dark:border-slate-700/70 dark:from-slate-900 dark:via-slate-900 dark:to-cyan-950/30 dark:ring-white/[0.06] sm:p-8">
                <div className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full bg-gradient-to-br from-cyan-300/25 to-teal-400/15 blur-3xl dark:from-cyan-500/15 dark:to-teal-600/10" />
                <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-slate-500">{workspaceName}</p>
                        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
                            Dashboard
                        </h1>
                        <p className="mt-1 text-base font-medium text-gray-600 dark:text-slate-300">{todayLabel}</p>
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                        {connectedSourcesCount === 0 ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-[11px] font-semibold text-gray-500 dark:border-[#2f3336] dark:bg-[#16181c] dark:text-slate-400">
                                No sources yet
                            </span>
                        ) : healthyCount === connectedSourcesCount ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                {connectedSourcesCount} source{connectedSourcesCount > 1 ? "s" : ""} fresh
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                                {connectedSourcesCount - healthyCount} of {connectedSourcesCount} need refresh
                            </span>
                        )}
                        {lastSyncLabel && (
                            <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-medium text-gray-600 ring-1 ring-gray-200/80 dark:bg-slate-800/80 dark:text-slate-300 dark:ring-slate-600/60">
                                Last sync <span className="font-semibold text-gray-800 dark:text-white">{lastSyncLabel}</span>
                            </span>
                        )}
                        </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-3 lg:flex-col lg:items-stretch xl:flex-row">
                    <RefreshedAt onRefresh={handleManualRefresh} loading={isRefreshing} />
                    <PrimaryButton
                        type="button"
                        onClick={runAllPipelines}
                        disabled={syncAllBusy || connectedSourcesCount === 0}
                        className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold shadow-lg shadow-cyan-500/15"
                    >
                        {syncAllBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Refresh all sources
                    </PrimaryButton>
                    </div>
                </div>
            </div>

            {/* Sync feedback message */}
            {syncMsg ? (
                <div className={[
                    "mb-6 rounded-2xl border px-5 py-4 text-sm",
                    /fail|error|could not|sorry/i.test(syncMsg)
                        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300"
                        : "border-cyan-100 bg-cyan-50/70 text-cyan-700 dark:border-cyan-900/40 dark:bg-cyan-950/30 dark:text-cyan-200"
                ].join(" ")}>
                    {syncMsg}
                </div>
            ) : null}

            {/* Setup wizard (shown when source connected but no successful sync yet) */}
            {!hasSuccessfulSync && hasSource ? (
                <div className="mb-8">
                    <SetupWizard
                        hasSource={hasSource}
                        hasSuccessfulSync={hasSuccessfulSync}
                        onDismiss={dismissWizard}
                    />
                </div>
            ) : null}

            {/* Main: activity stream vs status */}
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10 xl:gap-12">

                <div className="flex min-w-0 flex-col gap-8 lg:col-span-7 xl:col-span-8">
                    <div className="rounded-3xl border border-gray-200/75 bg-gradient-to-b from-gray-50/90 to-white p-6 ring-1 ring-black/[0.03] dark:border-slate-700/65 dark:from-slate-900/50 dark:to-slate-950/40 dark:ring-white/[0.04] sm:p-8 lg:p-9">
                        <DashboardSectionLabel>Activity stream</DashboardSectionLabel>

                    <TodaysDataFlow />

                    <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/50">
                        <h2 className="font-semibold text-gray-900 dark:text-white">Verify the warehouse</h2>
                        <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">Review rows, account coverage, and the latest warehouse timestamp before using Sheets, Looker Studio, or an API key.</p>
                        <Link href="/explorer?tab=warehouse" className="mt-4 inline-flex text-sm font-semibold text-cyan-700 hover:text-cyan-800 dark:text-cyan-300">Open Data Explorer →</Link>
                    </div>
                    </div>
                </div>

                <aside className="min-w-0 lg:col-span-5 xl:col-span-4 lg:sticky lg:top-24 lg:self-start">
                    <div className="rounded-3xl border border-gray-200/75 bg-gradient-to-b from-white to-gray-50/80 p-5 shadow-sm ring-1 ring-black/[0.03] dark:border-slate-700/65 dark:from-slate-900/55 dark:to-slate-950/40 dark:ring-white/[0.05] sm:p-6">
                    <div className="mb-6 flex items-center justify-between gap-3 border-b border-gray-100 pb-5 dark:border-slate-700/55">
                        <DashboardSectionLabel className="mb-0">Workspace status</DashboardSectionLabel>
                        <span className="rounded-full bg-cyan-50 px-3 py-1 text-[11px] font-bold text-cyan-800 ring-1 ring-cyan-200/80 dark:bg-cyan-950/50 dark:text-cyan-200 dark:ring-cyan-800/50">
                            {connectedSourcesCount} source{connectedSourcesCount !== 1 ? "s" : ""}
                        </span>
                    </div>
                    <PillarGrid
                        connections={connections}
                        healthyCount={healthyCount}
                    />
                    </div>
                </aside>
            </div>

            <section className="mt-12 border-t border-gray-200/70 pt-10 dark:border-slate-700/60">
                <DashboardSectionLabel>Infrastructure health</DashboardSectionLabel>
                <HealthSummaryBar />
            </section>
        </PageShell>
    );
}
