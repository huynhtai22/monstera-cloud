"use client";

import React, { useCallback, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import {
    ArrowLeft,
    AlertCircle,
    CheckCircle2,
    Clock,
    Loader2,
    RefreshCw,
    Unplug,
    Calendar,
    Activity,
    Pencil,
    Check,
    X,
    ExternalLink,
    BarChart3,
    Database,
    ShieldCheck,
    Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { PageShell, PrimaryButton, ConfirmDialog, SyncLogDiagnosticsDrawer, CopyableBadge, type SyncLogWithPipeline } from "@/components/ui";
import { ConnectSourceModal } from "@/components/ConnectSourceModal";
import { integrationCatalogId } from "@/lib/sources-integration-catalog";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";
import { cn } from "@/lib/utils";
import { AccountSelector } from "@/components/sources/AccountSelector";

const fetcher = async (url: string) => {
    const res = await fetch(url, { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to load");
    return data;
};

export default function SourceDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = typeof params?.id === "string" ? params.id : "";
    const { mutate } = useSWRConfig();

    const [busy, setBusy] = useState<string | null>(null);
    const [disconnectOpen, setDisconnectOpen] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [modalIntegration, setModalIntegration] = useState<any>(null);
    const [selectedLog, setSelectedLog] = useState<SyncLogWithPipeline | null>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    // Inline rename state
    const [isEditingName, setIsEditingName] = useState(false);
    const [nameInput, setNameInput] = useState("");
    const [savingName, setSavingName] = useState(false);

    const { data, error, isLoading } = useSWR(id ? `/api/connections/${id}` : null, fetcher);

    const connection = data?.connection as
        | {
              id: string;
              name: string;
              type: string;
              provider: string;
              remoteAccountId?: string;
              status: string;
              lastError: string | null;
              lastSyncAt: string | null;
              workspaceId: string;
              workspace?: { name: string };
              credentials?: string;
              environment?: "sandbox" | "production" | null;
          }
        | undefined;

    const managerBadge = React.useMemo(() => {
        if (!connection) return null;
        let creds: Record<string, unknown> = {};
        try {
            creds = typeof connection.credentials === "string" ? JSON.parse(connection.credentials) : (connection.credentials ?? {});
        } catch {
            creds = {};
        }

        if (connection.provider === "google_ads") {
            const rawRemoteId = String(connection.remoteAccountId ?? "").replace(/\D/g, "");
            const isExplicitCustomer = creds.googleAdsRootType === "customer";
            const isExplicitManager = Boolean(creds.mccId || creds.managerCustomerId || creds.googleAdsRootType === "manager");
            const cids = creds.customerIds as string[] | undefined;
            const cidList = Array.isArray(cids) ? cids : [];
            const resolvedMccId = isExplicitManager
                ? (creds.mccId || creds.managerCustomerId || (rawRemoteId.length > 0 ? rawRemoteId : undefined))
                : (!isExplicitCustomer && rawRemoteId.length > 0 && !cidList.includes(rawRemoteId) ? rawRemoteId : undefined);
            if (resolvedMccId) {
                const clean = String(resolvedMccId).replace(/\D/g, "");
                return `MCC: ${clean.length === 10 ? `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}` : resolvedMccId}`;
            }
            if (cidList.length === 1 || (isExplicitCustomer && rawRemoteId.length > 0)) {
                const targetCid = cidList[0] || rawRemoteId;
                const clean = String(targetCid).replace(/\D/g, "");
                return `CID: ${clean.length === 10 ? `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}` : targetCid}`;
            }
            if (cidList.length > 1) {
                const clean = String(cidList[0]).replace(/\D/g, "");
                return `MCC: ${clean.length === 10 ? `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}` : cidList[0]}`;
            }
        }

        if (connection.provider === "meta_ads") {
            const bmId = creds.businessManagerId || creds.bmId;
            if (bmId) return `BM: ${bmId}`;
            const ads = creds.adAccounts as Array<{ id: string }> | undefined;
            if (Array.isArray(ads) && ads.length > 0) {
                return `act_${String(ads[0].id).replace(/^act_/, "")}`;
            }
        }

        if (connection.provider === "tiktok_business") {
            const bcId = creds.businessCenterId || creds.bcId;
            if (bcId) return `BC: ${bcId}`;
        }

        if (connection.provider === "shopee") {
            const shopId = creds.shop_id || creds.shopId;
            if (shopId) return `Shop: ${shopId}`;
        }

        if (connection.provider === "shopify") {
            const domain = creds.shopDomain || creds.domain;
            if (domain) return `Store: ${domain}`;
        }

        return null;
    }, [connection]);

    const accountEmail = React.useMemo(() => {
        if (!connection) return null;
        let creds: Record<string, unknown> = {};
        try {
            creds = typeof connection.credentials === "string" ? JSON.parse(connection.credentials) : (connection.credentials ?? {});
        } catch {
            creds = {};
        }
        return (creds.accountEmail || creds.email || null) as string | null;
    }, [connection]);

    const pipelines = React.useMemo(() => (data?.pipelines ?? []) as Array<{
        id: string;
        name: string;
        scheduleCron: string;
        status: string;
        healthStatus: string;
        lastSyncedAt: string | null;
        sourceConnectionId: string;
        destinationConnectionId: string;
        sourceConnection: { name: string; provider: string };
        destinationConnection: { name: string; provider: string };
    }>, [data?.pipelines]);

    const handleOpenDrawer = useCallback((log: any) => {
        if (!data?.connection) return;

        const conn = data.connection;
        // Enrich the log with pipeline details
        const pipelineInfo = pipelines.find((p) => p.name === log.pipeline?.name) || {
            id: log.pipelineId || "",
            name: log.pipeline?.name || "Pipeline",
            sourceConnectionId: conn.id,
        };

        const enrichedLog: SyncLogWithPipeline = {
            id: log.id,
            status: log.status,
            rowsSynced: log.rowsSynced,
            durationMs: log.durationMs,
            errorMsg: log.errorMsg,
            createdAt: log.createdAt,
            pipeline: {
                id: pipelineInfo.id,
                name: pipelineInfo.name,
                sourceConnectionId: pipelineInfo.sourceConnectionId || conn.id,
                destinationConnectionId: (pipelineInfo as any).destinationConnectionId,
                clientId: (pipelineInfo as any).clientId,
            }
        };

        setSelectedLog(enrichedLog);
        setIsDrawerOpen(true);
    }, [data, pipelines]);

    const recentLogs = (data?.recentLogs ?? []) as Array<{
        id: string;
        status: string;
        rowsSynced: number;
        durationMs: number;
        errorMsg: string | null;
        createdAt: string;
        pipeline: { name: string };
    }>;

    const refreshWarehouse = useCallback(
        async () => {
            if (!connection) return;
            setBusy("warehouse-refresh");
            try {
                const res = await fetch("/api/data-explorer/warehouse/import-batch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        workspaceId: connection.workspaceId,
                        since: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
                        until: new Date().toISOString().slice(0, 10),
                        items: [{ connectionId: connection.id }],
                    }),
                });
                const j = await res.json().catch(() => ({}));
                if (!res.ok || !j.success) throw new Error(typeof j.error === "string" ? j.error : j.results?.[0]?.error || "Refresh failed");
                toast.success("Warehouse refreshed", { description: `${Number(j.approximateRows || 0).toLocaleString()} rows processed.` });
                await mutate(`/api/connections/${id}`);
                await mutate("/api/workspaces");
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : "Refresh failed");
            } finally {
                setBusy(null);
            }
        },
        [connection, id, mutate]
    );

    const handleSaveName = async () => {
        if (!connection || !nameInput.trim()) return;
        setSavingName(true);
        try {
            const res = await fetch(`/api/connections/${connection.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: nameInput.trim() }),
            });
            if (!res.ok) throw new Error("Failed to rename connection");
            toast.success("Connection renamed");
            setIsEditingName(false);
            await mutate(`/api/connections/${id}`);
            await mutate("/api/workspaces");
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Could not rename connection");
        } finally {
            setSavingName(false);
        }
    };

    const confirmDisconnect = async () => {
        if (!connection) return;
        setBusy("disconnect");
        try {
            const res = await fetch(`/api/connections/${connection.id}`, { method: "DELETE" });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Disconnect failed");
            toast.success(j.message || "Disconnected.");
            await mutate("/api/workspaces");
            router.push("/sources");
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Could not disconnect.");
        } finally {
            setBusy(null);
            setDisconnectOpen(false);
        }
    };

    const openFixModal = () => {
        if (!connection) return;
        const cat = integrationCatalogId(connection.provider);
        setModalIntegration({
            id: cat,
            catalogId: cat,
            name: connection.name,
            description: `${connection.provider} — reconnect`,
            logoSrc: logoPathForConnectionProvider(connection.provider),
            status: "available",
        });
        setModalOpen(true);
    };

    if (!id) {
        return (
            <PageShell>
                <p className="text-sm text-gray-500">Invalid source.</p>
            </PageShell>
        );
    }

    if (isLoading) {
        return (
            <PageShell>
                <div className="flex items-center gap-2 text-gray-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Loading source…
                </div>
            </PageShell>
        );
    }

    if (error || !connection) {
        return (
            <PageShell>
                <p className="text-xs text-red-400">{error instanceof Error ? error.message : "Source not found."}</p>
                <Link href="/sources" className="mt-4 inline-block text-xs font-semibold text-white underline hover:no-underline">
                    Back to Sources
                </Link>
            </PageShell>
        );
    }

    const isSource = connection.type === "source";
    const logo = logoPathForConnectionProvider(connection.provider);
    const shortId = connection.id ? connection.id.slice(-4) : "";
    const isGoogleOrMeta = ["google_ads", "meta_ads", "tiktok_business"].includes(connection.provider);

    return (
        <PageShell>
            {/* Navigation & Header */}
            <div className="mb-8">
                <Link
                    href="/sources"
                    className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-ink-mute hover:text-white transition-colors"
                >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to Sources
                </Link>

                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                    {/* Brand & Connection Identity */}
                    <div className="flex items-start gap-4 min-w-0">
                        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
                            <Image src={logo} alt="" width={36} height={36} className="object-contain" />
                            <span
                                className={cn(
                                    "absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full ring-2 ring-panel",
                                    connection.lastError?.startsWith("[partial]")
                                          ? "bg-amber-400"
                                          : connection.lastError?.startsWith("[failed]")
                                            ? "bg-red-400"
                                            : connection.status === "connected"
                                              ? "bg-emerald-400"
                                              : "bg-red-400"
                                )}
                            />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2.5">
                                {isEditingName ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            value={nameInput}
                                            onChange={(e) => setNameInput(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") handleSaveName();
                                                if (e.key === "Escape") setIsEditingName(false);
                                            }}
                                            placeholder="Connection name…"
                                            autoFocus
                                            className="h-8 rounded-lg border border-white/20 bg-canvas px-2.5 text-base font-bold text-ink focus:border-white/40 focus:outline-none"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleSaveName}
                                            disabled={savingName}
                                            className="rounded-md p-1.5 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                                            title="Save name"
                                        >
                                            <Check className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setIsEditingName(false)}
                                            className="rounded-md p-1.5 text-ink-mute hover:bg-white/[0.05] transition-colors"
                                            title="Cancel"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <h1 className="truncate text-xl font-bold tracking-tight text-ink">
                                            {connection.name}
                                        </h1>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setNameInput(connection.name);
                                                setIsEditingName(true);
                                            }}
                                            className="rounded p-1 text-ink-mute/60 hover:bg-white/[0.06] hover:text-ink transition-colors"
                                            title="Rename connection"
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                    </>
                                )}

                                {managerBadge ? (
                                    <CopyableBadge text={managerBadge} className="border-line bg-panel text-ink font-mono" />
                                ) : null}

                                {accountEmail ? (
                                    <CopyableBadge
                                        text={accountEmail}
                                        copyValue={accountEmail}
                                        prefix="✉"
                                        title={`Authorized account: ${accountEmail}`}
                                        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-mono"
                                    />
                                ) : null}

                                <CopyableBadge text={`#${shortId}`} copyValue={connection.id} title={`Connection ID: ${connection.id}`} className="text-ink-mute/80" />
                            </div>

                            <p className="mt-1 text-xs text-ink-mute">
                                {connection.provider} · {isSource ? "Direct Warehouse Ingestion Source" : "Destination Pipeline"}{connection.environment === "sandbox" ? " · Shopee Sandbox" : ""}
                            </p>
                        </div>
                    </div>

                    {/* Primary Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2.5">
                        {isSource && connection.status === "connected" ? (
                            <PrimaryButton type="button" onClick={refreshWarehouse} disabled={busy !== null}>
                                {busy === "warehouse-refresh" ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <RefreshCw className="h-3.5 w-3.5" />
                                )}
                                <span>Sync now</span>
                            </PrimaryButton>
                        ) : null}

                        <Link
                            href={`/explorer`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3.5 py-1.5 text-xs font-semibold text-ink hover:bg-white/[0.04] hover:border-white/30 transition-all shadow-xs"
                        >
                            <BarChart3 className="h-3.5 w-3.5 text-ink-mute" />
                            <span>View in Explorer</span>
                        </Link>

                        {isSource && (connection.status === "error" || connection.lastError) ? (
                            <button
                                type="button"
                                onClick={openFixModal}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 transition-all shadow-xs"
                            >
                                <Wrench className="h-3.5 w-3.5" />
                                <span>Reconnect</span>
                            </button>
                        ) : null}

                        <button
                            type="button"
                            onClick={() => setDisconnectOpen(true)}
                            disabled={busy !== null}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-900/40 bg-red-950/30 px-3.5 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-900/40 transition-colors"
                        >
                            <Unplug className="h-3.5 w-3.5" />
                            <span>Disconnect</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Operational Health Bento Grid */}
            <div className="mb-8 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                {/* 1. Status */}
                <div className="rounded-xl border border-line bg-panel p-4 shadow-xs">
                    <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-ink-mute">
                        <Activity className="h-3.5 w-3.5" />
                        <span>Ingestion Health</span>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2">
                        {connection.lastError?.startsWith("[partial]") ? (
                            <>
                                <AlertCircle className="h-4 w-4 text-amber-400" />
                                <span className="font-semibold text-xs text-amber-200">Partial sync</span>
                            </>
                        ) : connection.lastError?.startsWith("[failed]") ? (
                            <>
                                <AlertCircle className="h-4 w-4 text-red-400" />
                                <span className="font-semibold text-xs text-red-200">Failed sync</span>
                            </>
                        ) : connection.status === "connected" ? (
                            <>
                                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                <span className="font-semibold text-xs text-ink">Active & Verified</span>
                            </>
                        ) : (
                            <>
                                <AlertCircle className="h-4 w-4 text-red-400" />
                                <span className="font-semibold text-xs text-red-200">{connection.status}</span>
                            </>
                        )}
                    </div>
                    <p className="mt-1 text-[11px] text-ink-mute truncate" title={connection.lastError || "Durable background pipeline running smoothly."}>
                        {connection.lastError || "Incremental delta ingestion active."}
                    </p>
                </div>

                {/* 2. Last Sync */}
                <div className="rounded-xl border border-line bg-panel p-4 shadow-xs">
                    <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-ink-mute">
                        <Clock className="h-3.5 w-3.5" />
                        <span>Data Freshness</span>
                    </div>
                    <p className="mt-2.5 text-xs font-semibold text-ink">
                        {connection.lastSyncAt ? new Date(connection.lastSyncAt).toLocaleString() : "Never synced"}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-mute">
                        {connection.lastSyncAt ? "Verified with warehouse delta" : "Run first sync to populate data"}
                    </p>
                </div>

                {/* 3. Pipeline Mode */}
                <div className="rounded-xl border border-line bg-panel p-4 shadow-xs">
                    <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-ink-mute">
                        <Database className="h-3.5 w-3.5" />
                        <span>Warehouse Target</span>
                    </div>
                    <p className="mt-2.5 text-xs font-semibold text-ink">Direct Warehouse Sink</p>
                    <p className="mt-1 text-[11px] text-ink-mute">
                        {connection.workspace?.name || "Active Workspace"}
                    </p>
                </div>

                {/* 4. Automated Cadence */}
                <div className="rounded-xl border border-line bg-panel p-4 shadow-xs">
                    <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-ink-mute">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>Sync Cadence</span>
                    </div>
                    <p className="mt-2.5 text-xs font-semibold text-ink">Hourly auto-sync</p>
                    <p className="mt-1 text-[11px] text-ink-mute">Lease-fenced incremental</p>
                </div>
            </div>

            {Array.isArray(data?.recentProviderRuns) && data.recentProviderRuns.length > 0 ? (
                <div className="mb-8">
                    <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-ink">Source activity</h2>
                    <div className="space-y-2">
                        {data.recentProviderRuns.map((run: any) => (
                            <div key={run.id} className="rounded-lg border border-line bg-panel p-3 text-xs">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="font-semibold text-ink">{run.endpoint}</span>
                                    <span className={run.status === "success" ? "text-emerald-300" : "text-red-300"}>{run.status}</span>
                                </div>
                                <p className="mt-1 text-ink-mute">{run.environment} · {run.rowsReceived} received · {run.rowsWritten} written{run.providerRequestId ? ` · request ${run.providerRequestId}` : ""}</p>
                                {run.errorMessage ? <p className="mt-1 text-red-300">{run.errorCategory}: {run.errorMessage}</p> : null}
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {/* Ad Account Management Hub (Unified Table View) */}
            {isSource && isGoogleOrMeta ? (
                <div className="mb-10">
                    <AccountSelector
                        connectionId={connection.id}
                        provider={connection.provider}
                        connectionName={connection.name}
                        managerBadge={managerBadge}
                        accountEmail={accountEmail}
                        variant="compact"
                    />
                </div>
            ) : null}

            {/* Warehouse Verification Callout */}
            <div className="mb-10 rounded-xl border border-line/80 bg-panel/60 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-canvas text-ink">
                        <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div>
                        <h4 className="text-xs font-semibold text-ink">Verify Ingested Ad Metrics</h4>
                        <p className="mt-0.5 text-[11px] text-ink-mute">
                            Review Spend, Impressions, Clicks, and ROAS across all selected ad accounts in the governed Explorer.
                        </p>
                    </div>
                </div>
                <Link
                    href="/explorer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-3.5 py-1.5 text-xs font-medium text-ink hover:border-white/30 transition-colors shrink-0"
                >
                    <span>Open Data Explorer</span>
                    <ExternalLink className="h-3 w-3 text-ink-mute" />
                </Link>
            </div>

            {/* Recent Execution Logs */}
            {recentLogs.length > 0 ? (
                <div className="mb-8">
                    <div className="mb-3 flex items-center justify-between">
                        <div>
                            <h2 className="text-xs font-bold uppercase tracking-wider text-ink">Recent Ingestion Runs</h2>
                            <p className="text-[11px] text-ink-mute">Execution duration, row throughput, and diagnostic traces.</p>
                        </div>
                        <Link href="/reports" className="text-xs font-medium text-ink-mute hover:text-ink transition-colors">
                            View full audit log →
                        </Link>
                    </div>

                    <ul className="space-y-2">
                        {recentLogs.map((log) => (
                            <li
                                key={log.id}
                                onClick={() => handleOpenDrawer(log)}
                                className={cn(
                                    "flex flex-col gap-1 rounded-lg border p-3.5 sm:flex-row sm:items-center sm:justify-between cursor-pointer transition-colors",
                                    log.status === "success"
                                        ? "border-line bg-panel hover:border-white/30 hover:bg-white/[0.02]"
                                        : "border-red-900/30 bg-red-950/20 hover:border-red-800/50"
                                )}
                            >
                                <div>
                                    <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                                        <span
                                            className={cn(
                                                "h-1.5 w-1.5 rounded-full",
                                                log.status === "success" ? "bg-emerald-400" : "bg-red-400"
                                            )}
                                        />
                                        <span>{log.pipeline?.name || connection.name}</span>
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-ink-mute">
                                        {log.status === "success"
                                            ? `${log.rowsSynced.toLocaleString()} rows ingested · ${Math.round(log.durationMs / 100) / 10}s duration`
                                            : log.errorMsg ?? "Pipeline execution failed"}
                                    </div>
                                </div>
                                <div className="text-[10px] font-mono text-ink-mute">
                                    {new Date(log.createdAt).toLocaleString()}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {/* Modals & Drawers */}
            <ConfirmDialog
                open={disconnectOpen}
                title={`Disconnect ${connection.name}?`}
                description="Syncs from this source will stop. Your existing data in the warehouse is retained; you can reconnect anytime."
                confirmLabel="Disconnect"
                variant="danger"
                onConfirm={confirmDisconnect}
                onCancel={() => setDisconnectOpen(false)}
            />

            <ConnectSourceModal isOpen={modalOpen} onClose={() => setModalOpen(false)} integration={modalIntegration} />

            <SyncLogDiagnosticsDrawer
                isOpen={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                log={selectedLog}
                workspaceId={connection.workspaceId}
                workspaceName={connection.workspace?.name ?? undefined}
            />
        </PageShell>
    );
}
