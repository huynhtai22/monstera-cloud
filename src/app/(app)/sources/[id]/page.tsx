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
                <p className="text-sm text-red-600">{error instanceof Error ? error.message : "Source not found."}</p>
                <Link href="/sources" className="mt-4 inline-block text-sm font-semibold text-cyan-700 underline">
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
                    className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-cyan-700 hover:underline dark:text-cyan-300"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Sources
                </Link>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-[#2f3336] dark:bg-[#000000]">
                            <Image src={logo} alt="" width={36} height={36} className="object-contain" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">{connection.name}</h1>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {connection.provider} · {isSource ? "Data source" : "Destination"}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {isSource && connection.status === "connected" ? (
                            <PrimaryButton type="button" onClick={refreshWarehouse} disabled={busy !== null}>
                                {busy === "warehouse-refresh" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
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
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
                        >
                            <Unplug className="h-4 w-4" />
                            Disconnect
                        </button>
                    </div>
                </div>
            </div>

            {isSource && ["meta_ads", "google_ads", "tiktok_business"].includes(connection.provider) ? (
                <>
                    <AccountScopePanel provider={connection.provider} credentialsJson={connection.credentials} />
                    <div className="mb-10">
                        <h2 className="mb-3 text-lg font-bold text-gray-900 dark:text-white">Account Selection</h2>
                        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
                            Choose which accounts to include in syncs. Only selected accounts will have data pulled into the workspace.
                        </p>
                        <AccountSelector connectionId={connection.id} provider={connection.provider} />
                    </div>
                </>
            ) : null}

            {/* Health */}
            <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-2xl border border-gray-200/80 bg-white/70 p-5 dark:border-[#2f3336]/60 dark:bg-[#000000]/50">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        <Activity className="h-4 w-4" />
                        Status
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                        {connection.status === "connected" ? (
                            <>
                                <CheckCircle2 className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                                <span className="font-semibold text-gray-900 dark:text-white">Connected</span>
                            </>
                        ) : (
                            <>
                                <AlertCircle className="h-5 w-5 text-red-500" />
                                <span className="font-semibold text-red-700 dark:text-red-300">{connection.status}</span>
                            </>
                        )}
                    </div>
                    {connection.lastError ? (
                        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{connection.lastError}</p>
                    ) : null}
                </div>
                <div className="rounded-2xl border border-gray-200/80 bg-white/70 p-5 dark:border-[#2f3336]/60 dark:bg-[#000000]/50">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        <Clock className="h-4 w-4" />
                        Last sync (connection)
                    </div>
                    <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
                        {connection.lastSyncAt ? new Date(connection.lastSyncAt).toLocaleString() : "—"}
                    </p>
                </div>
                <div className="rounded-2xl border border-gray-200/80 bg-white/70 p-5 dark:border-[#2f3336]/60 dark:bg-[#000000]/50">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        <Calendar className="h-4 w-4" />
                        Refresh cadence
                    </div>
                    <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white">Manual + nightly</p>
                </div>
            </div>

            {/* Recent syncs */}
            {recentLogs.length > 0 ? <div>
                <h2 className="mb-3 text-lg font-bold text-gray-900 dark:text-white">Historical destination activity</h2>
                <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">Legacy pipeline history is read-only during the agency pilot.</p>
                    <ul className="space-y-2">
                        {recentLogs.map((log) => (
                            <li
                                key={log.id}
                                onClick={() => handleOpenDrawer(log)}
                                className={cn(
                                    "flex flex-col gap-1 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between cursor-pointer transition hover:shadow-sm",
                                    log.status === "success"
                                        ? "border-cyan-100 bg-cyan-50/40 hover:bg-cyan-50/70 dark:border-cyan-900/30 dark:bg-cyan-950/20 dark:hover:bg-cyan-950/30"
                                        : "border-red-100 bg-red-50/40 hover:bg-red-50/70 dark:border-red-900/30 dark:bg-red-950/20 dark:hover:bg-red-950/30"
                                )}
                            >
                                <div>
                                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{log.pipeline?.name}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {log.status === "success"
                                            ? `${log.rowsSynced} rows · ${Math.round(log.durationMs / 100) / 10}s`
                                            : log.errorMsg ?? "Failed"}
                                    </div>
                                </div>
                                <div className="text-xs text-gray-450 dark:text-slate-400 font-medium">{new Date(log.createdAt).toLocaleString()}</div>
                            </li>
                        ))}
                    </ul>
                <Link href="/reports" className="mt-4 inline-block text-sm font-semibold text-cyan-700 hover:underline dark:text-cyan-300">
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
