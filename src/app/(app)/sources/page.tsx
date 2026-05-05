"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import Link from "next/link";
import { toast } from "sonner";
import { Database, Search, Plus, RefreshCw, AlertCircle, CheckCircle2, Loader2, ChevronRight, ChevronDown, X } from "lucide-react";
import { ConnectSourceModal } from "@/components/ConnectSourceModal";
import { FixConnectionModal } from "@/components/FixConnectionModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import useSWR, { useSWRConfig } from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { integrationCatalogId } from "@/lib/sources-integration-catalog";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";
import { SOURCES_CATALOG, isSourceEnvReady } from "@/lib/sources-integration-catalog";
import { cn } from "@/lib/utils";
import { trackEvent, trackOnce } from "@/lib/analytics-events";
import { PageShell } from "@/components/ui/PageShell";
import { DataFlowExplainer } from "@/components/data-flow/DataFlowExplainer";
import { RefreshedAt } from "@/components/ui/RefreshedAt";
import { SecondaryButton, primaryButtonLinkClassName } from "@/components/ui";
import { ConnectedSourceCard } from "@/components/sources/ConnectedSourceCard";
import { IntegrationCard, IntegrationCardSkeleton } from "@/components/sources/IntegrationCard";
import { RecentSyncsSection } from "@/components/sources/RecentSyncsSection";
import { OAuthSuccessBanner } from "@/components/sources/OAuthSuccessBanner";

