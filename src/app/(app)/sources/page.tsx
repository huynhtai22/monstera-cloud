"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import Link from "next/link";
import { toast } from "sonner";
import { Database, Search, Plus, RefreshCw, AlertCircle, Loader2, CheckCircle2, CloudOff, Unplug, ChevronRight, ArrowRight, ChevronDown } from "lucide-react";
import { ConnectSourceModal } from "@/components/ConnectSourceModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import useSWR, { useSWRConfig } from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { integrationCatalogId } from "@/lib/integration-catalog";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";
import { SOURCES_CATALOG, isSourceEnvReady } from "@/lib/sources-integration-catalog";
import { cn } from "@/lib/utils";
import { trackEvent, trackOnce } from "@/lib/analytics-events";
import { PageShell } from "@/components/ui/PageShell";
import { DataFlowExplainer } from "@/components/data-flow/DataFlowExplainer";

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

function IntegrationCardSkeleton() {
    return (
        <div
            className="relative overflow-hidden rounded-2xl border border-white/80 dark:border-slate-600/50 bg-white/40 dark:bg-slate-800/60 p-5 animate-pulse"
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
 * ConnectedSourceRow — compact row for the "Your sources" strip
 * ───────────────────────────────────────────────────────────────────────────── */

interface ConnectedSourceRowProps {
    integration: any;
    busyActions: Set<string>;
    onSync: (pipelineId: string, integrationId: string) => void;
    onDisconnect: (connectionId: string, displayName: string) => void;
    onFixConnection: (integration: any) => void;
}

const ConnectedSourceRow = React.memo(function ConnectedSourceRow({
    integration,
    busyActions,
    onSync,
    onDisconnect,
    onFixConnection,
}: ConnectedSourceRowProps) {
    const isSyncing = busyActions.has(`sync:${integration.pipelineId}`);
    const isDisconnecting = busyActions.has(integration.id);
    const isBusy = busyActions.size > 0;
    const isError = integration.status === "error";

    return (
        <div
            className={cn(
                "group flex items-center gap-3 rounded-xl border bg-white/80 px-3 py-2.5 shadow-sm transition-colors dark:bg-slate-900/70",
                isError
                    ? "border-red-200/80 dark:border-red-800/60"
                    : "border-gray-200/80 hover:border-cyan-200/80 dark:border-slate-700/60 dark:hover:border-cyan-700/50",
            )}
        >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200/70 bg-white dark:border-slate-700/60 dark:bg-slate-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={integration.logoSrc}
                    alt=""
                    width={24}
                    height={24}
                    className="h-6 w-6 object-contain"
                />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <Link
                        href={`/sources/${integration.id}`}
                        className="truncate text-sm font-semibold text-gray-900 hover:text-cyan-700 dark:text-white dark:hover:text-cyan-300"
                    >
                        {integration.name}
                    </Link>
                    {isError ? (
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-label="Error" />
                    ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-cyan-500 dark:text-cyan-400" aria-label="Connected" />
                    )}
                </div>
                <p
                    className={cn(
                        "mt-0.5 truncate text-xs",
                        isError ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-slate-400",
                    )}
                >
                    {isError
                        ? integration.errorMsg ?? "Needs attention"
                        : `Last sync · ${integration.lastSync}`}
                </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
                {isError ? (
                    <button
                        type="button"
                        onClick={() => onFixConnection(integration)}
                        className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-800 transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 dark:hover:bg-red-950/90"
                    >
                        Fix
                    </button>
                ) : (
                    <button
                        type="button"
                        disabled={isBusy || !integration.pipelineId}
                        onClick={() => {
                            if (!integration.pipelineId) {
                                toast.error(
                                    <span>
                                        Add a destination (like Google Sheets) to start syncing.{" "}
                                        <a href="/destinations" className="underline font-medium">Open Destinations</a>
                                    </span>,
                                );
                                return;
                            }
                            onSync(integration.pipelineId, integration.id);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-cyan-300/80 bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-800 transition-colors hover:bg-cyan-100 disabled:pointer-events-none disabled:opacity-50 dark:border-cyan-700/60 dark:bg-cyan-900/40 dark:text-cyan-200 dark:hover:bg-cyan-900/70"
                    >
                        {isSyncing ? (
                            <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Syncing…
                            </>
                        ) : (
                            "Sync"
                        )}
                    </button>
                )}
                <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onDisconnect(integration.id, integration.name)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-red-700 disabled:pointer-events-none disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-red-300"
                >
                    {isDisconnecting ? "Disconnecting…" : "Disconnect"}
                </button>
            </div>
        </div>
    );
});

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
            className={`relative overflow-hidden rounded-2xl border p-5 transition-all duration-200 group flex flex-col justify-between bg-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 hover:bg-white/80 dark:bg-slate-800/90 dark:shadow-[0_12px_40px_rgba(0,0,0,0.35)] dark:hover:bg-slate-800 dark:ring-1 dark:ring-white/5
                ${integration.status === 'error'
                    ? 'border-red-200/80 hover:border-red-300 dark:border-red-800/70 dark:hover:border-red-700'
                    : integration.status === 'available'
                      ? 'border-cyan-200/80 bg-cyan-50/30 dark:border-cyan-700/50 dark:bg-cyan-950/20 hover:border-cyan-300 dark:hover:border-cyan-600'
                      : 'border-gray-200/80 dark:border-slate-600/80 hover:border-cyan-200/80 dark:hover:border-cyan-600/50'}`}
        >
            <div className="flex items-start justify-between mb-3 relative z-10">
                <div className={`relative w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 transition-colors bg-white/70 dark:bg-slate-900/80 overflow-hidden
                    ${integration.status === 'connected' ? 'border-cyan-100/50 dark:border-cyan-700/40' :
                        integration.status === 'syncing' ? 'border-blue-100/50 dark:border-blue-700/40' :
                            integration.status === 'error' ? 'border-red-100/50 dark:border-red-800/50' :
                                'border-cyan-100/50 dark:border-cyan-700/40'}`}>
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
                        <div className="flex items-center rounded-md bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-800 dark:bg-emerald-950/70 dark:text-emerald-300 dark:ring-1 dark:ring-emerald-800/50">
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5 dark:text-emerald-400" />
                            Connected
                        </div>
                    )}
                    {integration.status === 'syncing' && (
                        <div className="flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-950/70 dark:text-blue-200 dark:ring-1 dark:ring-blue-800/50">
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin dark:text-blue-300" />
                            Syncing
                        </div>
                    )}
                    {integration.status === 'error' && (
                        <div className="flex items-center rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-800 dark:bg-red-950/70 dark:text-red-200 dark:ring-1 dark:ring-red-800/50">
                            <AlertCircle className="mr-1 h-3.5 w-3.5 dark:text-red-400" />
                            Error
                        </div>
                    )}
                </div>
            </div>

            <div className="mb-5 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                    {integration.status !== "available" ? (
                        <Link
                            href={`/sources/${integration.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="group/title inline-flex max-w-full items-center gap-1 text-base font-semibold tracking-tight text-gray-900 hover:text-cyan-700 dark:text-white dark:hover:text-cyan-300"
                        >
                            <span className="truncate">{integration.name}</span>
                            <ChevronRight className="h-4 w-4 shrink-0 opacity-50 transition group-hover/title:translate-x-0.5 group-hover/title:opacity-80" aria-hidden />
                        </Link>
                    ) : (
                        <h3 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">{integration.name}</h3>
                    )}
                </div>
                <p className="text-sm leading-relaxed text-gray-600 line-clamp-2 dark:text-slate-300">{integration.description}</p>

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
                    <p className="mt-2 text-xs font-medium text-gray-500 dark:text-slate-400">
                        Last synced: {integration.lastSync}
                    </p>
                )}
                {integration.accountTags && integration.accountTags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                        {(integration.accountTags as string[]).slice(0, 3).map((tag: string) => (
                            <span key={tag} className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700/80 dark:text-slate-300">
                                {tag}
                            </span>
                        ))}
                        {integration.accountTags.length > 3 && (
                            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700/80 dark:text-slate-400">
                                +{integration.accountTags.length - 3} more
                            </span>
                        )}
                    </div>
                )}
                {integration.status === "connected" && !integration.pipelineId ? (
                    <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300/90">
                        No pipeline yet — connect a destination to enable sync.
                    </p>
                ) : null}
            </div>

            <div className="relative z-10">
                {integration.status === 'error' ? (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onFixConnection(integration);
                        }}
                        className="w-full rounded-lg border border-red-300 bg-red-50 py-2 text-sm font-semibold text-red-800 shadow-sm transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 dark:hover:bg-red-950/90"
                    >
                        Fix Connection
                    </button>
                ) : integration.status === 'syncing' ? (
                    <button disabled className="flex w-full cursor-not-allowed items-center justify-center rounded-lg border border-slate-200 bg-slate-100 py-2 text-sm font-semibold text-slate-500 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-400">
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
                            className="w-full rounded-lg border border-cyan-600/30 bg-cyan-600 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-cyan-500 dark:border-cyan-500 dark:bg-cyan-600 dark:hover:bg-cyan-500 disabled:pointer-events-none disabled:opacity-50"
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
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-300/90 bg-red-50/90 py-2 text-sm font-medium text-red-800 transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200 dark:hover:bg-red-950/80 disabled:pointer-events-none disabled:opacity-50"
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
                ) : integration.status === "available" && integration.envConnectReady === false ? (
                    <div className="space-y-2">
                        <button
                            type="button"
                            disabled
                            className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 py-2 text-sm font-semibold text-slate-500 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-400"
                        >
                            Connect unavailable
                        </button>
                        <p className="text-center text-xs leading-snug text-slate-500 dark:text-slate-400">
                            OAuth for this connector is not enabled on this deployment (missing server env vars). With
                            credentials set, Connect uses the standard OAuth flow.
                        </p>
                    </div>
                ) : (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onConnect(integration);
                        }}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-600 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-cyan-700"
                    >
                        Connect <ArrowRight className="h-3.5 w-3.5" />
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
                <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    Recent Syncs
                </h2>
                <Link
                    href="/reports"
                    className="text-xs font-semibold text-cyan-700 hover:underline dark:text-cyan-300"
                >
                    View all logs
                </Link>
            </div>

            <div className="rounded-2xl border border-gray-200/80 bg-white/60 p-5 shadow-sm dark:border-slate-600/70 dark:bg-slate-800/90 dark:ring-1 dark:ring-white/5">
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
    const [addSourceMenuOpen, setAddSourceMenuOpen] = useState(false);
    const addSourceMenuRef = useRef<HTMLDivElement>(null);

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
        const sourceConnections = (workspace?.connections || []).filter((c: any) => c.type === 'source');

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
                            <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">Sources</h1>
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
                            <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">Sources</h1>
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
                            <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">Sources</h1>
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
                    <button
                        onClick={() => mutate('/api/workspaces')}
                        aria-label="Refresh all sources"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-700"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <div className="relative" ref={addSourceMenuRef}>
                        <button
                            type="button"
                            aria-expanded={addSourceMenuOpen}
                            aria-haspopup="listbox"
                            onClick={() => setAddSourceMenuOpen((o) => !o)}
                            className="inline-flex h-10 min-h-[2.5rem] items-center gap-2 rounded-xl border border-cyan-500/35 bg-gradient-to-b from-cyan-500 to-cyan-600 px-3.5 text-sm font-semibold text-white shadow-md shadow-cyan-900/25 transition-all hover:from-cyan-400 hover:to-cyan-500 hover:shadow-lg hover:shadow-cyan-900/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-100 active:scale-[0.98] dark:border-cyan-400/30 dark:from-cyan-600 dark:to-cyan-700 dark:shadow-black/50 dark:focus-visible:ring-offset-slate-900 sm:px-4"
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
                                    className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 shadow-[0_22px_56px_-14px_rgba(15,23,42,0.28)] ring-1 ring-slate-900/[0.04] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95 dark:shadow-[0_28px_64px_-16px_rgba(0,0,0,0.72)] dark:ring-white/[0.06]"
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

            {!isLoading ? <DataFlowExplainer variant="sources" /> : null}

            {!isLoading && activeWorkspace && filteredIntegrations.length > 0 ? (
                <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-gray-200/90 bg-gray-50/90 px-4 py-3 text-sm dark:border-slate-600/70 dark:bg-slate-800/60">
                    <span className="text-gray-600 dark:text-slate-300">
                        In view:{" "}
                        <strong className="font-semibold text-gray-900 dark:text-white">{filterStats.connected}</strong> connected
                    </span>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    <span className="text-gray-600 dark:text-slate-300">
                        <strong
                            className={
                                filterStats.needsAttention > 0
                                    ? "font-semibold text-red-600 dark:text-red-300"
                                    : "font-semibold text-gray-900 dark:text-white"
                            }
                        >
                            {filterStats.needsAttention}
                        </strong>{" "}
                        need attention
                    </span>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    <span className="text-gray-600 dark:text-slate-300">
                        <strong className="font-semibold text-gray-900 dark:text-white">{filterStats.available}</strong> available to
                        connect
                    </span>
                </div>
            ) : null}

            {/* Search and Filter — #9: ARIA tab pattern */}
            <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-8 mb-8">
                <div className="relative flex-1 max-w-md group">
                    <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-cyan-500 dark:text-slate-500" aria-hidden="true" />
                    {/* #9 — added aria-label to search input */}
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search integrations..."
                        aria-label="Search integrations"
                        className="w-full rounded-xl border border-gray-200/80 bg-white/90 py-2.5 pl-10 pr-12 text-sm shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/25 dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                </div>
                {/* #9 — ARIA tab pattern for filter tabs */}
                <div className="flex space-x-6 border-b border-gray-200 dark:border-slate-600/80" role="tablist" aria-label="Filter integrations">
                    <button
                        role="tab"
                        aria-selected={activeFilter === 'all'}
                        onClick={() => setActiveFilter('all')}
                        className={`pb-3 text-sm font-semibold transition-colors ${activeFilter === 'all' ? 'border-b-2 border-cyan-500 text-gray-900 dark:text-white' : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200'}`}
                    >
                        All Sources
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeFilter === 'connected'}
                        onClick={() => setActiveFilter('connected')}
                        className={`pb-3 text-sm font-medium transition-colors ${activeFilter === 'connected' ? 'border-b-2 border-cyan-500 font-semibold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200'}`}
                    >
                        Connected ({isLoading ? '…' : connectedSourceCount})
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeFilter === 'available'}
                        onClick={() => setActiveFilter('available')}
                        className={`pb-3 text-sm font-medium transition-colors ${activeFilter === 'available' ? 'border-b-2 border-cyan-500 font-semibold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200'}`}
                    >
                        Available
                    </button>
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
                    <p className="text-sm text-gray-600 dark:text-gray-400 max-w-sm mb-6">We couldn&apos;t find any data sources matching &quot;{searchQuery}&quot;. Try a different keyword or category.</p>
                </div>
            ) : (
                <div role="tabpanel" aria-live="polite" className="space-y-8">
                    {connectedRows.length > 0 ? (
                        <section aria-labelledby="sources-connected-heading">
                            <div className="mb-3 flex items-end justify-between">
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
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                {connectedRows.map((integration: any) => (
                                    <ConnectedSourceRow
                                        key={integration.id}
                                        integration={integration}
                                        busyActions={busyActions}
                                        onSync={handleSync}
                                        onDisconnect={disconnectSource}
                                        onFixConnection={handleFixConnection}
                                    />
                                ))}
                            </div>
                        </section>
                    ) : null}
                    {availableCards.length > 0 ? (
                        <section aria-labelledby="sources-available-heading">
                            <div className="mb-3 flex items-end justify-between">
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
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 auto-rows-fr [&>*]:h-full">
                                {availableCards.map((integration: any) => (
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
        </PageShell>
    );
}
