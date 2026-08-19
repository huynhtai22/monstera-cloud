"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { ArrowRight, CheckCircle2, Database, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageShell } from "@/components/ui/PageShell";
import { trackEvent } from "@/lib/analytics-events";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";
import { getSourceUIConfig } from "@/lib/source-ui-registry";
import { useWorkspaceStore } from "@/store/workspace";
import { RunsView } from "@/components/runs/RunsView";

type ConnectionDetailPayload = {
    connection: {
        id: string;
        name: string;
        workspaceId: string;
        provider?: string;
    };
};

type RemoteAccount = {
    id: string;
    name: string;
};

async function fetchConnectionDetail(url: string): Promise<ConnectionDetailPayload> {
    const response = await fetch(url);
    const payload = (await response.json()) as Partial<ConnectionDetailPayload> & { error?: string };
    if (!response.ok || !payload.connection) {
        throw new Error(payload.error || "Failed to load connection");
    }
    return payload as ConnectionDetailPayload;
}

function isoDate(offsetDays = 0) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offsetDays);
    return date.toISOString().slice(0, 10);
}

function SourceSetupPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore();
    const { mutate } = useSWRConfig();
    const newConnectionId = searchParams.get("newConnectionId");
    const provider = searchParams.get("provider");
    const oauthError = searchParams.get("error");
    const [accounts, setAccounts] = useState<RemoteAccount[]>([]);
    const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
    const [loadingAccounts, setLoadingAccounts] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState<{ rows: number; message: string } | null>(null);

    const { data, error, isLoading } = useSWR(
        newConnectionId ? `/api/connections/${newConnectionId}` : null,
        fetchConnectionDetail,
    );
    const connection = data?.connection;
    const sourceConfig = useMemo(() => provider ? getSourceUIConfig(provider) : null, [provider]);

    useEffect(() => {
        if (!connection?.workspaceId || activeWorkspaceId === connection.workspaceId) return;
        setActiveWorkspaceId(connection.workspaceId);
        void mutate("/api/workspaces");
    }, [activeWorkspaceId, connection?.workspaceId, mutate, setActiveWorkspaceId]);

    useEffect(() => {
        if (!oauthError) return;
        toast.error("Connection failed", {
            description: searchParams.get("message") || "Authorization failed",
        });
        trackEvent("oauth_callback_error", { error: oauthError, provider });
    }, [oauthError, provider, searchParams]);

    useEffect(() => {
        if (!connection?.id || !provider || !["meta_ads", "google_ads", "tiktok_business"].includes(provider)) return;
        setLoadingAccounts(true);
        fetch(`/api/connections/${connection.id}/accounts`)
            .then(async (response) => {
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || "Failed to load accounts");
                const nextAccounts = (payload.accounts || []) as RemoteAccount[];
                setAccounts(nextAccounts);
                setSelectedAccounts(nextAccounts.map((account) => account.id));
            })
            .catch((accountError: unknown) => {
                toast.error(accountError instanceof Error ? accountError.message : "Failed to load accounts");
            })
            .finally(() => setLoadingAccounts(false));
    }, [connection?.id, provider]);

    const runFirstImport = async () => {
        if (!connection || !activeWorkspaceId) return;
        if (accounts.length > 0 && selectedAccounts.length === 0) {
            toast.error("Select at least one account to import");
            return;
        }
        setImporting(true);
        try {
            if (accounts.length > 0) {
                const selectionResponse = await fetch(`/api/connections/${connection.id}/accounts`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ selectedIds: selectedAccounts }),
                });
                const selectionPayload = await selectionResponse.json().catch(() => ({}));
                if (!selectionResponse.ok) throw new Error(selectionPayload.error || "Could not save account selection");
            }

            const items = provider === "meta_ads" && selectedAccounts.length > 0
                ? selectedAccounts.map((adAccountId) => ({ connectionId: connection.id, adAccountId }))
                : [{ connectionId: connection.id }];
            const response = await fetch("/api/data-explorer/warehouse/import-batch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    workspaceId: activeWorkspaceId,
                    since: isoDate(-29),
                    until: isoDate(),
                    items,
                }),
            });
            const payload = await response.json();
            if (!response.ok || !payload.success) {
                const detail = payload.results?.find((result: { ok: boolean; error?: string }) => !result.ok)?.error;
                throw new Error(detail || payload.error || "First import failed");
            }

            const rows = Number(payload.approximateRows || 0);
            setImportResult({ rows, message: payload.message || "First import completed." });
            void mutate("/api/workspaces");
            trackEvent("first_warehouse_import_completed", { provider, rows });
            toast.success("First import completed", { description: `${rows.toLocaleString()} warehouse rows processed.` });
        } catch (importError: unknown) {
            const message = importError instanceof Error ? importError.message : "First import failed";
            trackEvent("first_warehouse_import_failed", { provider, message });
            toast.error("Import failed", { description: `${message}. You can retry here or from Data Explorer.` });
        } finally {
            setImporting(false);
        }
    };

    if (!newConnectionId || !provider) {
        return <PageShell><EmptyState icon={<X className="h-12 w-12" />} title="Invalid setup link" description="Missing connection information. Connect the source again." primaryAction={<Link href="/sources" className="inline-flex rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white">Go to Sources</Link>} /></PageShell>;
    }

    if (isLoading) {
        return <PageShell><div className="flex h-96 items-center justify-center" role="status" aria-label="Loading connection"><Loader2 className="h-8 w-8 animate-spin text-cyan-500" /></div></PageShell>;
    }

    if (error || !connection) {
        return <PageShell><EmptyState icon={<Database className="h-12 w-12" />} title="Connection not found" description={error instanceof Error ? error.message : "The connection is unavailable."} primaryAction={<Link href="/sources" className="inline-flex rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white">Back to Sources</Link>} /></PageShell>;
    }

    return (
        <PageShell>
            <div className="mx-auto max-w-2xl">
                <div className="mb-8 text-center">
                    <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-100 dark:bg-cyan-900/30">
                        {importResult ? <CheckCircle2 className="h-8 w-8 text-emerald-600" /> : <Image src={logoPathForConnectionProvider(provider)} alt="" width={40} height={40} className="h-10 w-10 object-contain" />}
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        {importResult ? "Warehouse data is ready" : `${sourceConfig?.name || provider} connected`}
                    </h1>
                    <p className="mt-2 text-gray-600 dark:text-gray-400">
                        {importResult ? `${importResult.rows.toLocaleString()} rows were processed. Verify freshness and data below.` : "Choose the remote accounts, then run the first 30-day warehouse import."}
                    </p>
                </div>

                <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-[#2f3336] dark:bg-black">
                    <div className="flex items-center gap-3">
                        <Image src={logoPathForConnectionProvider(provider)} alt="" width={32} height={32} className="h-8 w-8 object-contain" />
                        <div><p className="font-semibold text-gray-900 dark:text-white">{connection.name}</p><p className="text-sm text-emerald-600">Connected</p></div>
                        <CheckCircle2 className="ml-auto h-5 w-5 text-emerald-500" />
                    </div>
                </div>

                {!importResult && (
                    <>
                        {loadingAccounts && <div className="mb-6 flex items-center gap-2 text-sm text-gray-600" role="status"><Loader2 className="h-4 w-4 animate-spin" />Loading remote accounts…</div>}
                        {accounts.length > 0 && (
                            <fieldset className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-[#2f3336] dark:bg-black">
                                <legend className="px-1 font-semibold text-gray-900 dark:text-white">Accounts to import</legend>
                                <p className="mb-4 text-sm text-gray-500">Only selected accounts will be used for this source.</p>
                                <div className="max-h-60 space-y-2 overflow-y-auto">
                                    {accounts.map((account) => (
                                        <label key={account.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-100 p-3 focus-within:ring-2 focus-within:ring-cyan-500 dark:border-[#2f3336]">
                                            <input type="checkbox" checked={selectedAccounts.includes(account.id)} onChange={(event) => setSelectedAccounts((current) => event.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id))} className="h-4 w-4 rounded" />
                                            <span className="min-w-0"><span className="block truncate font-medium">{account.name}</span><span className="block text-xs text-gray-500">ID: {account.id}</span></span>
                                        </label>
                                    ))}
                                </div>
                            </fieldset>
                        )}
                        <button onClick={runFirstImport} disabled={importing || loadingAccounts} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50">
                            {importing ? <><Loader2 className="h-4 w-4 animate-spin" />Importing data…</> : <>Run first import<ArrowRight className="h-4 w-4" /></>}
                        </button>
                        <button onClick={() => router.push("/sources")} className="mt-3 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-[#2f3336] dark:text-gray-300">Do this later</button>
                    </>
                )}

                {importResult && (
                    <div className="space-y-3">
                        <button onClick={() => router.push("/explorer?tab=warehouse")} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-700">Verify data in Data Explorer<ArrowRight className="h-4 w-4" /></button>
                        <Link href="/settings?tab=api" className="inline-flex w-full items-center justify-center rounded-lg border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-[#2f3336] dark:text-gray-300">Set up Sheets, Looker, or API access</Link>
                    </div>
                )}
                <RunsView workspaceId={connection?.workspaceId || activeWorkspaceId} connectionId={connection?.id} title="This source’s runs" />
            </div>
        </PageShell>
    );
}

export default function SourceSetupPage() {
    return <Suspense fallback={<PageShell><div className="flex h-96 items-center justify-center" role="status"><Loader2 className="h-8 w-8 animate-spin text-cyan-500" /></div></PageShell>}><SourceSetupPageContent /></Suspense>;
}
