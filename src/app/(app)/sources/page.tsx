"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Database, Search, Plus, AlertCircle, CheckCircle2, ChevronRight, ChevronDown, X, Clock } from "lucide-react";
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
import { IntegrationCard, IntegrationCardSkeleton } from "@/components/sources/IntegrationCard";
import { OAuthSuccessBanner } from "@/components/sources/OAuthSuccessBanner";
import { ConnectedSourceList } from "@/components/sources/ConnectedSourceList";
import { SourceOutcomeBanner, type SourceOutcomeNotice } from "@/components/sources/SourceOutcomeBanner";
import { countSourceHealthStatuses } from "@/lib/source-health";

const fetcher = async (url: string) => {
    const res = await fetch(url, { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const message = data.error || (res.status === 429 ? 'Too Many Requests — please wait a moment before retrying' : 'Failed to fetch data');
        throw new Error(message);
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
    const router = useRouter();
    const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
    const [selectedIntegration, setSelectedIntegration] = useState<any>(null);
    const [disconnectTarget, setDisconnectTarget] = useState<{ id: string; name: string } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('connected');
    const [addSourceMenuOpen, setAddSourceMenuOpen] = useState(false);
    const addSourceMenuRef = useRef<HTMLDivElement>(null);
    const [sourceOutcome, setSourceOutcome] = useState<SourceOutcomeNotice | null>(null);
    
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

    async function handleRenameConnection(connectionId: string, newName: string) {
        const res = await fetch(`/api/connections/${connectionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || "Failed to rename connection");
        }
        toast.success(`Connection renamed to "${newName}"`);
        await Promise.all([
            mutate((key) => typeof key === "string" && key.includes("/api/workspaces")),
            mutate((key) => typeof key === "string" && key.includes("/api/connections")),
        ]);
        router.refresh();
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
            setSourceOutcome({
                kind: "success",
                title: "Source disconnected",
                detail: "Syncs from this source have stopped. Existing Warehouse history was retained and you can reconnect the source later.",
                action: { href: "/explorer", label: "View warehouse" },
            });
        } catch {
            setSourceOutcome({
                kind: "error",
                title: "Source could not be disconnected",
                detail: "The connection and existing Warehouse history were not changed. Try again, or contact support if this continues.",
                action: { href: "/support", label: "Get support" },
            });
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
            if (res.ok) {
                setSourceOutcome({
                    kind: "success",
                    title: "Pipeline sync complete",
                    detail: "The pipeline finished successfully. Review Warehouse data if you need to confirm coverage.",
                    action: { href: "/explorer", label: "View warehouse" },
                });
            } else {
                setSourceOutcome({
                    kind: "error",
                    title: "Pipeline sync could not complete",
                    detail: "Existing warehouse data was not deleted. Review sync activity before retrying.",
                    action: { href: "/reports", label: "Review sync activity" },
                });
            }
        } catch {
            setSourceOutcome({
                kind: "error",
                title: "Pipeline sync could not start",
                detail: "The request did not reach Monstera. Existing warehouse data was not changed.",
                action: { href: "/reports", label: "Review sync activity" },
            });
        } finally {
            removeBusy(key);
            /* #3 — Refresh sync logs after manual sync */
            if (activeWorkspaceId) {
                void mutate(`/api/sync-logs?workspaceId=${activeWorkspaceId}`);
            }
        }
    }, [addBusy, removeBusy, activeWorkspaceId, mutate]);

    /* Direct sync for ad platforms - no pipeline needed, syncs to CampaignMetric for Data Explorer */
    const handleDirectSync = useCallback(async (connectionId: string) => {
        const key = `direct-sync:${connectionId}`;
        addBusy(key);
        try {
            const res = await fetch(`/api/connections/${connectionId}/sync`, { method: 'POST' });
            const data = await res.json();

            const rowsIngested = typeof data.rowsIngested === "number" ? data.rowsIngested : 0;
            if (res.ok && data.outcome === "success") {
                setSourceOutcome({
                    kind: "success",
                    title: "Sync complete",
                    detail: `${rowsIngested.toLocaleString()} row${rowsIngested === 1 ? "" : "s"} are available in Warehouse for this source.`,
                    action: { href: "/explorer", label: "View warehouse" },
                });
            } else if (res.ok && data.outcome === "partial") {
                setSourceOutcome({
                    kind: "partial",
                    title: "Partial sync",
                    detail: `${rowsIngested.toLocaleString()} row${rowsIngested === 1 ? "" : "s"} were written, but one or more provider accounts did not complete. The last fully successful sync was not advanced.`,
                    action: { href: `/sources/${connectionId}`, label: "Review source" },
                });
            } else if (data.code === 'SYNC_ACTIVE' || data.error?.includes('already queued') || data.error?.includes('running')) {
                setSourceOutcome({
                    kind: "blocked",
                    title: "Sync already running",
                    detail: "Another sync holds this source's lease. Wait for it to finish, then review the source if it does not complete.",
                    action: { href: `/sources/${connectionId}`, label: "Review source" },
                });
            } else if (data.code === 'SYNC_COOLDOWN') {
                setSourceOutcome({
                    kind: "cooldown",
                    title: "Sync cooldown active",
                    detail: "This source was synced recently. Wait for the cooldown to finish before starting another sync.",
                    action: { href: `/sources/${connectionId}`, label: "Review source" },
                });
            } else {
                setSourceOutcome({
                    kind: "error",
                    title: "Sync could not complete",
                    detail: "Existing warehouse data was not deleted. Review this source before retrying.",
                    action: { href: `/sources/${connectionId}`, label: "Review source" },
                });
            }
        } catch {
            setSourceOutcome({
                kind: "error",
                title: "Sync could not start",
                detail: "The request did not reach Monstera. Existing warehouse data was not changed.",
                action: { href: `/sources/${connectionId}`, label: "Review source" },
            });
        } finally {
            removeBusy(key);
        }
    }, [addBusy, removeBusy]);

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
        errorRetryInterval: 3000,
        errorRetryCount: 3,
        dedupingInterval: 4000,
    });
    const { data: sourceConnections = [], error: connectionsError, isLoading: connectionsLoading } = useSWR(
        activeWorkspaceId ? `/api/workspaces/${activeWorkspaceId}/connections?type=source` : null,
        fetcher,
        {
            errorRetryInterval: 3000,
            errorRetryCount: 3,
            dedupingInterval: 4000,
        }
    );
    const { data: pipelines = [] } = useSWR(
        activeWorkspaceId ? `/api/pipelines?workspaceId=${activeWorkspaceId}` : null,
        fetcher,
        {
            errorRetryInterval: 3000,
            errorRetryCount: 3,
            dedupingInterval: 4000,
        }
    );
    const isLoading = workspacesLoading || connectionsLoading;
    const { data: intConfig } = useSWR("/api/integrations/config", fetcher, {
        dedupingInterval: 10000,
    });

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

        // Count connections per provider to detect multiple connections in the workspace
        const providerCounts: Record<string, number> = {};
        for (const c of rawSourceConnections) {
            providerCounts[c.provider] = (providerCounts[c.provider] || 0) + 1;
        }

        const connectedSources = rawSourceConnections
            .map((conn: any) => {
                const logo = logoPathForConnectionProvider(conn.provider);
                const catalogId = integrationCatalogId(conn.provider);
                const relatedPipeline = Array.isArray(pipelines)
                    ? pipelines.find((p: any) => p.sourceConnectionId === conn.id)
                    : null;

                let creds: any = {};
                try {
                    creds = typeof conn.credentials === 'string'
                        ? JSON.parse(conn.credentials)
                        : (conn.credentials ?? {});
                } catch {
                    creds = {};
                }

                // Extract ad accounts, manager badges, and account tags
                let accountTags: Array<{ id: string; label: string } | string> = [];
                let rawName = (conn.name || "").trim();
                let displayName = rawName;
                let managerBadge: string | null = null;
                let scopeDesc = "";

                if (conn.provider === 'meta_ads') {
                    const list: Array<{ id: string; name?: string }> =
                        creds.adAccounts ??
                        (creds.adAccountIds ?? []).map((id: string) => ({ id }));
                    accountTags = list.map((a: any) => ({
                        id: String(a.id),
                        label: a.name && a.name !== a.id ? a.name : String(a.id).replace(/^act_/, ''),
                    }));
                    const bmId = creds.businessManagerId || creds.bmId || null;
                    const totalCount = accountTags.length;
                    if (bmId && bmId !== "") {
                        managerBadge = `BM: ${bmId}`;
                        scopeDesc = `Business Manager (${bmId}) · ${totalCount} ad account${totalCount === 1 ? '' : 's'} synced`;
                    } else if (list.length === 1) {
                        const cleanId = String(list[0].id).replace(/^act_/, '');
                        managerBadge = `act_${cleanId}`;
                        scopeDesc = `Ad Account: ${list[0].name || list[0].id} · Direct sync`;
                    } else if (list.length > 1) {
                        const cleanFirst = String(list[0].id).replace(/^act_/, '');
                        managerBadge = `BM Root: ${cleanFirst}`;
                        scopeDesc = `Meta Business · ${totalCount} ad accounts synced`;
                    } else {
                        scopeDesc = `Meta Ads · ${totalCount} ad accounts synced`;
                    }

                    // Clean auto-generated name strings like "Meta (2 accounts)" or "Meta Ads (1 account)"
                    const isDefaultName = !rawName || /^Meta(\s*Ads)?(\s*\(\d+\s*accounts?\))?$/i.test(rawName);
                    displayName = isDefaultName ? "Meta Ads" : rawName;
                } else if (conn.provider === 'google_ads') {
                    const list: string[] = creds.customerIds ?? [];
                    accountTags = list.map((id: string) => {
                        const clean = String(id).replace(/\D/g, '');
                        const formatted = clean.length === 10
                            ? `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`
                            : String(id);
                        return { id: String(id), label: formatted };
                    });
                    const mccId = creds.mccId || creds.managerCustomerId || null;
                    const totalCount = accountTags.length;
                    if (mccId && mccId !== "") {
                        const cleanMcc = String(mccId).replace(/\D/g, '');
                        const formattedMcc = cleanMcc.length === 10 
                            ? `${cleanMcc.slice(0, 3)}-${cleanMcc.slice(3, 6)}-${cleanMcc.slice(6)}`
                            : mccId;
                        managerBadge = `MCC: ${formattedMcc}`;
                        scopeDesc = `${managerBadge} · ${totalCount} customer account${totalCount === 1 ? '' : 's'} synced`;
                    } else if (list.length === 1) {
                        const cleanCid = String(list[0]).replace(/\D/g, '');
                        const formattedCid = cleanCid.length === 10
                            ? `${cleanCid.slice(0, 3)}-${cleanCid.slice(3, 6)}-${cleanCid.slice(6)}`
                            : list[0];
                        managerBadge = `CID: ${formattedCid}`;
                        scopeDesc = `Customer: ${formattedCid} · Direct Google Ads sync`;
                    } else if (list.length > 1) {
                        const cleanFirst = String(list[0]).replace(/\D/g, '');
                        const formattedFirst = cleanFirst.length === 10
                            ? `${cleanFirst.slice(0, 3)}-${cleanFirst.slice(3, 6)}-${cleanFirst.slice(6)}`
                            : list[0];
                        managerBadge = `MCC: ${formattedFirst}`;
                        scopeDesc = `MCC Manager · ${totalCount} customer accounts synced`;
                    } else {
                        scopeDesc = `Google Ads · ${totalCount} customer accounts synced`;
                    }

                    // Clean auto-generated name strings like "Google Ads (8 accounts)" or "Google Ads (1 account)"
                    const isDefaultName = !rawName || /^Google Ads(\s*\(\d+\s*accounts?\))?$/i.test(rawName);
                    displayName = isDefaultName ? "Google Ads" : rawName;
                } else if (conn.provider === 'tiktok_business') {
                    const list: string[] = creds.advertiserIds ?? [];
                    accountTags = list.map((id: string) => ({ id: String(id), label: String(id) }));
                    const bcId = creds.businessCenterId || creds.bcId || null;
                    const totalCount = accountTags.length;
                    if (bcId && bcId !== "") {
                        managerBadge = `BC: ${bcId}`;
                        scopeDesc = `Business Center (${bcId}) · ${totalCount} advertiser${totalCount === 1 ? '' : 's'} synced`;
                    } else if (list.length === 1) {
                        const advId = list[0];
                        managerBadge = `Adv: ${advId}`;
                        scopeDesc = `Advertiser ID: ${advId} · Direct TikTok sync`;
                    } else if (list.length > 1) {
                        managerBadge = `BC: ${list[0]}`;
                        scopeDesc = `Business Center · ${totalCount} advertisers synced`;
                    } else {
                        scopeDesc = `TikTok Ads · ${totalCount} advertisers synced`;
                    }

                    // Clean auto-generated name strings like "TikTok Ads (1 advertiser)" or "TikTok Ads (account)"
                    const isDefaultName = !rawName || /^TikTok Ads(\s*\(\d+\s*advertisers?\))?$/i.test(rawName);
                    displayName = isDefaultName ? "TikTok Ads" : rawName;
                } else if (conn.provider === 'shopee') {
                    const shop = creds.shopId || null;
                    if (shop) {
                        accountTags = [{ id: String(shop), label: `Shop ID: ${shop}` }];
                        managerBadge = `Shop: ${shop}`;
                    }
                    const isDefaultName = !rawName || /^Shopee(\s*\(\d+\s*shops?\))?$/i.test(rawName);
                    displayName = isDefaultName ? "Shopee" : rawName;
                    scopeDesc = shop ? `Shop ID: ${shop} · Orders & GMV sync` : "Shopee Marketplace store";
                } else if (conn.provider === 'shopify') {
                    const domain = creds.shopDomain || null;
                    if (domain) {
                        accountTags = [{ id: String(domain), label: String(domain) }];
                        managerBadge = `Store: ${domain}`;
                    }
                    const isDefaultName = !rawName || /^Shopify(\s*\(\d+\s*stores?\))?$/i.test(rawName);
                    displayName = isDefaultName ? "Shopify" : rawName;
                    scopeDesc = domain ? `Store: ${domain} · E-commerce sync` : "Shopify Store sync";
                } else {
                    const baseBlurb = SOURCE_BLURB_BY_PROVIDER[conn.provider] ?? `${conn.provider} — data for this workspace.`;
                    displayName = rawName || conn.provider;
                    scopeDesc = baseBlurb;
                }

                return {
                    id: conn.id,
                    provider: conn.provider,
                    catalogId,
                    name: displayName,
                    description: scopeDesc,
                    managerBadge,
                    shortId: conn.id ? conn.id.slice(-4) : undefined,
                    // `healthState` is computed server-side from durable
                    // connection truth. Keep the fallback for older API
                    // responses while the client cache rolls over.
                    status: conn.healthState ?? (conn.status === "disconnected"
                        ? "disconnected"
                        : conn.lastError?.startsWith("[partial]")
                          ? "partial"
                          : conn.status === "connected"
                            ? "connected"
                            : "error"),
                    healthState: conn.healthState,
                    // "auth" wording makes the row show the Reconnect CTA; historical data is retained.
                    errorMsg: conn.status === "disconnected"
                        ? "Disconnected — warehouse history retained. Re-authenticate to resume syncing."
                        : conn.lastError || undefined,
                    lastSync: conn.lastSyncAt
                        ? new Date(conn.lastSyncAt).toLocaleString()
                        : relatedPipeline?.lastSyncedAt
                          ? new Date(relatedPipeline.lastSyncedAt).toLocaleString()
                          : "Never",
                    dataThroughDate: conn.dataThroughDate,
                    logoSrc: logo,
                    pipelineId: relatedPipeline?.id,
                    accountTags,
                };
            })
            .sort((a: { catalogId: string }, b: { catalogId: string }) => {
                return connectedSourceSortRank(a.catalogId) - connectedSourceSortRank(b.catalogId);
            });

        // Deduplicate connections that point to the exact same manager identity (e.g. identical MCC ID)
        const seenManagerKeys = new Set<string>();
        const deduplicatedConnectedSources: typeof connectedSources = [];

        for (const source of connectedSources) {
            const managerKey = source.managerBadge 
                ? `${source.provider}:${source.managerBadge}`
                : source.provider === 'google_ads' && source.accountTags?.length
                    ? `${source.provider}:${typeof source.accountTags[0] === 'object' ? source.accountTags[0].id : source.accountTags[0]}`
                    : null;

            if (managerKey) {
                if (seenManagerKeys.has(managerKey)) {
                    continue;
                }
                seenManagerKeys.add(managerKey);
            }
            deduplicatedConnectedSources.push(source);
        }

        const filteredAvailable = catalogIntegrations;
        const combined = [...deduplicatedConnectedSources, ...filteredAvailable];

        return combined.filter((integration: any) => {
            const matchesSearch = integration.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                integration.description.toLowerCase().includes(searchQuery.toLowerCase());

            if (!matchesSearch) return false;

            if (activeFilter === 'connected') return integration.status !== 'available';
            if (activeFilter === 'available') return integration.status === 'available';
            return integration.status !== 'available';
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
        return countSourceHealthStatuses(filteredIntegrations as Array<{ status: string }>);
    }, [filteredIntegrations]);

    // Error State (only block the screen when the failing endpoint has NO cached data)
    const hasCachedWorkspaces = Array.isArray(workspaces) && workspaces.length > 0;
    const hasCachedConnections = Array.isArray(sourceConnections) && sourceConnections.length > 0;
    const isBlocked = Boolean(
        (error && !hasCachedWorkspaces) ||
        (connectionsError && !hasCachedConnections && activeWorkspaceId)
    );

    if (isBlocked) {
        const failure = error || connectionsError;
        const detail = failure instanceof Error ? failure.message : "Failed to fetch data";
        const isAuth =
            detail === "Unauthorized" || detail.toLowerCase().includes("unauthorized");
        const isRateLimited = detail.toLowerCase().includes("too many requests") || detail.toLowerCase().includes("rate_limit");

        return (
            <div className="w-full py-24 flex flex-col items-center justify-center text-center px-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-400 mb-4 shadow-xs">
                    <AlertCircle className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-semibold tracking-tight text-ink mb-1.5">
                    {isRateLimited ? "Rate limit reached" : "Failed to load data sources"}
                </h3>
                <p className="text-sm text-ink-mute max-w-md leading-relaxed">
                    {isAuth
                        ? "Your session is missing or expired. Sign in again to load workspaces and connections."
                        : isRateLimited
                          ? "Too many requests were sent in a short period. Please wait a few seconds and retry."
                          : "Please check your connection or try again. If this persists, the server may be temporarily unavailable."}
                </p>
                {!isAuth && (
                    <p className="mt-3 text-xs font-mono text-ink-mute/70 bg-panel px-3 py-1.5 rounded-lg border border-line max-w-lg break-words">
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
                        <SecondaryButton onClick={() => {
                            void mutate("/api/workspaces");
                            if (activeWorkspaceId) {
                                void mutate(`/api/workspaces/${activeWorkspaceId}/connections?type=source`);
                            }
                        }}>
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

            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-ink">Sources</h1>
                    <p className="mt-1 text-sm text-ink-mute">
                        {isLoading
                            ? "Loading your workspace…"
                            : connectedSourceCount === 0
                              ? "Connect Meta, Google Ads, TikTok Ads, or Shopee. OAuth is read-only."
                              : "Connector management and pipeline sync controls for this workspace."}
                    </p>
                    {!isLoading && activeWorkspace && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-mute" role="status">
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-ink-mute">
                                Workspace: <span className="font-semibold text-ink">{activeWorkspace.name}</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-ink-mute font-mono">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                {connectedSourceCount} source connection{connectedSourceCount === 1 ? "" : "s"}
                            </span>
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-ink-mute">
                                <Clock className="h-3.5 w-3.5 text-ink-mute" />
                                {lastSyncSummary
                                    ? `Last synced: ${lastSyncSummary}`
                                    : "No successful sync recorded yet"}
                            </span>
                        </div>
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

            {sourceOutcome && (
                <SourceOutcomeBanner
                    notice={sourceOutcome}
                    onDismiss={() => setSourceOutcome(null)}
                />
            )}

            <div className="mb-6 flex flex-col gap-4 border-b border-line pb-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2.5" role="tablist" aria-label="Filter integrations">
                    <button
                        role="tab"
                        aria-selected={activeFilter === 'connected'}
                        onClick={() => setActiveFilter('connected')}
                        className={cn(
                            "inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all",
                            activeFilter === 'connected'
                                ? "bg-white/[0.08] text-white border border-white/15 shadow-xs"
                                : "text-ink-mute hover:text-ink hover:bg-white/[0.03]"
                        )}
                    >
                        <span>Connected</span>
                        <span className="rounded border border-line/60 bg-panel px-1.5 py-0.5 font-mono text-[10px] text-ink-mute">
                            {isLoading ? '…' : connectedSourceCount}
                        </span>
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeFilter === 'available'}
                        onClick={() => setActiveFilter('available')}
                        className={cn(
                            "inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all",
                            activeFilter === 'available'
                                ? "bg-white/[0.08] text-white border border-white/15 shadow-xs"
                                : "text-ink-mute hover:text-ink hover:bg-white/[0.03]"
                        )}
                    >
                        <span>Catalog</span>
                    </button>
                    {!isLoading && filterStats.needsAttention > 0 && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                            {filterStats.needsAttention} need attention
                        </span>
                    )}
                    {!isLoading && filterStats.partial > 0 && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                            {filterStats.partial} partial sync{filterStats.partial === 1 ? "" : "s"}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute" aria-hidden="true" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search integrations…"
                            aria-label="Search integrations"
                            className="h-9 w-52 sm:w-60 rounded-lg border border-line bg-panel py-1.5 pl-9 pr-3 text-xs text-ink placeholder:text-ink-mute focus:border-white/30 focus:outline-none transition-colors"
                        />
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
                    {activeFilter === 'connected' && connectedRows.length > 0 && (
                        <section id="connected-sources" aria-labelledby="sources-connected-heading" className="scroll-mt-6">
                            <h2 id="sources-connected-heading" className="sr-only">Connected</h2>
                            <ConnectedSourceList
                                rows={connectedRows}
                                busyActions={busyActions}
                                onSync={handleSync}
                                onDirectSync={handleDirectSync}
                                onDisconnect={disconnectSource}
                                onFixConnection={handleFixConnection}
                                onRenameConnection={handleRenameConnection}
                            />
                        </section>
                    )}
                    {activeFilter === 'available' && availableCards.length > 0 && (
                        <section aria-labelledby="sources-available-heading">
                            <div className="mb-3 flex items-end justify-between">
                                <h2
                                    id="sources-available-heading"
                                    className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute"
                                >
                                    Available connectors
                                </h2>
                                <span className="text-xs text-ink-mute">{availableCards.length}</span>
                            </div>
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
                        </section>
                    )}
                </div>
            )}

            {connectedSourceCount > 0 && (
                <div className="mt-8 flex items-center justify-between border-t border-line pt-4">
                    <p className="text-xs text-ink-mute">Destination pipeline history lives in Sync activity. Source refresh status stays on each source.</p>
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
                    setSourceOutcome({
                        kind: "success",
                        title: "Connection restored",
                        detail: "Authorization is ready. Existing Warehouse history was retained; run a sync when you want updated data.",
                        action: { href: "/explorer", label: "View warehouse" },
                    });
                }}
            />
        </PageShell>
    );
}
