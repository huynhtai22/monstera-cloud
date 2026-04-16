"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import Link from "next/link";
import { toast } from "sonner";
import { Database, Search, Plus, RefreshCw, AlertCircle, Loader2, CheckCircle2, CloudOff, Unplug } from "lucide-react";
import { ConnectSourceModal } from "@/components/ConnectSourceModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import useSWR, { useSWRConfig } from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { integrationCatalogId } from "@/lib/integration-catalog";
import { logoPathForCatalogId, logoPathForConnectionProvider } from "@/lib/integration-logos";
import { cn } from "@/lib/utils";
import { trackEvent, trackOnce } from "@/lib/analytics-events";
import { PageShell } from "@/components/ui/PageShell";

const fetcher = async (url: string) => {
    const res = await fetch(url, { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch data');
    }
    return data;
};

const ALL_CATALOG_INTEGRATIONS = [
    { id: 'tiktok_shop', name: 'TikTok Shop', description: 'Seller catalog, orders, and Shop analytics.', status: 'available' as const, logoSrc: logoPathForCatalogId('tiktok_shop') },
    { id: 'tiktok_business', name: 'TikTok Ads', description: 'TikTok Marketing API — campaign and ad performance reporting.', status: 'available' as const, logoSrc: logoPathForCatalogId('tiktok_business') },
    { id: 'meta_ads', name: 'Meta Ads', description: 'Facebook & Instagram Ads — campaign, ad set, and ad performance via Marketing API.', status: 'available' as const, logoSrc: logoPathForCatalogId('meta_ads') },
    { id: 'google_ads', name: 'Google Ads', description: 'Search, Shopping, and Performance Max reporting via Google Ads API.', status: 'available' as const, logoSrc: logoPathForCatalogId('google_ads') },
    { id: 'shopee', name: 'Shopee', description: 'Orders, products, and shop analytics from Shopee Open Platform.', status: 'available' as const, logoSrc: logoPathForCatalogId('shopee') },
    { id: 'lazada', name: 'Lazada Seller', description: 'Order fulfillments and finance.', status: 'available' as const, logoSrc: logoPathForCatalogId('lazada') },
    { id: 'shopify', name: 'Shopify', description: 'E-commerce platform orders.', status: 'available' as const, logoSrc: logoPathForCatalogId('shopify') },
];

function catalogIntegrationFromId(catalogId: string) {
    return ALL_CATALOG_INTEGRATIONS.find((a) => a.id === catalogId) ?? null;
}

function IntegrationCardSkeleton() {
    return (
        <div
            className="relative overflow-hidden rounded-2xl border border-white/80 dark:border-slate-700/60 bg-white/40 dark:bg-slate-900/40 p-5 animate-pulse"
            aria-hidden
        >
            <div className="flex items-start justify-between mb-4">
                <div className="h-12 w-12 rounded-xl bg-gray-200/90 dark:bg-slate-700/90" />
                <div className="h-6 w-24 rounded-md bg-gray-200/80 dark:bg-slate-700/80" />
            </div>
            <div className="mb-6 space-y-2">
                <div className="h-4 max-w-[10rem] rounded bg-gray-200/90 dark:bg-slate-700/90" />
                <div className="h-3 w-full rounded bg-gray-100 dark:bg-slate-800/90" />
                <div className="h-3 max-w-[14rem] w-[92%] rounded bg-gray-100 dark:bg-slate-800/90" />
            </div>
            <div className="h-9 w-full rounded-lg bg-gray-200/80 dark:bg-slate-700/80" />
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * #7 — Extracted IntegrationCard (React.memo for re-render isolation)
 * ───────────────────────────────────────────────────────────────────────────── */

interface IntegrationCardProps {
    integration: any;
    busyActions: Set<string>;
    onSync: (pipelineId: string, integrationId: string) => void;
    onDisconnect: (connectionId: string, displayName: string) => void;
    onFixConnection: (integration: any) => void;
    onConnect: (integration: any) => void;
}

const IntegrationCard = React.memo(function IntegrationCard({
    integration,
    busyActions,
    onSync,
    onDisconnect,
    onFixConnection,
    onConnect,
}: IntegrationCardProps) {
    const isSyncing = busyActions.has(`sync:${integration.pipelineId}`);
    const isDisconnecting = busyActions.has(integration.id);
    const isBusy = busyActions.size > 0;

    return (
        <div
            className={`relative overflow-hidden bg-white/60 dark:bg-slate-900/50 rounded-2xl border p-5 transition-all duration-200 group flex flex-col justify-between shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 hover:bg-white/80 dark:hover:bg-slate-900/60
                ${integration.status === 'error' ? 'border-red-200/80 hover:border-red-300' : 'border-gray-200/80 dark:border-slate-700/60 hover:border-cyan-200/80'}`}
        >
            <div className="flex items-start justify-between mb-3 relative z-10">
                <div className={`relative w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 transition-colors bg-white/70 dark:bg-slate-900/50 overflow-hidden
                    ${integration.status === 'connected' ? 'border-cyan-100/50' :
                        integration.status === 'syncing' ? 'border-blue-100/50' :
                            integration.status === 'error' ? 'border-red-100/50' :
                                'border-gray-200 dark:border-slate-700/50 grayscale opacity-70 group-hover:grayscale-0 group-hover:opacity-100'}`}>
                    <img
                        src={integration.logoSrc}
                        alt={`${integration.name} logo`}
                        width={28}
                        height={28}
                        className="object-contain"
                    />
                </div>

                <div className="flex items-center">
                    {integration.status === 'connected' && (
                        <div className="flex items-center text-xs font-semibold text-cyan-700 bg-cyan-50 px-2 py-1 rounded-md">
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                            Connected
                        </div>
                    )}
                    {integration.status === 'syncing' && (
                        <div className="flex items-center text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded-md">
                            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                            Syncing
                        </div>
                    )}
                    {integration.status === 'error' && (
                        <div className="flex items-center text-xs font-semibold text-red-700 bg-red-50 px-2 py-1 rounded-md">
                            <AlertCircle className="w-3.5 h-3.5 mr-1" />
                            Error
                        </div>
                    )}
                </div>
            </div>

            <div className="mb-5 flex-1">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1 tracking-tight">{integration.name}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">{integration.description}</p>

                {integration.status === 'error' && (
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-2 flex items-start gap-1">
                        <CloudOff className="w-3 h-3 mr-1 shrink-0 mt-0.5" />
                        <span>
                            {integration.errorMsg ||
                                "Connection issue. Try Fix Connection or disconnect and add this source again."}
                        </span>
                    </p>
                )}
                {integration.status !== 'available' && integration.status !== 'error' && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 font-medium">
                        Last synced: {integration.lastSync}
                    </p>
                )}
            </div>

            <div className="relative z-10">
                {integration.status === 'error' ? (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onFixConnection(integration);
                        }}
                        className="w-full py-2 bg-red-50/80 hover:bg-red-100/80 text-red-700 dark:text-red-300 dark:bg-red-950/40 text-sm font-semibold rounded-lg transition-colors border border-red-200/50 dark:border-red-900/50 shadow-sm"
                    >
                        Fix Connection
                    </button>
                ) : integration.status === 'syncing' ? (
                    <button disabled className="w-full py-2 bg-white/60 dark:bg-slate-900/50 text-gray-400 dark:text-gray-500 text-sm font-semibold rounded-lg border border-gray-200 dark:border-slate-700/50 cursor-not-allowed flex justify-center items-center">
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Syncing...
                    </button>
                ) : integration.status === 'connected' ? (
                    <div className="flex flex-col gap-2">
                        <button
                            type="button"
                            disabled={isBusy}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!integration.pipelineId) {
                                    toast.error(
                                        <span>
                                            Add a destination (like Google Sheets) to start syncing.{" "}
                                            <a href="/destinations" className="underline font-medium">Open Destinations</a>
                                        </span>
                                    );
                                    return;
                                }
                                onSync(integration.pipelineId, integration.id);
                            }}
                            className="w-full py-2 bg-white/70 dark:bg-slate-900/60 border border-gray-200/80 dark:border-slate-700/60 group-hover:border-cyan-200/80 group-hover:bg-cyan-500 text-gray-700 dark:text-slate-300 group-hover:text-white text-sm font-semibold rounded-lg transition-colors shadow-sm disabled:pointer-events-none disabled:opacity-50"
                        >
                            {isSyncing ? (
                                <span className="inline-flex items-center justify-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Syncing…
                                </span>
                            ) : (
                                "Sync Now"
                            )}
                        </button>
                        <button
                            type="button"
                            disabled={isBusy}
                            onClick={(e) => {
                                e.stopPropagation();
                                onDisconnect(integration.id, integration.name);
                            }}
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50/80 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100/90 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60 disabled:pointer-events-none disabled:opacity-50"
                        >
                            {isDisconnecting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Disconnecting…
                                </>
                            ) : (
                                <>
                                    <Unplug className="h-4 w-4" />
                                    Disconnect
                                </>
                            )}
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onConnect(integration);
                        }}
                        className="w-full py-2 bg-white/70 dark:bg-slate-900/50 border border-gray-200/80 dark:border-slate-700/60 text-gray-600 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors group-hover:border-white dark:group-hover:border-slate-700 group-hover:bg-white/90 dark:group-hover:bg-slate-900/80 shadow-sm"
                    >
                        Connect
                    </button>
                )}
            </div>
        </div>
    );
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Recent Syncs section (extracted component — #7)
 * ───────────────────────────────────────────────────────────────────────────── */

const RecentSyncsSection = React.memo(function RecentSyncsSection({
    logs,
}: {
    logs: Array<any>;
}) {
    if (logs.length === 0) return null;

    return (
        <div className="mt-10">
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Recent Syncs
                </h2>
                <Link
                    href="/reports"
                    className="text-xs font-semibold text-cyan-700 hover:underline dark:text-cyan-300"
                >
                    View all logs
                </Link>
            </div>

            <div className="rounded-2xl border border-gray-200/80 bg-white/60 p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/50">
                <div className="space-y-3">
                    {logs.map((l: any) => (
                        <div
                            key={l.id}
                            className={cn(
                                "flex items-start justify-between gap-3 rounded-xl border p-3",
                                l.status === "success"
                                    ? "border-cyan-100 bg-cyan-50/40 dark:border-cyan-900/30 dark:bg-cyan-950/20"
                                    : "border-red-100 bg-red-50/40 dark:border-red-900/30 dark:bg-red-950/20"
                            )}
                        >
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    {l.status === "success" ? (
                                        <CheckCircle2 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                                    ) : (
                                        <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-300" />
                                    )}
                                    <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                                        {l.pipeline?.name ?? "Pipeline"}
                                    </div>
                                </div>
                                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                    {l.status === "success"
                                        ? `Synced ${l.rowsSynced ?? 0} rows`
                                        : `Failed: ${String(l.errorMsg ?? "").slice(0, 120)}`}
                                </div>
                            </div>
                            <div className="shrink-0 text-xs font-medium text-gray-400 dark:text-gray-500">
                                {l.createdAt ? new Date(l.createdAt).toLocaleString() : ""}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Console Page
 * ───────────────────────────────────────────────────────────────────────────── */

export default function SourcesPage() {
    const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
    const [selectedIntegration, setSelectedIntegration] = useState<any>(null);
    const [disconnectTarget, setDisconnectTarget] = useState<{ id: string; name: string } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('all');

    /* #1 — Fix outgoingActionId race condition: Set instead of single string */
    const [busyActions, setBusyActions] = useState<Set<string>>(new Set());
    const addBusy = useCallback((id: string) => setBusyActions(prev => new Set(prev).add(id)), []);
    const removeBusy = useCallback((id: string) => setBusyActions(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
    }), []);

    const firstRunFilterAppliedRef = useRef(false);

    // Global State
    const { activeWorkspaceId } = useWorkspaceStore();
    const { mutate } = useSWRConfig();

    async function disconnectSource(connectionId: string, displayName: string) {
        setDisconnectTarget({ id: connectionId, name: displayName });
    }

    async function confirmDisconnect() {
        if (!disconnectTarget) return;
        const { id: connectionId, name: displayName } = disconnectTarget;
        addBusy(connectionId);
        try {
            const res = await fetch(`/api/connections/${connectionId}`, { method: "DELETE" });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(typeof data.error === "string" ? data.error : "Disconnect failed");
            }
            await mutate("/api/workspaces");
            trackEvent("source_disconnected", { sourceName: displayName });
            if (data.message) {
                toast.success(data.message);
            } else {
                toast.success("Source disconnected.");
            }
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Could not disconnect.");
        } finally {
            removeBusy(connectionId);
            setDisconnectTarget(null);
        }
    }

    /* #1 continued — Sync handler extracted for IntegrationCard callback */
    const handleSync = useCallback(async (pipelineId: string, _integrationId: string) => {
        const key = `sync:${pipelineId}`;
        addBusy(key);
        try {
            const res = await fetch(`/api/pipelines/${pipelineId}/run`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                toast.success(data.message || "Sync complete.");
            } else {
                toast.error(
                    typeof data.error === "string"
                        ? data.error
                        : "Sync failed."
                );
            }
        } catch {
            toast.error("Network error during sync.");
        } finally {
            removeBusy(key);
            /* #3 — Refresh sync logs after manual sync */
            if (activeWorkspaceId) {
                void mutate(`/api/sync-logs?workspaceId=${activeWorkspaceId}`);
            }
        }
    }, [addBusy, removeBusy, activeWorkspaceId, mutate]);

    const handleFixConnection = useCallback((integration: any) => {
        const catalogId = integration.catalogId;
        if (!catalogId) {
            toast.error("Could not determine which integration to reconnect.");
            return;
        }
        const cat = catalogIntegrationFromId(catalogId);
        setSelectedIntegration(
            cat ?? {
                id: catalogId,
                name: integration.name,
                description: integration.description,
                logoSrc: integration.logoSrc,
                status: "available" as const,
            }
        );
        setIsSourceModalOpen(true);
    }, []);

    const handleConnect = useCallback((integration: any) => {
        trackEvent("integration_card_clicked", {
            catalogId: integration.catalogId ?? integration.id,
            status: integration.status,
        });
        trackEvent("source_connect_clicked", {
            catalogId: integration.catalogId ?? integration.id,
            from: "card",
        });
        setSelectedIntegration(integration);
        setIsSourceModalOpen(true);
    }, []);

    // Fetch Data
    const { data: workspaces, error, isLoading } = useSWR("/api/workspaces", fetcher, {
        shouldRetryOnError: (err) => !String(err?.message).includes("Unauthorized"),
    });
    const { data: intConfig } = useSWR("/api/integrations/config", fetcher);

    const connectedSourceCount = useMemo(() => {
        if (!Array.isArray(workspaces) || !activeWorkspaceId) return 0;
        const ws = workspaces.find((w: { id: string }) => w.id === activeWorkspaceId);
        return (ws?.connections ?? []).filter((c: { type: string }) => c.type === 'source').length;
    }, [workspaces, activeWorkspaceId]);

    const lastSyncSummary = useMemo(() => {
        if (!Array.isArray(workspaces) || !activeWorkspaceId) return null;
        const ws = workspaces.find((w: { id: string }) => w.id === activeWorkspaceId);
        const sources = (ws?.connections ?? []).filter((c: { type: string }) => c.type === "source");
        let latest: Date | null = null;
        for (const c of sources) {
            const raw = (c as { lastSyncAt?: string | null }).lastSyncAt;
            const t = raw ? new Date(raw) : null;
            if (t && !Number.isNaN(t.getTime()) && (!latest || t > latest)) latest = t;
        }
        return latest ? latest.toLocaleString() : null;
    }, [workspaces, activeWorkspaceId]);

    useEffect(() => {
        trackOnce("mc_sources_session", "sources_visit", { path: "/sources" });
    }, []);

    const [oauthBanner, setOauthBanner] = useState<{
        provider: string;
        pipelineReady: boolean;
        needsDestination: boolean;
        limit: boolean;
    } | null>(null);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        if (params.get("oauth_success") !== "1") return;
        const provider = params.get("provider") ?? "source";
        const pipelineReady = params.get("pipeline_ready") === "1";
        const needsDestination = params.get("needs_destination") === "1";
        const limit = params.get("pipeline_limit") === "1";
        setOauthBanner({ provider, pipelineReady, needsDestination, limit });
        trackEvent("oauth_return_success", {
            provider,
            pipeline_ready: pipelineReady,
            needs_destination: needsDestination,
            pipeline_limit: limit,
        });
        window.history.replaceState({}, "", "/sources");
    }, []);

    useEffect(() => {
        if (isLoading || !Array.isArray(workspaces) || !activeWorkspaceId) return;
        if (firstRunFilterAppliedRef.current) return;
        if (connectedSourceCount !== 0) return;
        setActiveFilter('available');
        firstRunFilterAppliedRef.current = true;
    }, [isLoading, workspaces, activeWorkspaceId, connectedSourceCount]);

    const { data: recentLogsData } = useSWR(
        activeWorkspaceId ? `/api/sync-logs?workspaceId=${activeWorkspaceId}` : null,
        fetcher
    );
    const recentLogs = (recentLogsData?.logs ?? []).slice(0, 5) as Array<any>;

    const availableIntegrations = useMemo(() => {
        if (!intConfig) return ALL_CATALOG_INTEGRATIONS;
        return ALL_CATALOG_INTEGRATIONS.filter((item) => {
            if (item.id === 'tiktok_shop') return intConfig.tiktokShop !== false;
            if (item.id === 'tiktok_business') return intConfig.tiktokBusiness !== false;
            if (item.id === 'shopee') return intConfig.shopee !== false;
            if (item.id === 'meta_ads') return intConfig.metaAds !== false;
            if (item.id === 'google_ads') return intConfig.googleAds !== false;
            return true;
        });
    }, [intConfig]);

    // Filter logic
    const filteredIntegrations = useMemo(() => {
        if (!Array.isArray(workspaces) || !activeWorkspaceId) return availableIntegrations;

        const workspace = workspaces.find((w: any) => w.id === activeWorkspaceId) || workspaces[0];
        const sourceConnections = (workspace?.connections || []).filter((c: any) => c.type === 'source');

        const connectedCatalogIds = new Set(
            sourceConnections.map((c: any) => integrationCatalogId(c.provider))
        );

        const connectedSources = sourceConnections.map((conn: any) => {
            let logo = logoPathForConnectionProvider(conn.provider);

            /* #10 — User-facing description instead of "via workspace credentials" */
            const desc = `${conn.provider} — syncing to your workspace.`;
            const relatedPipeline = workspace?.pipelines?.find((p: any) => p.sourceConnectionId === conn.id);

            return {
                id: conn.id,
                catalogId: integrationCatalogId(conn.provider),
                name: conn.name,
                description: desc,
                status: conn.status === 'connected' ? 'connected' : 'error',
                errorMsg: conn.lastError || undefined,
                lastSync: conn.lastSyncAt
                    ? new Date(conn.lastSyncAt).toLocaleString()
                    : relatedPipeline?.lastSyncedAt
                      ? new Date(relatedPipeline.lastSyncedAt).toLocaleString()
                      : "Never",
                logoSrc: logo,
                pipelineId: relatedPipeline?.id,
            };
        });

        const filteredAvailable = availableIntegrations.filter((a) => !connectedCatalogIds.has(a.id));
        const combined = [...connectedSources, ...filteredAvailable];

        return combined.filter((integration: any) => {
            const matchesSearch = integration.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                integration.description.toLowerCase().includes(searchQuery.toLowerCase());

            if (!matchesSearch) return false;

            if (activeFilter === 'connected') return integration.status !== 'available';
            if (activeFilter === 'available') return integration.status === 'available';
            return true;
        });
    }, [searchQuery, activeFilter, workspaces, activeWorkspaceId, availableIntegrations]);

    // Error State (e.g. 500, expired session edge case, rate limit)
    if (error) {
        const detail = error instanceof Error ? error.message : "Failed to fetch data";
        const isAuth =
            detail === "Unauthorized" || detail.toLowerCase().includes("unauthorized");
        return (
            <div className="w-full py-20 flex flex-col items-center justify-center text-center px-4">
                <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                    Failed to load data sources
                </h3>
                <p className="text-sm text-gray-500 dark:text-slate-400 max-w-md">
                    {isAuth
                        ? "Your session is missing or expired. Sign in again to load workspaces and connections."
                        : "Please check your connection or try again. If this persists, the server may be temporarily unavailable."}
                </p>
                {!isAuth && (
                    <p className="mt-2 text-xs font-mono text-gray-400 dark:text-slate-500 max-w-lg break-words">
                        {detail}
                    </p>
                )}
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    {isAuth ? (
                        <Link
                            href="/login?callbackUrl=%2Fsources"
                            className="inline-flex items-center rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700"
                        >
                            Sign in
                        </Link>
                    ) : (
                        <button
                            type="button"
                            onClick={() => mutate("/api/workspaces")}
                            className="inline-flex items-center rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700"
                        >
                            Retry
                        </button>
                    )}
                </div>
            </div>
        );
    }

    /* #2 — Guard null activeWorkspaceId — show "Select a workspace" prompt */
    if (!isLoading && !activeWorkspaceId) {
        return (
            <div className="w-full py-20 flex flex-col items-center justify-center text-center px-4">
                <Database className="w-10 h-10 text-gray-400 dark:text-gray-500 mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                    No workspace selected
                </h3>
                <p className="text-sm text-gray-500 dark:text-slate-400 max-w-md">
                    Select or create a workspace to view and manage your data sources.
                </p>
            </div>
        );
    }

    return (
        <PageShell
            className="w-full"
            withBackdrop
        >
            <div
                className="absolute inset-0 overflow-hidden pointer-events-none -z-10 motion-reduce:hidden max-lg:hidden"
                aria-hidden
            >
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-cyan-200/20 dark:bg-cyan-900/20 blur-[120px]" />
                <div className="absolute top-[20%] right-[-10%] w-[40%] h-[60%] rounded-full bg-blue-200/20 dark:bg-blue-900/20 blur-[120px]" />
                <div className="absolute bottom-[-20%] left-[10%] w-[60%] h-[50%] rounded-full bg-cyan-100/30 dark:bg-cyan-900/30 blur-[140px]" />
            </div>

            {oauthBanner && (
                <div
                    className={`mb-6 rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                        oauthBanner.limit
                            ? "border-amber-200/80 bg-amber-50/90 dark:border-amber-900/50 dark:bg-amber-950/30"
                            : "border-cyan-200/80 bg-cyan-50/90 dark:border-cyan-900/50 dark:bg-cyan-950/30"
                    }`}
                    role="status"
                >
                    <div className="text-sm text-gray-800 dark:text-cyan-50/95">
                        <span className="font-semibold">Connected successfully.</span>{" "}
                        {oauthBanner.pipelineReady ? (
                            <>
                                Your first sync is ready — data will flow to your destination automatically. Use{" "}
                                <span className="font-medium">Sync Now</span> on the card below, or open{" "}
                                <Link href="/reports" className="font-medium text-cyan-700 underline dark:text-cyan-300">
                                    Reports
                                </Link>{" "}
                                for activity.
                            </>
                        ) : oauthBanner.needsDestination ? (
                            <>
                                Next, connect a <span className="font-medium">destination</span> (e.g. Google Sheets™) so we can route your data.{" "}
                                <Link href="/destinations" className="font-medium text-cyan-700 underline dark:text-cyan-300">
                                    Open Destinations
                                </Link>
                                .
                            </>
                        ) : oauthBanner.limit ? (
                            <>
                                {/* #10 — "sync limit" instead of "pipeline limit" */}
                                You&apos;ve reached your plan&apos;s sync limit — manage syncs in{" "}
                                <Link href="/settings" className="font-medium text-amber-800 underline dark:text-amber-200">
                                    Settings
                                </Link>{" "}
                                or upgrade to add more.
                            </>
                        ) : (
                            <>You can manage this source below.</>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => setOauthBanner(null)}
                        className="shrink-0 text-xs font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {/* Header — #5: summary bar merged into header subtitle */}
            <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between space-y-4 sm:space-y-0">
                <div>
                    {isLoading ? (
                        <>
                            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight mb-2">
                                Sources
                            </h1>
                            <p className="text-gray-500 dark:text-gray-400 max-w-2xl text-base">
                                Loading your workspace…
                            </p>
                        </>
                    ) : connectedSourceCount === 0 ? (
                        <>
                            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight mb-2">
                                Sources
                            </h1>
                            <p className="text-gray-500 dark:text-gray-400 max-w-2xl text-base">
                                Connect TikTok, Meta, Google, Shopee, Lazada or Shopify. Most pipelines take ~3 minutes — choose{" "}
                                <span className="font-medium text-gray-700 dark:text-slate-200">Available</span> below to get started.
                            </p>
                        </>
                    ) : (
                        <>
                            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight mb-2">
                                Sources
                            </h1>
                            {/* #5 — Count + last sync merged into subtitle (summary bar removed) */}
                            <p className="text-gray-500 dark:text-gray-400 max-w-2xl text-base">
                                {connectedSourceCount} source{connectedSourceCount === 1 ? "" : "s"} connected
                                {lastSyncSummary ? ` · Last sync: ${lastSyncSummary}` : ""}.
                            </p>
                        </>
                    )}
                </div>
                <div className="flex space-x-3">
                    <button
                        onClick={() => mutate('/api/workspaces')}
                        aria-label="Refresh all sources"
                        className="flex items-center justify-center w-10 h-10 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 hover:border-gray-300 dark:hover:border-slate-600 transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <PrimaryButton
                        type="button"
                        onClick={() => {
                            trackEvent("integration_connect_open", { source: "header_new" });
                            trackEvent("source_connect_clicked", { from: "header_new" });
                            setSelectedIntegration(null);
                            setIsSourceModalOpen(true);
                        }}
                        className="flex items-center gap-2 shadow-sm hover:shadow"
                    >
                        <Plus className="h-4 w-4" />
                        New Data Source
                    </PrimaryButton>
                </div>
            </div>

            {/* #5 — Summary bar REMOVED (info merged into header subtitle above) */}

            {/* #6 — Onboarding hint removed (redundant with header copy) */}

            {/* Search and Filter — #9: ARIA tab pattern */}
            <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-8 mb-8">
                <div className="relative flex-1 max-w-md group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 w-5 h-5 group-focus-within:text-cyan-500 transition-colors" aria-hidden="true" />
                    {/* #9 — added aria-label to search input */}
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search integrations..."
                        aria-label="Search integrations"
                        className="w-full pl-10 pr-12 py-2.5 bg-white/60 dark:bg-slate-900/50 border border-gray-200/80 dark:border-slate-700/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all shadow-sm"
                    />
                </div>
                {/* #9 — ARIA tab pattern for filter tabs */}
                <div className="flex space-x-6 border-b border-gray-200 dark:border-slate-700" role="tablist" aria-label="Filter integrations">
                    <button
                        role="tab"
                        aria-selected={activeFilter === 'all'}
                        onClick={() => setActiveFilter('all')}
                        className={`pb-3 text-sm font-semibold transition-colors ${activeFilter === 'all' ? 'text-gray-900 dark:text-white border-b-2 border-cyan-500' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-slate-300'}`}
                    >
                        All Sources
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeFilter === 'connected'}
                        onClick={() => setActiveFilter('connected')}
                        className={`pb-3 text-sm font-medium transition-colors ${activeFilter === 'connected' ? 'text-gray-900 dark:text-white border-b-2 border-cyan-500 font-semibold' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-slate-300'}`}
                    >
                        Connected ({isLoading ? '…' : connectedSourceCount})
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeFilter === 'available'}
                        onClick={() => setActiveFilter('available')}
                        className={`pb-3 text-sm font-medium transition-colors ${activeFilter === 'available' ? 'text-gray-900 dark:text-white border-b-2 border-cyan-500 font-semibold' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-slate-300'}`}
                    >
                        Available
                    </button>
                </div>
            </div>

            {/* Grid — #7: uses extracted IntegrationCard component */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" role="tabpanel">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <IntegrationCardSkeleton key={i} />
                    ))}
                </div>
            ) : filteredIntegrations.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" role="tabpanel" aria-live="polite">
                    {filteredIntegrations.map((integration) => (
                        <IntegrationCard
                            key={integration.id}
                            integration={integration}
                            busyActions={busyActions}
                            onSync={handleSync}
                            onDisconnect={disconnectSource}
                            onFixConnection={handleFixConnection}
                            onConnect={handleConnect}
                        />
                    ))}
                </div>
            ) : (
                <div className="w-full py-20 flex flex-col items-center justify-center text-center border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-2xl bg-gray-50 dark:bg-slate-800/50" role="tabpanel" aria-live="polite">
                    <Database className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">No integrations found</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 max-w-sm mb-6">We couldn&apos;t find any data sources matching &quot;{searchQuery}&quot;. Try a different keyword or category.</p>
                </div>
            )}

            {/* Recent Syncs — #6: only for returning users with actual logs (first-time duplicate removed) */}
            {connectedSourceCount > 0 && (
                <RecentSyncsSection logs={recentLogs} />
            )}

            <ConfirmDialog
                open={disconnectTarget !== null}
                title={disconnectTarget ? `Disconnect ${disconnectTarget.name}?` : "Disconnect?"}
                description="Syncs from this source will stop. Your existing data in destinations is not deleted. You can reconnect later."
                confirmLabel="Disconnect"
                cancelLabel="Cancel"
                variant="danger"
                onConfirm={confirmDisconnect}
                onCancel={() => setDisconnectTarget(null)}
            />

            <ConnectSourceModal
                isOpen={isSourceModalOpen}
                onClose={() => setIsSourceModalOpen(false)}
                integration={selectedIntegration}
            />
        </PageShell>
    );
}
