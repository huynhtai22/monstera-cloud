"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import Link from "next/link";
import { toast } from "sonner";
import { Database, Search, Plus, AlertCircle, CheckCircle2, ChevronRight, ChevronDown, X } from "lucide-react";
import { ConnectSourceModal } from "@/components/ConnectSourceModal";
import { FixConnectionModal } from "@/components/FixConnectionModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import useSWR, { useSWRConfig } from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { integrationCatalogId, isSourceEnvReady, visibleSourcesCatalog } from "@/lib/sources-integration-catalog";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";
import { cn } from "@/lib/utils";
import { trackEvent, trackOnce } from "@/lib/analytics-events";
import { PageShell } from "@/components/ui/PageShell";
import { DataFlowExplainer } from "@/components/data-flow/DataFlowExplainer";
import { RefreshedAt } from "@/components/ui/RefreshedAt";
import { SecondaryButton, primaryButtonLinkClassName, IntegrationMark } from "@/components/ui";
import { ConnectedSourceCard } from "@/components/sources/ConnectedSourceCard";
import { IntegrationCard, IntegrationCardSkeleton } from "@/components/sources/IntegrationCard";
import { OAuthSuccessBanner } from "@/components/sources/OAuthSuccessBanner";
import { ConnectedSourceList } from "@/components/sources/ConnectedSourceList";

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

    type ViewMode = "cards" | "list";
    const [viewMode, setViewMode] = useState<ViewMode>("list");
    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const raw = window.localStorage.getItem("mc_sources_view_mode");
            if (raw === "list" || raw === "cards") setViewMode(raw);
        } catch { /* ignore */ }
    }, []);
    const setViewModePersisted = (m: ViewMode) => {
        setViewMode(m);
        try {
            window.localStorage.setItem("mc_sources_view_mode", m);
        } catch { /* ignore */ }
    };
    
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
            await Promise.all([
                mutate("/api/workspaces"),
                activeWorkspaceId ? mutate(`/api/workspaces/${activeWorkspaceId}/connections?type=source`) : Promise.resolve(),
            ]);
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
    const handleSync = useCallback(async (pipelineId: string) => {
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

    /* Direct sync for ad platforms - no pipeline needed, syncs to CampaignMetric for Data Explorer */
    const handleDirectSync = useCallback(async (connectionId: string, provider: string, force: boolean = false) => {
        const key = `direct-sync:${connectionId}`;
        addBusy(key);
        try {
            const url = force 
                ? `/api/connections/${connectionId}/sync?force=true` 
                : `/api/connections/${connectionId}/sync`;
            const res = await fetch(url, { method: 'POST' });
            const data = await res.json();
            
            // DEBUG: Always show response for now
            console.log('[DirectSync] Response:', { status: res.status, ok: res.ok, data });
            
            if (res.ok) {
                toast.success(
                    <span>
                        Synced {data.rowsIngested || 0} rows to Data Explorer.
                        <a href="/explorer" className="ml-2 font-medium underline">
                            View Data
                        </a>
                    </span>
                );
            } else if (data.code === 'SYNC_ACTIVE' || data.error?.includes('already queued') || data.error?.includes('running')) {
                // Show option to force unlock
                toast.error(
                    <div className="max-w-md">
                        <p className="font-semibold mb-2">Sync Blocked</p>
                        <p className="text-sm mb-3">{data.error || "A sync is already running"}</p>
                        <button
                            onClick={() => {
                                toast.dismiss('sync-blocked');
                                handleDirectSync(connectionId, provider, true);
                            }}
                            className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded"
                        >
                            Force Unlock & Retry
                        </button>
                    </div>,
                    { duration: 30000, id: 'sync-blocked' }
                );
            } else {
                // DEBUG: Show full error details since Vercel logs are unavailable
                const errorDetails = JSON.stringify(data, null, 2);
                toast.error(
                    <div className="max-w-md">
                        <p className="font-semibold mb-2">Sync Failed:</p>
                        <p className="text-sm mb-2">{data.error || "Unknown error"}</p>
                        <details className="text-xs">
                            <summary className="cursor-pointer text-red-300 hover:text-red-200">Show Debug Info</summary>
                            <pre className="mt-2 p-2 bg-red-950/50 rounded text-left overflow-auto max-h-40">{errorDetails}</pre>
                        </details>
                    </div>,
                    { duration: 10000 }
                );
            }
        } catch (e: any) {
            toast.error(
                <div>
                    <p className="font-semibold">Network Error</p>
                    <p className="text-xs mt-1">{e.message}</p>
                </div>
            );
        } finally {
            removeBusy(key);
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
    const { data: workspaces, error, isLoading: workspacesLoading } = useSWR("/api/workspaces", fetcher, {
        shouldRetryOnError: (err) => !String(err?.message).includes("Unauthorized"),
    });
    const { data: sourceConnections = [], error: connectionsError, isLoading: connectionsLoading } = useSWR(
        activeWorkspaceId ? `/api/workspaces/${activeWorkspaceId}/connections?type=source` : null,
        fetcher,
    );
    const { data: pipelines = [] } = useSWR(
        activeWorkspaceId ? `/api/pipelines?workspaceId=${activeWorkspaceId}` : null,
        fetcher,
    );
    const isLoading = workspacesLoading || connectionsLoading;
    const { data: intConfig } = useSWR("/api/integrations/config", fetcher);

    const connectedSourceCount = useMemo(() => {
        return Array.isArray(sourceConnections) ? sourceConnections.length : 0;
    }, [sourceConnections]);

    const lastSyncSummary = useMemo(() => {
        if (!Array.isArray(sourceConnections)) return null;
        let latest: Date | null = null;
        for (const c of sourceConnections) {
            const raw = (c as { lastSyncAt?: string | null }).lastSyncAt;
            const t = raw ? new Date(raw) : null;
            if (t && !Number.isNaN(t.getTime()) && (!latest || t > latest)) latest = t;
        }
        return latest ? latest.toLocaleString() : null;
    }, [sourceConnections]);

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
    }, [mutate]);

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

    /** Certified connectors plus any uncertified ones explicitly enabled for this workspace. */
    const catalogIntegrations = useMemo(() => {
        const active = Array.isArray(workspaces)
            ? workspaces.find((workspace: { id: string }) => workspace.id === activeWorkspaceId)
            : null;
        return visibleSourcesCatalog(intConfig, active?.enabledProviders ?? []).map((item) => ({
            ...item,
            status: "available" as const,
            envConnectReady: isSourceEnvReady(item.id, intConfig),
        }));
    }, [intConfig, workspaces, activeWorkspaceId]);

    const connectedCatalogIdList = useMemo(() => {
        if (!Array.isArray(sourceConnections)) return [] as string[];
        return sourceConnections.map((c: { provider: string }) => integrationCatalogId(c.provider));
    }, [sourceConnections]);

    const headerAddOptions = useMemo(() => {
        return catalogIntegrations;
    }, [catalogIntegrations]);

    // Filter logic
    const filteredIntegrations = useMemo(() => {
        if (!activeWorkspaceId) return catalogIntegrations;
        const rawSourceConnections = Array.isArray(sourceConnections) ? sourceConnections : [];

        // Identity Deduplication: keep only the most recent connection per provider
        const dedupedSourceConnections = Object.values(
            rawSourceConnections.reduce((acc: Record<string, any>, conn: any) => {
                const existing = acc[conn.provider];
                if (!existing || new Date(conn.updatedAt) > new Date(existing.updatedAt)) {
                    acc[conn.provider] = conn;
                }
                return acc;
            }, {})
        );

        const connectedSources = dedupedSourceConnections
            .map((conn: any) => {
                const logo = logoPathForConnectionProvider(conn.provider);
                const catalogId = integrationCatalogId(conn.provider);
                const accountMatch = (conn.name as string | undefined)?.match(/\((.+)\)$/);
                const accountLabel = accountMatch?.[1] ?? null;
                const baseBlurb = SOURCE_BLURB_BY_PROVIDER[conn.provider] ?? `${conn.provider} — data for this workspace.`;
                const desc = accountLabel ? `${accountLabel} · ${baseBlurb}` : baseBlurb;
                const relatedPipeline = Array.isArray(pipelines)
                    ? pipelines.find((p: any) => p.sourceConnectionId === conn.id)
                    : null;

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
                    provider: conn.provider,
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

        const filteredAvailable = catalogIntegrations;
        const combined = [...connectedSources, ...filteredAvailable];

        return combined.filter((integration: any) => {
            const matchesSearch = integration.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                integration.description.toLowerCase().includes(searchQuery.toLowerCase());

            if (!matchesSearch) return false;

            if (activeFilter === 'connected') return integration.status !== 'available';
            if (activeFilter === 'available') return integration.status === 'available';
            return true;
        });
    }, [searchQuery, activeFilter, sourceConnections, pipelines, activeWorkspaceId, catalogIntegrations]);

    const { connectedRows, availableCards } = useMemo(() => {
        // Keep typing wide enough for both card and list render paths.
        const connected = (filteredIntegrations as any[]).filter((i) => i.status !== "available");
        const available = (filteredIntegrations as any[]).filter((i) => i.status === "available");
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
    if (error || connectionsError) {
        const failure = error || connectionsError;
        const detail = failure instanceof Error ? failure.message : "Failed to fetch data";
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


            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight text-ink">Sources</h1>
                    <p className="mt-1 text-sm text-ink-mute">
                        {isLoading
                            ? "Loading your workspace…"
                            : connectedSourceCount === 0
                              ? "Connect Meta, Google Ads, TikTok Ads, or Shopee. OAuth is read-only."
                              : `${connectedSourceCount} connected${lastSyncSummary ? ` · Last sync ${lastSyncSummary}` : ""}`}
                    </p>
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
                            className="inline-flex h-10 min-h-[2.5rem] items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 sm:px-4"
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
                                    className="overflow-hidden rounded-lg border border-line bg-panel"
                                    role="listbox"
                                    aria-label="Connect a source"
                                >
                                    <div className="border-b border-line px-4 py-3">
                                        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute">
                                            Quick connect
                                        </p>
                                        <p className="mt-0.5 text-xs leading-snug text-ink-mute">
                                            Choose a platform — you&apos;ll sign in with OAuth next.
                                        </p>
                                    </div>
                                    <div className="max-h-[min(52vh,22rem)] overflow-y-auto overscroll-contain px-2 py-2">
                                        {headerAddOptions.length === 0 ? (
                                            <div className="flex flex-col items-center gap-2 rounded-xl bg-slate-50/80 px-4 py-8 text-center dark:bg-[#16181c]/50">
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
                                                                aria-selected="false"
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
                                                                    "group flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors",
                                                                    disabled
                                                                        ? "cursor-not-allowed opacity-50"
                                                                        : "text-ink hover:bg-white/[0.04] focus:outline-none"
                                                                )}
                                                            >
                                                                <IntegrationMark src={item.logoSrc} size="md" />
                                                                <span className="min-w-0 flex-1 pt-0.5">
                                                                    <span className="flex items-start justify-between gap-2">
                                                                        <span className="text-[13px] font-semibold leading-tight tracking-tight text-slate-900 dark:text-white">
                                                                            {item.name}
                                                                        </span>
                                                                        {!disabled ? (
                                                                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-mute" strokeWidth={1.5} />
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
                                    <div className="border-t border-slate-100 bg-slate-50/90 p-2 dark:border-white/5 dark:bg-[#000000]/60">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                trackEvent("integration_connect_open", { source: "header_browse_all" });
                                                setSelectedIntegration(null);
                                                setIsSourceModalOpen(true);
                                                setAddSourceMenuOpen(false);
                                            }}
                                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-xs font-semibold text-ink shadow-xs transition-colors hover:border-white/30 hover:text-white"
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

            <div className="mb-5 flex flex-col gap-3 border-b border-line pb-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-4" role="tablist" aria-label="Filter integrations">
                    <button
                        role="tab"
                        aria-selected={activeFilter === 'all'}
                        onClick={() => setActiveFilter('all')}
                        className={`py-1.5 text-sm transition-colors ${activeFilter === 'all' ? 'border-b border-ink font-semibold text-ink' : 'text-ink-mute hover:text-ink'}`}
                    >
                        All
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeFilter === 'connected'}
                        onClick={() => setActiveFilter('connected')}
                        className={`py-1.5 text-sm transition-colors ${activeFilter === 'connected' ? 'border-b border-ink font-semibold text-ink' : 'text-ink-mute hover:text-ink'}`}
                    >
                        Connected ({isLoading ? '…' : connectedSourceCount})
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeFilter === 'available'}
                        onClick={() => setActiveFilter('available')}
                        className={`py-1.5 text-sm transition-colors ${activeFilter === 'available' ? 'border-b border-ink font-semibold text-ink' : 'text-ink-mute hover:text-ink'}`}
                    >
                        Catalog
                    </button>
                    {!isLoading && filterStats.needsAttention > 0 && (
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-2 py-1 text-[11px] text-red-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                            {filterStats.needsAttention} need attention
                        </span>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute" aria-hidden="true" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search"
                            aria-label="Search integrations"
                            className="h-8 w-44 rounded-md border border-line bg-panel py-1.5 pl-8 pr-3 text-sm text-ink placeholder:text-ink-mute focus:border-white/25 focus:outline-none"
                        />
                    </div>
                    <div className="hidden sm:flex items-center rounded-md border border-line p-0.5">
                        <button
                            type="button"
                            onClick={() => setViewModePersisted("list")}
                            className={cn(
                                "rounded px-2.5 py-1 text-[11px] font-medium",
                                viewMode === "list" ? "bg-white/[0.06] text-ink" : "text-ink-mute hover:text-ink",
                            )}
                        >
                            List
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewModePersisted("cards")}
                            className={cn(
                                "rounded px-2.5 py-1 text-[11px] font-medium",
                                viewMode === "cards" ? "bg-white/[0.06] text-ink" : "text-ink-mute hover:text-ink",
                            )}
                        >
                            Cards
                        </button>
                    </div>
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
                <div className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-line bg-panel py-20 text-center" role="tabpanel" aria-live="polite">
                    <Database className="w-10 h-10 text-ink-mute mb-4" />
                    <h3 className="text-sm font-semibold text-ink mb-1">No integrations found</h3>
                    <p className="text-xs text-ink-mute max-w-sm mb-6">
                        No data sources match &quot;{searchQuery}&quot;.
                    </p>
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => { setSearchQuery(""); setActiveFilter("all"); }}
                            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/[0.06] transition-colors"
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
                            {viewMode !== "list" ? (
                                <div className="mb-3 flex items-end justify-between">
                                    <h2
                                        id="sources-connected-heading"
                                        className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute"
                                    >
                                        Connected
                                    </h2>
                                    <span className="text-xs text-ink-mute">{connectedRows.length}</span>
                                </div>
                            ) : (
                                <h2 id="sources-connected-heading" className="sr-only">Connected</h2>
                            )}
                            {viewMode === "list" && activeFilter !== "available" ? (
                                <ConnectedSourceList
                                    rows={connectedRows}
                                    busyActions={busyActions}
                                    onSync={handleSync}
                                    onDirectSync={(id, provider) => handleDirectSync(id, provider)}
                                    onDisconnect={disconnectSource}
                                    onFixConnection={handleFixConnection}
                                />
                            ) : (
                                <div className="stagger-list grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" style={{ gridAutoRows: "minmax(0,auto)", isolation: "isolate" }}>
                                    {connectedRows.map((integration: any) => (
                                        <div key={integration.id} className="stagger-item min-w-0">
                                        <ConnectedSourceCard
                                            integration={integration}
                                            busyActions={busyActions}
                                            onSync={handleSync}
                                            onDirectSync={handleDirectSync}
                                            onDisconnect={disconnectSource}
                                            onFixConnection={handleFixConnection}
                                        />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    ) : null}
                    {availableCards.length > 0 ? (
                        <section aria-labelledby="sources-available-heading">
                            <div className="mb-3 flex items-end justify-between">
                                <h2
                                    id="sources-available-heading"
                                    className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute"
                                >
                                    {connectedSourceCount > 0 ? "Add another" : "Catalog"}
                                </h2>
                                <span className="text-xs text-ink-mute">{availableCards.length}</span>
                            </div>
                            {connectedSourceCount > 0 && activeFilter !== "available" ? (
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                    {availableCards.map((integration: any) => (
                                        <button
                                            key={integration.id}
                                            type="button"
                                            onClick={() => handleConnect(integration)}
                                            className="governed-hover flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5 text-left"
                                        >
                                            <IntegrationMark src={integration.logoSrc} size="sm" />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-medium text-ink">{integration.name}</span>
                                                <span className="block text-[11px] text-ink-mute">Connect</span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="stagger-list grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" style={{ gridAutoRows: "minmax(0,auto)", isolation: "isolate" }}>
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
                            )}
                        </section>
                    ) : null}
                </div>
            )}

            {connectedSourceCount > 0 && (
                <div className="mt-8 flex items-center justify-between border-t border-line pt-4">
                    <p className="text-xs text-ink-mute">Sync history lives in Sync activity.</p>
                    <Link href="/reports" className="text-xs font-medium text-ink-mute hover:text-ink">
                        Open logs →
                    </Link>
                </div>
            )}

            <ConfirmDialog
                open={disconnectTarget !== null}
                title={disconnectTarget ? `Disconnect ${disconnectTarget.name}?` : "Disconnect?"}
                description="Syncs from this source will stop. Your existing data in the warehouse is not deleted. You can reconnect later."
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
