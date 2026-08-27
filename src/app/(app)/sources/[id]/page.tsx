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
} from "lucide-react";
import { toast } from "sonner";
import { PageShell, PrimaryButton, ConfirmDialog, SyncLogDiagnosticsDrawer, type SyncLogWithPipeline } from "@/components/ui";
import { ConnectSourceModal } from "@/components/ConnectSourceModal";
import { integrationCatalogId } from "@/lib/sources-integration-catalog";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";
import { cn } from "@/lib/utils";
import { AccountScopePanel } from "@/components/sources/AccountScopePanel";
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

    const { data, error, isLoading } = useSWR(id ? `/api/connections/${id}` : null, fetcher);

    const connection = data?.connection as
        | {
              id: string;
              name: string;
              type: string;
              provider: string;
              status: string;
              lastError: string | null;
              lastSyncAt: string | null;
              workspaceId: string;
              workspace?: { name: string };
              environment?: "sandbox" | "production" | null;
              credentials?: string;
          }
        | undefined;

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

    return (
        <PageShell>
            <div className="mb-8">
                <Link
                    href="/sources"
                    className="mb-4 inline-flex items-center gap-1 text-xs font-semibold text-ink-mute hover:text-white transition-colors"
                >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Sources
                </Link>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-panel">
                            <Image src={logo} alt="" width={32} height={32} className="object-contain" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-ink">{connection.name}</h1>
                            <p className="text-xs text-ink-mute">
                                {connection.provider} · {isSource ? "Data source" : "Destination"}
                                {connection.environment === "sandbox" ? " · Shopee Sandbox" : ""}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {isSource && connection.status === "connected" ? (
                            <PrimaryButton type="button" onClick={refreshWarehouse} disabled={busy !== null}>
                                {busy === "warehouse-refresh" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                Refresh now
                            </PrimaryButton>
                        ) : null}
                        {isSource && connection.status === "error" ? (
                            <PrimaryButton type="button" onClick={openFixModal}>
                                Fix connection
                            </PrimaryButton>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => setDisconnectOpen(true)}
                            disabled={busy !== null}
                            className="inline-flex items-center gap-1.5 rounded-md border border-red-900/50 bg-red-950/40 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-900/50 transition-colors"
                        >
                            <Unplug className="h-3.5 w-3.5" />
                            Disconnect
                        </button>
                    </div>
                </div>
            </div>

            {isSource && ["meta_ads", "google_ads", "tiktok_business"].includes(connection.provider) ? (
                <>
                    <AccountScopePanel provider={connection.provider} credentialsJson={connection.credentials} />
                    <div className="mb-10">
                        <h2 className="mb-3 text-sm font-bold text-ink">Account Selection</h2>
                        <p className="mb-3 text-xs text-ink-mute">
                            Choose which accounts to include in syncs. Only selected accounts will have data pulled into the workspace.
                        </p>
                        <AccountSelector connectionId={connection.id} provider={connection.provider} />
                    </div>
                </>
            ) : null}

            {/* Health */}
            <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg border border-line bg-panel p-4 shadow-xs">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-ink-mute">
                        <Activity className="h-3.5 w-3.5" />
                        Status
                    </div>
                    <div className="mt-2 flex items-center gap-2">
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
                                <CheckCircle2 className="h-4 w-4 text-white" />
                                <span className="font-semibold text-xs text-ink">Connected</span>
                            </>
                        ) : (
                            <>
                                <AlertCircle className="h-4 w-4 text-red-400" />
                                <span className="font-semibold text-xs text-red-200">{connection.status}</span>
                            </>
                        )}
                    </div>
                    {connection.lastError ? (
                        <p className="mt-2 text-[11px] text-red-400">{connection.lastError}</p>
                    ) : null}
                </div>
                <div className="rounded-lg border border-line bg-panel p-4 shadow-xs">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-ink-mute">
                        <Clock className="h-3.5 w-3.5" />
                        Last fully successful sync
                    </div>
                    <p className="mt-2 text-xs font-semibold text-ink">
                        {connection.lastSyncAt ? new Date(connection.lastSyncAt).toLocaleString() : "—"}
                    </p>
                </div>
                <div className="rounded-lg border border-line bg-panel p-4 shadow-xs">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-ink-mute">
                        <Calendar className="h-3.5 w-3.5" />
                        Refresh cadence
                    </div>
                    <p className="mt-2 text-xs font-semibold text-ink">Manual + nightly</p>
                </div>
            </div>

            {/* Recent syncs */}
            {((data?.recentProviderRuns ?? []) as Array<any>).length > 0 ? <div className="mb-10">
                <h2 className="mb-3 text-sm font-bold text-ink">Shopee sync activity</h2>
                <div className="space-y-2">
                    {((data?.recentProviderRuns ?? []) as Array<any>).map((run) => (
                        <div key={run.id} className="rounded-md border border-line bg-panel p-3 text-xs">
                            <div className="flex items-center justify-between gap-3">
                                <span className="font-semibold text-ink">{run.endpoint}</span>
                                <span className={run.status === "success" ? "text-emerald-300" : "text-red-300"}>{run.status}</span>
                            </div>
                            <p className="mt-1 text-ink-mute">{run.environment} · {run.rowsReceived} received · {run.rowsWritten} written · {new Date(run.startedAt).toLocaleString()}</p>
                            {run.errorMessage ? <p className="mt-1 text-red-300">{run.errorCategory}: {run.errorMessage}</p> : null}
                        </div>
                    ))}
                </div>
            </div> : null}
            {recentLogs.length > 0 ? <div>
                <h2 className="mb-3 text-sm font-bold text-ink">Historical destination activity</h2>
                <p className="mb-4 text-xs text-ink-mute">Legacy pipeline history is read-only during the agency pilot.</p>
                    <ul className="space-y-2">
                        {recentLogs.map((log) => (
                            <li
                                key={log.id}
                                onClick={() => handleOpenDrawer(log)}
                                className={cn(
                                    "flex flex-col gap-1 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between cursor-pointer transition-colors",
                                    log.status === "success"
                                        ? "border-line bg-canvas hover:border-white/30"
                                        : "border-red-900/30 bg-red-950/20 hover:border-red-800/50"
                                )}
                            >
                                <div>
                                    <div className="text-xs font-semibold text-ink">{log.pipeline?.name}</div>
                                    <div className="text-[11px] text-ink-mute">
                                        {log.status === "success"
                                            ? `${log.rowsSynced} rows · ${Math.round(log.durationMs / 100) / 10}s`
                                            : log.errorMsg ?? "Failed"}
                                    </div>
                                </div>
                                <div className="text-[10px] font-mono text-ink-mute">{new Date(log.createdAt).toLocaleString()}</div>
                            </li>
                        ))}
                    </ul>
                <Link href="/reports" className="mt-4 inline-block text-xs font-semibold text-white hover:text-neutral-300 transition-colors">
                    View all logs →
                </Link>
            </div> : null}

            <ConfirmDialog
                open={disconnectOpen}
                title={`Disconnect ${connection.name}?`}
                description="Syncs from this source will stop. Your existing data in the warehouse is not deleted. You can reconnect later."
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