const fetcher = async (url: string) => {
    const res = await fetch(url, { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch data');
    }
    return data;
};

const CONNECTED_CARD_SORT_ORDER = [
    "meta_ads",
    "google_ads",
    "tiktok_business",
    "shopee",
    "tiktok_shop",
    "lazada",
    "shopify",
    "amazon",
] as const;

function connectedSourceSortRank(catalogId: string): number {
    const i = (CONNECTED_CARD_SORT_ORDER as readonly string[]).indexOf(catalogId);
    return i === -1 ? 100 : i;
}

const SOURCE_BLURB_BY_PROVIDER: Record<string, string> = {
    meta_ads: "Facebook & Instagram Ads — performance reporting for this workspace.",
    google_ads: "Google Ads — search and Performance Max reporting for this workspace.",
    tiktok_business: "TikTok Ads — Marketing API reporting for this workspace.",
    shopee: "Shopee Open Platform — orders and shop data for this workspace.",
    tiktok_shop: "TikTok Shop — catalog and orders for this workspace.",
    lazada: "Lazada Seller — orders and finance for this workspace.",
    shopify: "Shopify — store orders for this workspace.",
    amazon: "Amazon Selling Partner — SP-API OAuth for this workspace.",
};

function catalogIntegrationFromId(catalogId: string) {
    return SOURCES_CATALOG.find((a) => a.id === catalogId) ?? null;
}

// See src/components/sources/ for extracted sub-components.

/* ─────────────────────────────────────────────────────────────────────────────
 * Sources Page
 * ───────────────────────────────────────────────────────────────────────────── */

export default function SourcesPage() {
    const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
    const [selectedIntegration, setSelectedIntegration] = useState<any>(null);
    const [disconnectTarget, setDisconnectTarget] = useState<{ id: string; name: string } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('all');
    const [addSourceMenuOpen, setAddSourceMenuOpen] = useState(false);
    const addSourceMenuRef = useRef<HTMLDivElement>(null);
    
    // P1: Fix It flow state
    const [fixConnectionTarget, setFixConnectionTarget] = useState<{
        id: string;
        name: string;
        provider: string;
        catalogId: string;
        status: string;
        errorMsg?: string;
        lastSync?: string;
    } | null>(null);

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
        
        // P1: Open Fix It modal instead of generic connect modal
        setFixConnectionTarget({
            id: integration.id,
            name: integration.name,
            provider: integration.provider || catalogId,
            catalogId,
            status: integration.status,
            errorMsg: integration.errorMsg,
            lastSync: integration.lastSync,
        });
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

    useEffect(() => {
        if (!addSourceMenuOpen) return;
        const close = (e: MouseEvent) => {
            if (addSourceMenuRef.current && !addSourceMenuRef.current.contains(e.target as Node)) {
                setAddSourceMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [addSourceMenuOpen]);

    const [oauthBanner, setOauthBanner] = useState<{
        provider: string;
        pipelineReady: boolean;
        needsDestination: boolean;
        limit: boolean;
    } | null>(null);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);

        // OAuth error params from any provider callback
        const errorProviders = ["meta_ads", "google_ads", "tiktok", "tiktok_business", "shopee", "amazon", "lazada"] as const;
        for (const p of errorProviders) {
            const errVal = params.get(`${p}_error`);
            if (errVal) {
                const label = {
                    meta_ads: "Meta Ads",
                    google_ads: "Google Ads",
                    tiktok: "TikTok Shop",
                    tiktok_business: "TikTok Ads",
                    shopee: "Shopee",
                    amazon: "Amazon Selling Partner",
                    lazada: "Lazada",
                }[p];
                toast.error(`${label} connection failed: ${decodeURIComponent(errVal).replace(/_/g, " ")}`);
                window.history.replaceState({}, "", "/sources");
                return;
            }
        }

        if (params.get("oauth_success") !== "1") return;
        const provider = params.get("provider") ?? "source";
        const pipelineReady = params.get("pipeline_ready") === "1";
        const needsDestination = params.get("needs_destination") === "1";
        const limit = params.get("pipeline_limit") === "1";
        setOauthBanner({ provider, pipelineReady, needsDestination, limit });
        setActiveFilter('connected');
        void mutate('/api/workspaces');
        trackEvent("oauth_return_success", {
            provider,
            pipeline_ready: pipelineReady,
            needs_destination: needsDestination,
            pipeline_limit: limit,
        });
        if (pipelineReady) {
            trackEvent("pipeline_created", { provider, auto_linked: true });
        }
        window.history.replaceState({}, "", "/sources");
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        
        let hasError = false;
        const errorKeys = [
            'meta_ads_error',
            'google_ads_error',
            'tiktok_error',
            'tiktok_business_error',
            'shopee_error',
            'amazon_error',
            'lazada_error',
            'shopify_error',
        ];
        
        for (const key of errorKeys) {
            const errVal = params.get(key);
            if (errVal) {
                const providerName = key.split('_').slice(0, -1).join(' ');
                toast.error(`Connection failed for ${providerName}`, {
                    description: errVal,
                    duration: 8000,
                });
                hasError = true;
            }
        }
        
        if (hasError) {
            window.history.replaceState({}, "", "/sources");
        }
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

    /** Full catalog always listed so App Review sees real connectors; `envConnectReady` gates the Connect action. */
    const catalogIntegrations = useMemo(() => {
        return SOURCES_CATALOG.map((item) => ({
            ...item,
            status: "available" as const,
            envConnectReady: isSourceEnvReady(item.id, intConfig),
        }));
    }, [intConfig]);

    const connectedCatalogIdList = useMemo(() => {
        if (!Array.isArray(workspaces) || !activeWorkspaceId) return [] as string[];
        const workspace = workspaces.find((w: { id: string }) => w.id === activeWorkspaceId);
        const sourceConnections = (workspace?.connections ?? []).filter((c: { type: string }) => c.type === "source");
        return sourceConnections.map((c: { provider: string }) => integrationCatalogId(c.provider));
    }, [workspaces, activeWorkspaceId]);

    const headerAddOptions = useMemo(() => {
        const connected = new Set(connectedCatalogIdList);
        return catalogIntegrations.filter((i) => !connected.has(i.id));
    }, [catalogIntegrations, connectedCatalogIdList]);

    // Filter logic
    const filteredIntegrations = useMemo(() => {
        if (!Array.isArray(workspaces) || !activeWorkspaceId) return catalogIntegrations;

        const workspace = workspaces.find((w: any) => w.id === activeWorkspaceId) || workspaces[0];
        const rawSourceConnections = (workspace?.connections || []).filter((c: any) => c.type === 'source');

        // Identity Deduplication: keep only the most recent connection per provider
        const sourceConnections = Object.values(
            rawSourceConnections.reduce((acc: Record<string, any>, conn: any) => {
                const existing = acc[conn.provider];
                if (!existing || new Date(conn.updatedAt) > new Date(existing.updatedAt)) {
                    acc[conn.provider] = conn;
                }
                return acc;
            }, {})
        );

        const connectedCatalogIds = new Set(
            sourceConnections.map((c: any) => integrationCatalogId(c.provider))
        );

        const connectedSources = sourceConnections
            .map((conn: any) => {
                const logo = logoPathForConnectionProvider(conn.provider);
                const catalogId = integrationCatalogId(conn.provider);
                const accountMatch = (conn.name as string | undefined)?.match(/\((.+)\)$/);
                const accountLabel = accountMatch?.[1] ?? null;
                const baseBlurb = SOURCE_BLURB_BY_PROVIDER[conn.provider] ?? `${conn.provider} — data for this workspace.`;
                const desc = accountLabel ? `${accountLabel} · ${baseBlurb}` : baseBlurb;
                const relatedPipeline = workspace?.pipelines?.find((p: any) => p.sourceConnectionId === conn.id);

                // Extract ad account tags from sanitized credentials for display
                let accountTags: string[] = [];
                try {
                    const creds = typeof conn.credentials === 'string'
                        ? JSON.parse(conn.credentials)
                        : (conn.credentials ?? {});
                    if (conn.provider === 'meta_ads') {
                        const list: Array<{ id: string; name?: string }> =
                            creds.adAccounts ??
                            (creds.adAccountIds ?? []).map((id: string) => ({ id }));
                        accountTags = list.map((a: any) =>
                            a.name && a.name !== a.id ? a.name : String(a.id).replace(/^act_/, '')
                        );
                    } else if (conn.provider === 'google_ads') {
                        accountTags = creds.customerIds ?? [];
                    } else if (conn.provider === 'tiktok_business') {
                        accountTags = creds.advertiserIds ?? [];
                    }
                } catch { /* ignore */ }

                return {
                    id: conn.id,
                    catalogId,
                    name: conn.name,
                    description: desc,
                    status: conn.status === "connected" ? "connected" : "error",
                    errorMsg: conn.lastError || undefined,
                    lastSync: conn.lastSyncAt
                        ? new Date(conn.lastSyncAt).toLocaleString()
                        : relatedPipeline?.lastSyncedAt
                          ? new Date(relatedPipeline.lastSyncedAt).toLocaleString()
                          : "Never",
                    logoSrc: logo,
                    pipelineId: relatedPipeline?.id,
                    accountTags,
                };
            })
            .sort((a: { catalogId: string }, b: { catalogId: string }) => {
                return connectedSourceSortRank(a.catalogId) - connectedSourceSortRank(b.catalogId);
            });

        const filteredAvailable = catalogIntegrations.filter((a) => !connectedCatalogIds.has(a.id));
        const combined = [...connectedSources, ...filteredAvailable];

        return combined.filter((integration: any) => {
            const matchesSearch = integration.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                integration.description.toLowerCase().includes(searchQuery.toLowerCase());

            if (!matchesSearch) return false;

            if (activeFilter === 'connected') return integration.status !== 'available';
            if (activeFilter === 'available') return integration.status === 'available';
            return true;
        });
    }, [searchQuery, activeFilter, workspaces, activeWorkspaceId, catalogIntegrations]);

    const { connectedRows, availableCards } = useMemo(() => {
        const connected = (filteredIntegrations as Array<{ status: string }>).filter(
            (i) => i.status !== "available",
        );
        const available = (filteredIntegrations as Array<{ status: string }>).filter(
            (i) => i.status === "available",
        );
        return { connectedRows: connected, availableCards: available };
    }, [filteredIntegrations]);

    const activeWorkspace = useMemo(() => {
        if (!Array.isArray(workspaces) || !activeWorkspaceId) return null;
        return workspaces.find((w: { id: string }) => w.id === activeWorkspaceId) ?? null;
    }, [workspaces, activeWorkspaceId]);

    const filterStats = useMemo(() => {
        let connected = 0;
        let needsAttention = 0;
        let available = 0;
        for (const i of filteredIntegrations as Array<{ status: string }>) {
            if (i.status === "available") available += 1;
            else if (i.status === "error") needsAttention += 1;
            else connected += 1;
        }
        return { connected, needsAttention, available };
    }, [filteredIntegrations]);

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
                            className={primaryButtonLinkClassName}
                        >
                            Sign in
                        </Link>
                    ) : (
                        <SecondaryButton onClick={() => mutate("/api/workspaces")}>
                            Retry
                        </SecondaryButton>
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

            {oauthBanner && (
                <OAuthSuccessBanner
                    {...oauthBanner}
                    onDismiss={() => setOauthBanner(null)}
                />
            )}


            {/* Header — #5: summary bar merged into header subtitle */}
            <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between space-y-4 sm:space-y-0">
                <div>
                    {isLoading ? (
                        <>
                            <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Sources</h1>
                            {activeWorkspace ? (
                                <p className="mb-1 text-sm font-medium text-gray-600 dark:text-slate-400">
                                    {activeWorkspace.name} · Sources
                                </p>
                            ) : null}
                            <p className="max-w-2xl text-base text-gray-600 dark:text-slate-300">
                                Loading your workspace…
                            </p>
                        </>
                    ) : connectedSourceCount === 0 ? (
                        <>
                            <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Sources</h1>
                            {activeWorkspace ? (
                                <p className="mb-1 text-sm font-medium text-gray-600 dark:text-slate-400">
                                    {activeWorkspace.name} · Sources
                                </p>
                            ) : null}
                            <p className="max-w-2xl text-base text-gray-600 dark:text-slate-300">
                                Connect TikTok, Meta, Google, Shopee, Lazada or Shopify. Most pipelines take ~3 minutes — choose{" "}
                                <span className="font-medium text-gray-800 dark:text-slate-100">Available</span> below to get started.
                            </p>
                        </>
                    ) : (
                        <>
                            <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Sources</h1>
                            {activeWorkspace ? (
                                <p className="mb-1 text-sm font-medium text-gray-600 dark:text-slate-400">
                                    {activeWorkspace.name} · Sources
                                </p>
                            ) : null}
                            <p className="max-w-2xl text-base text-gray-600 dark:text-slate-300">
                                {connectedSourceCount} source{connectedSourceCount === 1 ? "" : "s"} connected
                                {lastSyncSummary ? ` · Last sync: ${lastSyncSummary}` : ""}.
                            </p>
                        </>
                    )}
                </div>
                <div className="flex items-center gap-2 sm:gap-3">
                    <RefreshedAt
                        onRefresh={() => mutate((key) => typeof key === "string" && key.startsWith("/api/") && !key.startsWith("/api/auth/"), undefined, { revalidate: true })}
                    />
                    <div className="relative" ref={addSourceMenuRef}>
                        <button
                            type="button"
                            aria-expanded={addSourceMenuOpen}
                            aria-haspopup="listbox"
                            onClick={() => setAddSourceMenuOpen((o) => !o)}
                            className="inline-flex h-10 min-h-[2.5rem] items-center gap-2 rounded-lg bg-cyan-600 px-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-cyan-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 focus-visible:ring-offset-2 active:bg-cyan-800 dark:bg-cyan-600 dark:hover:bg-cyan-500 sm:px-4"
                        >
                            <Plus className="h-4 w-4 shrink-0" aria-hidden />
                            <span className="hidden sm:inline">Add data source</span>
                            <span className="sm:hidden">Add source</span>
                            <ChevronDown
                                className={`h-4 w-4 shrink-0 opacity-90 transition-transform duration-200 ${addSourceMenuOpen ? "-rotate-180" : ""}`}
                                aria-hidden
                            />
                        </button>
                        {addSourceMenuOpen ? (
                            <div
                                className="absolute right-0 top-full z-50 mt-2 w-[min(100vw-1.25rem,22.5rem)] origin-top animate-in fade-in slide-in-from-top-1 duration-200"
                                role="presentation"
                            >
                                <div
                                    className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
                                    role="listbox"
                                    aria-label="Connect a source"
                                >
                                    <div className="border-b border-slate-100/90 bg-gradient-to-br from-slate-50/90 to-white px-4 py-3 dark:border-white/5 dark:from-slate-800/80 dark:to-slate-900/80">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                                            Quick connect
                                        </p>
                                        <p className="mt-0.5 text-xs leading-snug text-slate-600 dark:text-slate-400">
                                            Choose a platform — you&apos;ll sign in with OAuth next.
                                        </p>
                                    </div>
                                    <div className="max-h-[min(52vh,22rem)] overflow-y-auto overscroll-contain px-2 py-2">
                                        {headerAddOptions.length === 0 ? (
                                            <div className="flex flex-col items-center gap-2 rounded-xl bg-slate-50/80 px-4 py-8 text-center dark:bg-slate-800/50">
                                                <CheckCircle2 className="h-8 w-8 text-emerald-500/90" aria-hidden />
                                                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">All set</p>
                                                <p className="max-w-[14rem] text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                                    Every catalog source is already linked to this workspace.
                                                </p>
                                            </div>
                                        ) : (
                                            <ul className="space-y-1">
                                                {headerAddOptions.map((item) => {
                                                    const disabled = !item.envConnectReady;
                                                    return (
                                                        <li key={item.id}>
                                                            <button
                                                                type="button"
                                                                role="option"
                                                                disabled={disabled}
                                                                onClick={() => {
                                                                    if (disabled) {
                                                                        toast.error(
                                                                            "This connector is not enabled on this deployment (missing OAuth environment variables)."
                                                                        );
                                                                        return;
                                                                    }
                                                                    trackEvent("integration_connect_open", {
                                                                        source: "header_dropdown",
                                                                        catalogId: item.id,
                                                                    });
                                                                    trackEvent("source_connect_clicked", {
                                                                        catalogId: item.id,
                                                                        from: "header_dropdown",
                                                                    });
                                                                    handleConnect({ ...item, catalogId: item.id });
                                                                    setAddSourceMenuOpen(false);
                                                                }}
                                                                className={cn(
                                                                    "group flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-all duration-150",
                                                                    disabled
                                                                        ? "cursor-not-allowed opacity-50 saturate-50"
                                                                        : "text-slate-900 hover:bg-slate-50/95 hover:shadow-sm focus:outline-none focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-cyan-500/35 dark:text-white dark:hover:bg-slate-800/90 dark:focus-visible:bg-slate-800/90 dark:focus-visible:ring-cyan-400/30"
                                                                )}
                                                            >
                                                                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white to-slate-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ring-1 ring-slate-200/80 dark:from-slate-800 dark:to-slate-900 dark:ring-white/10">
                                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                    <img
                                                                        src={item.logoSrc}
                                                                        alt=""
                                                                        width={24}
                                                                        height={24}
                                                                        className="object-contain"
                                                                    />
                                                                </span>
                                                                <span className="min-w-0 flex-1 pt-0.5">
                                                                    <span className="flex items-start justify-between gap-2">
                                                                        <span className="text-[13px] font-semibold leading-tight tracking-tight text-slate-900 dark:text-white">
                                                                            {item.name}
                                                                        </span>
                                                                        {!disabled ? (
                                                                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-cyan-600 dark:text-slate-600 dark:group-hover:text-cyan-400" />
                                                                        ) : (
                                                                            <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-900 dark:bg-amber-950/80 dark:text-amber-200">
                                                                                Off
                                                                            </span>
                                                                        )}
                                                                    </span>
                                                                    <span className="mt-1 block line-clamp-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                                                                        {item.description}
                                                                    </span>
                                                                </span>
                                                            </button>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                    </div>
                                    <div className="border-t border-slate-100 bg-slate-50/90 p-2 dark:border-white/5 dark:bg-slate-950/60">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                trackEvent("integration_connect_open", { source: "header_browse_all" });
                                                setSelectedIntegration(null);
                                                setIsSourceModalOpen(true);
                                                setAddSourceMenuOpen(false);
                                            }}
                                            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:border-cyan-300/60 hover:bg-cyan-50/50 hover:text-cyan-900 dark:border-white/10 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:border-cyan-500/30 dark:hover:bg-cyan-950/40 dark:hover:text-cyan-100"
                                        >
                                            Full catalog — status
                                            <ChevronRight className="h-3.5 w-3.5 opacity-70" aria-hidden />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>

            {/* DataFlowExplainer — only shown to first-time users (no connections yet); returning users see the compact pill */}
            {!isLoading && connectedSourceCount === 0 ? <DataFlowExplainer variant="sources" /> : null}

            {/* Search + Filter tabs — visually separated card */}
            <div className="glass-panel mb-8 overflow-hidden">
                {/* Search row */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 pt-4 pb-3">
                    <div className="relative flex-1 max-w-md group">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-cyan-500 dark:text-slate-500" aria-hidden="true" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search integrations..."
                            aria-label="Search integrations"
                            className="w-full rounded-xl border border-gray-200/80 bg-gray-50/80 py-2 pl-9 pr-10 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:bg-white dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:bg-slate-800"
                        />
                    </div>
                    {!isLoading && filterStats.needsAttention > 0 && (
                        <span className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-red-200/80 bg-red-50/80 px-2.5 py-1.5 text-xs font-semibold text-red-700 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                            {filterStats.needsAttention} need attention
                        </span>
                    )}
                </div>
                {/* Filter tabs row */}
                <div className="flex items-center justify-between border-t border-gray-100 dark:border-white/5 px-4">
                    <div className="flex space-x-6" role="tablist" aria-label="Filter integrations">
                        <button
                            role="tab"
                            aria-selected={activeFilter === 'all'}
                            onClick={() => setActiveFilter('all')}
                            className={`py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 focus-visible:ring-offset-1 rounded-sm ${activeFilter === 'all' ? 'border-b-2 border-cyan-500 text-gray-900 dark:text-white' : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200'}`}
                        >
                            All Sources
                        </button>
                        <button
                            role="tab"
                            aria-selected={activeFilter === 'connected'}
                            onClick={() => setActiveFilter('connected')}
                            className={`py-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 focus-visible:ring-offset-1 rounded-sm ${activeFilter === 'connected' ? 'border-b-2 border-cyan-500 font-semibold text-gray-900 dark:text-white' : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200'}`}
                        >
                            Connected ({isLoading ? '…' : connectedSourceCount})
                        </button>
                        <button
                            role="tab"
                            aria-selected={activeFilter === 'available'}
                            onClick={() => setActiveFilter('available')}
                            className={`py-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 focus-visible:ring-offset-1 rounded-sm ${activeFilter === 'available' ? 'border-b-2 border-cyan-500 font-semibold text-gray-900 dark:text-white' : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200'}`}
                        >
                            Available
                        </button>
                    </div>
                    {!isLoading && connectedSourceCount > 0 && (
                        <span className="text-xs text-gray-400 dark:text-slate-500">
                            {filterStats.connected} connected · {filterStats.available} to connect
                        </span>
                    )}
                </div>
            </div>

            {/* Grid — split into "Your sources" strip + "Available" catalog */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" role="tabpanel">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <IntegrationCardSkeleton key={i} />
                    ))}
                </div>
            ) : connectedRows.length === 0 && availableCards.length === 0 ? (
                <div className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 py-20 text-center dark:border-slate-600 dark:bg-slate-800/60" role="tabpanel" aria-live="polite">
                    <Database className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">No integrations found</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 max-w-sm mb-6">
                        No data sources match &quot;{searchQuery}&quot;.
                    </p>
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => { setSearchQuery(""); setActiveFilter("all"); }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors dark:border-slate-600 dark:bg-slate-800 dark:text-gray-200 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
                        >
                            <X className="h-4 w-4" />
                            Clear search
                        </button>
                    )}
                </div>
            ) : (
                <div role="tabpanel" aria-live="polite" className="space-y-8">
                    {connectedRows.length > 0 ? (
                        <section aria-labelledby="sources-connected-heading">
                            <div className="mb-4 flex items-end justify-between">
                                <h2
                                    id="sources-connected-heading"
                                    className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400"
                                >
                                    Your sources
                                </h2>
                                <span className="text-xs text-gray-500 dark:text-slate-400">
                                    {connectedRows.length} connected
                                </span>
                            </div>
                            <div className="stagger-list grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" style={{ gridAutoRows: "minmax(0,auto)", isolation: "isolate" }}>
                                {connectedRows.map((integration: any) => (
                                    <div key={integration.id} className="stagger-item min-w-0">
                                    <ConnectedSourceCard
                                        integration={integration}
                                        busyActions={busyActions}
                                        onSync={handleSync}
                                        onDisconnect={disconnectSource}
                                        onFixConnection={handleFixConnection}
                                    />
                                    </div>
                                ))}
                            </div>
                        </section>
                    ) : null}
                    {availableCards.length > 0 ? (
                        <section aria-labelledby="sources-available-heading">
                            <div className="mb-4 flex items-end justify-between">
                                <h2
                                    id="sources-available-heading"
                                    className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400"
                                >
                                    Available
                                </h2>
                                <span className="text-xs text-gray-500 dark:text-slate-400">
                                    {availableCards.length} to connect
                                </span>
                            </div>
                            <div className="stagger-list grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" style={{ gridAutoRows: "minmax(0,auto)", isolation: "isolate" }}>
                                {availableCards.map((integration: any) => (
                                    <div key={integration.id} className="stagger-item min-w-0">
                                    <IntegrationCard
                                        integration={integration}
                                        busyActions={busyActions}
                                        onSync={handleSync}
                                        onDisconnect={disconnectSource}
                                        onFixConnection={handleFixConnection}
                                        onConnect={handleConnect}
                                    />
                                    </div>
                                ))}
                            </div>
                        </section>
                    ) : null}
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
                connectedCatalogIds={connectedCatalogIdList}
            />

            {/* P1: Fix It Modal for one-click reconnection */}
            <FixConnectionModal
                isOpen={fixConnectionTarget !== null}
                onClose={() => setFixConnectionTarget(null)}
                connection={fixConnectionTarget}
                onReconnected={() => {
                    // Refresh data after successful reconnection
                    mutate((key) => typeof key === "string" && key.startsWith("/api/") && !key.startsWith("/api/auth/"));
                    toast.success("Connection restored successfully");
                }}
            />
        </PageShell>
    );
}
