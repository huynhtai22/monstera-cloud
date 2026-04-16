"use client";

import React, { useCallback, useState } from "react";
import Link from "next/link";
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
import { PageShell } from "@/components/ui/PageShell";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ConnectSourceModal } from "@/components/ConnectSourceModal";
import { integrationCatalogId } from "@/lib/integration-catalog";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";
import { cn } from "@/lib/utils";

const fetcher = async (url: string) => {
    const res = await fetch(url, { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to load");
    return data;
};

function cronHumanize(cron: string): string {
    const c = cron.trim();
    if (c === "0 * * * *") return "Every hour";
    if (c === "0 */4 * * *") return "Every 4 hours";
    if (c === "0 */6 * * *") return "Every 6 hours";
    if (c === "0 0 * * *") return "Daily (midnight UTC)";
    if (c.startsWith("0 ") && c.includes("* * *")) return `Scheduled: ${cron}`;
    return cron;
}

export default function SourceDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = typeof params?.id === "string" ? params.id : "";
    const { mutate } = useSWRConfig();

    const [busy, setBusy] = useState<string | null>(null);
    const [disconnectOpen, setDisconnectOpen] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [modalIntegration, setModalIntegration] = useState<any>(null);

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
          }
        | undefined;

    const pipelines = (data?.pipelines ?? []) as Array<{
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
    }>;

    const recentLogs = (data?.recentLogs ?? []) as Array<{
        id: string;
        status: string;
        rowsSynced: number;
        durationMs: number;
        errorMsg: string | null;
        createdAt: string;
        pipeline: { name: string };
    }>;

    const runSync = useCallback(
        async (pipelineId: string) => {
            setBusy(pipelineId);
            try {
                const res = await fetch(`/api/pipelines/${pipelineId}/run`, { method: "POST" });
                const j = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Sync failed");
                toast.success(j.message || "Sync started.");
                await mutate(`/api/connections/${id}`);
                mutate("/api/workspaces");
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : "Sync failed");
            } finally {
                setBusy(null);
            }
        },
        [id, mutate]
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
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                            <img src={logo} alt="" width={36} height={36} className="object-contain" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">{connection.name}</h1>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {connection.provider} · {isSource ? "Data source" : "Destination"}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
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

            {/* Health */}
            <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-2xl border border-gray-200/80 bg-white/70 p-5 dark:border-slate-700/60 dark:bg-slate-900/50">
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
                <div className="rounded-2xl border border-gray-200/80 bg-white/70 p-5 dark:border-slate-700/60 dark:bg-slate-900/50">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        <Clock className="h-4 w-4" />
                        Last sync (connection)
                    </div>
                    <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
                        {connection.lastSyncAt ? new Date(connection.lastSyncAt).toLocaleString() : "—"}
                    </p>
                </div>
                <div className="rounded-2xl border border-gray-200/80 bg-white/70 p-5 dark:border-slate-700/60 dark:bg-slate-900/50">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        <Calendar className="h-4 w-4" />
                        Pipelines
                    </div>
                    <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white">{pipelines.length} linked</p>
                </div>
            </div>

            {/* Pipelines */}
            <div className="mb-10">
                <h2 className="mb-3 text-lg font-bold text-gray-900 dark:text-white">Pipelines</h2>
                {pipelines.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">No pipelines use this connection yet.</p>
                ) : (
                    <div className="overflow-x-auto rounded-2xl border border-gray-200/80 dark:border-slate-700/60">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 text-xs font-bold uppercase text-gray-400 dark:border-slate-800 dark:text-gray-500">
                                    <th className="py-3 pl-4 pr-4">Name</th>
                                    <th className="py-3 pr-4">Route</th>
                                    <th className="py-3 pr-4">Schedule</th>
                                    <th className="py-3 pr-4">Health</th>
                                    <th className="py-3 pr-4">Last synced</th>
                                    <th className="py-3 pr-4" />
                                </tr>
                            </thead>
                            <tbody>
                                {pipelines.map((p) => (
                                    <tr key={p.id} className="border-b border-gray-50 dark:border-slate-800">
                                        <td className="py-3 pl-4 pr-4 font-semibold text-gray-900 dark:text-white">{p.name}</td>
                                        <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">
                                            {p.sourceConnection?.name ?? "?"} → {p.destinationConnection?.name ?? "?"}
                                        </td>
                                        <td className="py-3 pr-4 text-gray-600 dark:text-gray-300">{cronHumanize(p.scheduleCron)}</td>
                                        <td className="py-3 pr-4">
                                            <span
                                                className={cn(
                                                    "rounded-full px-2 py-0.5 text-xs font-bold",
                                                    p.healthStatus === "healthy"
                                                        ? "bg-cyan-50 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200"
                                                        : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                                                )}
                                            >
                                                {p.healthStatus}
                                            </span>
                                        </td>
                                        <td className="py-3 pr-4 text-gray-500 dark:text-gray-400">
                                            {p.lastSyncedAt ? new Date(p.lastSyncedAt).toLocaleString() : "—"}
                                        </td>
                                        <td className="py-3 pr-4">
                                            <button
                                                type="button"
                                                onClick={() => runSync(p.id)}
                                                disabled={busy !== null}
                                                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                                            >
                                                {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                                Sync
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Recent syncs */}
            <div>
                <h2 className="mb-3 text-lg font-bold text-gray-900 dark:text-white">Recent sync activity</h2>
                <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">Last 30 runs across pipelines involving this connection.</p>
                {recentLogs.length === 0 ? (
                    <p className="text-sm text-gray-500">No sync logs yet.</p>
                ) : (
                    <ul className="space-y-2">
                        {recentLogs.map((log) => (
                            <li
                                key={log.id}
                                className={cn(
                                    "flex flex-col gap-1 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between",
                                    log.status === "success"
                                        ? "border-cyan-100 bg-cyan-50/40 dark:border-cyan-900/30 dark:bg-cyan-950/20"
                                        : "border-red-100 bg-red-50/40 dark:border-red-900/30 dark:bg-red-950/20"
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
                                <div className="text-xs text-gray-400">{new Date(log.createdAt).toLocaleString()}</div>
                            </li>
                        ))}
                    </ul>
                )}
                <Link href="/reports" className="mt-4 inline-block text-sm font-semibold text-cyan-700 hover:underline dark:text-cyan-300">
                    View all logs →
                </Link>
            </div>

            <ConfirmDialog
                open={disconnectOpen}
                title={`Disconnect ${connection.name}?`}
                description="Syncs from this source will stop. Your existing data in destinations is not deleted. You can reconnect later."
                confirmLabel="Disconnect"
                variant="danger"
                onConfirm={confirmDisconnect}
                onCancel={() => setDisconnectOpen(false)}
            />

            <ConnectSourceModal isOpen={modalOpen} onClose={() => setModalOpen(false)} integration={modalIntegration} />
        </PageShell>
    );
}
