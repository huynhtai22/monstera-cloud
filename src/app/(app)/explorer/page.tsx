"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { AgGridReact } from "ag-grid-react";
import {
    IDatasource,
    IGetRowsParams,
    GridReadyEvent,
    ModuleRegistry,
    AllCommunityModule,
} from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

ModuleRegistry.registerModules([AllCommunityModule]);

import {
    UploadCloud,
    Database,
    Loader2,
    ArrowRight,
    Table,
    Link2,
    CloudDownload,
} from "lucide-react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useWorkspaceStore } from "@/store/workspace";

type ExplorerTab = "warehouse" | "csv";

function defaultMayRange(): { since: string; until: string } {
    return { since: "2026-05-01", until: "2026-05-07" };
}

export default function DataExplorerPage() {
    const { activeWorkspaceId } = useWorkspaceStore();

    const [tab, setTab] = useState<ExplorerTab>("warehouse");

    // --- CSV mode ---
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [datasetId, setDatasetId] = useState<string | null>(null);
    const [datasetStats, setDatasetStats] = useState<{ filename: string; size: string } | null>(null);
    const [csvGridHeaders, setCsvGridHeaders] = useState<{ field: string }[]>([]);

    // --- Warehouse mode ---
    const [metaConnections, setMetaConnections] = useState<{ id: string; name: string }[]>([]);
    const [whConnectionId, setWhConnectionId] = useState<string>("");
    const [adAccounts, setAdAccounts] = useState<{ id: string; name: string }[]>([]);
    const [whAdAccountId, setWhAdAccountId] = useState<string>("");
    const [whSince, setWhSince] = useState(defaultMayRange().since);
    const [whUntil, setWhUntil] = useState(defaultMayRange().until);
    const [whImporting, setWhImporting] = useState(false);
    const [whError, setWhError] = useState<string | null>(null);
    const [whSuccess, setWhSuccess] = useState<string | null>(null);
    const [whReady, setWhReady] = useState(false);
    const [whGridHeaders, setWhGridHeaders] = useState<{ field: string }[]>([]);
    const [whGridVersion, setWhGridVersion] = useState(0);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!activeWorkspaceId) return;
        let cancelled = false;
        (async () => {
            const res = await fetch(`/api/workspaces/${activeWorkspaceId}/connections`);
            if (!res.ok || cancelled) return;
            const list = (await res.json()) as { id: string; name: string; provider: string; type: string }[];
            const meta = list.filter((c) => c.provider === "meta_ads" && c.type === "source");
            setMetaConnections(meta.map((m) => ({ id: m.id, name: m.name })));
            setWhConnectionId((prev) => (prev && meta.some((m) => m.id === prev) ? prev : meta[0]?.id ?? ""));
        })();
        return () => {
            cancelled = true;
        };
    }, [activeWorkspaceId]);

    useEffect(() => {
        if (!whConnectionId) {
            setAdAccounts([]);
            setWhAdAccountId("");
            return;
        }
        let cancelled = false;
        (async () => {
            const res = await fetch(
                `/api/data-explorer/meta-accounts?connectionId=${encodeURIComponent(whConnectionId)}`,
            );
            if (!res.ok || cancelled) return;
            const data = (await res.json()) as { accounts: { id: string; name: string }[] };
            setAdAccounts(data.accounts ?? []);
            if (data.accounts?.[0]) setWhAdAccountId(data.accounts[0].id);
        })();
        return () => {
            cancelled = true;
        };
    }, [whConnectionId]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setUploadError(null);
        }
    };

    const handleUpload = async () => {
        if (!file || !activeWorkspaceId) return;

        setIsUploading(true);
        setUploadError(null);
        const formData = new FormData();
        formData.append("file", file);
        formData.append("workspaceId", activeWorkspaceId);

        try {
            const res = await fetch("/api/data-explorer/upload", {
                method: "POST",
                body: formData,
            });

            if (res.ok) {
                const data = await res.json();
                setDatasetId(data.datasetId);
                setDatasetStats({ filename: data.filename, size: data.size });

                const headRes = await fetch(
                    `/api/data-explorer/query?datasetId=${data.datasetId}&startRow=0&endRow=1`,
                );
                if (headRes.ok) {
                    const headData = await headRes.json();
                    if (headData.columns) {
                        setCsvGridHeaders(
                            headData.columns.map((col: string) => ({
                                field: col,
                                sortable: true,
                                filter: true,
                                resizable: true,
                            })),
                        );
                    }
                } else {
                    const errorData = await headRes.json().catch(() => ({}));
                    setUploadError(errorData.error || `Failed to read dataset: ${headRes.status}`);
                    setDatasetId(null);
                }
            } else {
                const errorData = await res.json().catch(() => ({}));
                setUploadError(errorData.error || `Upload failed with status: ${res.status}`);
            }
        } catch (error: unknown) {
            console.error("Network error during upload:", error);
            setUploadError(error instanceof Error ? error.message : "A network error occurred.");
        } finally {
            setIsUploading(false);
        }
    };

    const handleWarehouseImport = async () => {
        if (!activeWorkspaceId || !whConnectionId) {
            setWhError("Select a Meta connection.");
            return;
        }
        setWhImporting(true);
        setWhError(null);
        setWhSuccess(null);
        try {
            const res = await fetch("/api/data-explorer/warehouse/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    workspaceId: activeWorkspaceId,
                    connectionId: whConnectionId,
                    since: whSince,
                    until: whUntil,
                    ...(whAdAccountId ? { adAccountId: whAdAccountId } : {}),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setWhError(data.error || "Import failed");
                return;
            }
            setWhSuccess(data.message || "Import complete.");
            const cols: string[] = data.columns ?? [
                "date",
                "platform",
                "accountId",
                "accountName",
                "campaignId",
                "campaignName",
                "impressions",
                "clicks",
                "spend",
                "cpc",
                "ctr",
                "conversions",
                "roas",
                "currency",
            ];
            setWhGridHeaders(
                cols.map((col) => ({
                    field: col,
                    sortable: true,
                    filter: true,
                    resizable: true,
                })),
            );
            setWhReady(true);
            setWhGridVersion((v) => v + 1);
        } catch (e: unknown) {
            setWhError(e instanceof Error ? e.message : "Import failed");
        } finally {
            setWhImporting(false);
        }
    };

    const onCsvGridReady = useCallback(
        (params: GridReadyEvent) => {
            if (!datasetId) return;

            const dataSource: IDatasource = {
                getRows: async (p: IGetRowsParams) => {
                    try {
                        const response = await fetch(
                            `/api/data-explorer/query?datasetId=${datasetId}&startRow=${p.startRow}&endRow=${p.endRow}`,
                        );
                        const data = await response.json();

                        if (data.rows) {
                            p.successCallback(data.rows, data.lastRow);
                        } else {
                            p.failCallback();
                        }
                    } catch {
                        p.failCallback();
                    }
                },
            };

            params.api.setGridOption("datasource", dataSource);
        },
        [datasetId],
    );

    const onWarehouseGridReady = useCallback(
        (params: GridReadyEvent) => {
            if (!activeWorkspaceId || !whConnectionId || !whReady) return;

            const ws = activeWorkspaceId;
            const conn = whConnectionId;
            const startDate = whSince;
            const endDate = whUntil;

            const dataSource: IDatasource = {
                getRows: async (p: IGetRowsParams) => {
                    try {
                        const response = await fetch(
                            `/api/data-explorer/warehouse/query?workspaceId=${encodeURIComponent(ws)}&connectionId=${encodeURIComponent(conn)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&startRow=${p.startRow}&endRow=${p.endRow}`,
                        );
                        const data = await response.json();

                        if (data.rows) {
                            p.successCallback(data.rows, data.lastRow);
                        } else {
                            p.failCallback();
                        }
                    } catch {
                        p.failCallback();
                    }
                },
            };

            params.api.setGridOption("datasource", dataSource);
        },
        [activeWorkspaceId, whConnectionId, whSince, whUntil, whReady],
    );

    const clearCsv = () => {
        setDatasetId(null);
        setFile(null);
        setCsvGridHeaders([]);
        setDatasetStats(null);
    };

    const clearWarehouse = () => {
        setWhReady(false);
        setWhGridHeaders([]);
        setWhSuccess(null);
        setWhError(null);
    };

    const showCsvGrid = tab === "csv" && datasetId && csvGridHeaders.length > 0;
    const showWhGrid = tab === "warehouse" && whReady && whGridHeaders.length > 0;

    return (
        <div className="relative mx-auto flex h-[calc(100vh-80px)] w-full max-w-7xl animate-in fade-in duration-300 flex-col px-8 py-10">
            <div className="relative z-10 mb-6 flex shrink-0 flex-col justify-between space-y-4 sm:flex-row sm:items-start sm:space-y-0">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        <Table className="h-5 w-5" aria-hidden />
                    </div>
                    <div>
                        <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                            Data Explorer
                        </h1>
                        <p className="max-w-2xl text-base text-gray-600 dark:text-gray-400">
                            Explore the internal <strong className="font-semibold text-gray-800 dark:text-slate-200">warehouse</strong> (synced Meta campaign metrics) or upload huge raw CSVs into the
                            temporary Data Lake. The grid virtualizes large result sets in your browser.
                        </p>
                    </div>
                </div>
            </div>

            <div className="mb-4 flex shrink-0 gap-2 border-b border-gray-200 pb-3 dark:border-slate-700">
                <button
                    type="button"
                    onClick={() => setTab("warehouse")}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                        tab === "warehouse"
                            ? "bg-cyan-600 text-white shadow-sm"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    }`}
                >
                    <Database className="h-4 w-4" />
                    Internal warehouse
                </button>
                <button
                    type="button"
                    onClick={() => setTab("csv")}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                        tab === "csv"
                            ? "bg-cyan-600 text-white shadow-sm"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    }`}
                >
                    <UploadCloud className="h-4 w-4" />
                    CSV upload
                </button>
            </div>

            {tab === "warehouse" && !showWhGrid && (
                <div className="flex flex-1 flex-col rounded-2xl border border-cyan-200/40 bg-gradient-to-b from-cyan-50/50 to-white p-6 shadow-sm dark:border-cyan-900/30 dark:from-cyan-950/20 dark:to-slate-900/40">
                    <div className="mb-4 flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-200 bg-white text-cyan-600 dark:border-cyan-800 dark:bg-slate-900">
                            <Link2 className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Meta Ads → warehouse</h2>
                            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                                Pulls campaign-level daily insights from Meta into your workspace warehouse, then loads rows into the grid. Default range is{" "}
                                <span className="font-mono text-xs">2026-05-01</span>–
                                <span className="font-mono text-xs">2026-05-07</span> — adjust as needed (plan history limits apply).
                            </p>
                        </div>
                    </div>

                    {!activeWorkspaceId ? (
                        <p className="text-sm text-amber-700 dark:text-amber-400">Select a workspace from the sidebar first.</p>
                    ) : metaConnections.length === 0 ? (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                            No Meta Ads source connections in this workspace. Connect Meta under Sources, then return here.
                        </p>
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2">
                            <label className="flex flex-col gap-1.5 text-sm">
                                <span className="font-medium text-gray-700 dark:text-slate-300">Meta connection</span>
                                <select
                                    value={whConnectionId}
                                    onChange={(e) => setWhConnectionId(e.target.value)}
                                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                >
                                    {metaConnections.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1.5 text-sm">
                                <span className="font-medium text-gray-700 dark:text-slate-300">Ad account (optional)</span>
                                <select
                                    value={whAdAccountId}
                                    onChange={(e) => setWhAdAccountId(e.target.value)}
                                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                >
                                    <option value="">All accounts on connection</option>
                                    {adAccounts.map((a) => (
                                        <option key={a.id} value={a.id}>
                                            {a.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1.5 text-sm">
                                <span className="font-medium text-gray-700 dark:text-slate-300">From</span>
                                <input
                                    type="date"
                                    value={whSince}
                                    onChange={(e) => setWhSince(e.target.value)}
                                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                />
                            </label>
                            <label className="flex flex-col gap-1.5 text-sm">
                                <span className="font-medium text-gray-700 dark:text-slate-300">To</span>
                                <input
                                    type="date"
                                    value={whUntil}
                                    onChange={(e) => setWhUntil(e.target.value)}
                                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                />
                            </label>
                        </div>
                    )}

                    {metaConnections.length > 0 && activeWorkspaceId && (
                        <div className="mt-6 flex flex-wrap items-center gap-3">
                            <PrimaryButton
                                type="button"
                                onClick={handleWarehouseImport}
                                disabled={whImporting || !whConnectionId}
                                loading={whImporting}
                                className="rounded-xl px-6 py-3 text-base font-bold shadow-md shadow-cyan-500/20"
                            >
                                {whImporting ? (
                                    "Importing from Meta…"
                                ) : (
                                    <>
                                        <CloudDownload className="mr-2 inline h-4 w-4" />
                                        Import into warehouse &amp; load grid
                                    </>
                                )}
                            </PrimaryButton>
                        </div>
                    )}

                    {whError && (
                        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                            {whError}
                        </div>
                    )}
                    {whSuccess && (
                        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
                            {whSuccess}
                        </div>
                    )}
                </div>
            )}

            {tab === "warehouse" && showWhGrid && (
                <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/80">
                        <div className="flex items-center gap-3">
                            <div className="rounded bg-cyan-100 p-1.5 text-cyan-700">
                                <Database className="h-4 w-4" />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-gray-900 dark:text-white">Warehouse · Meta campaign metrics</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {whSince} → {whUntil} · connection{" "}
                                    <span className="font-mono">{whConnectionId.slice(0, 12)}…</span>
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={clearWarehouse}
                            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                        >
                            Back
                        </button>
                    </div>
                    <div className="min-h-[420px] flex-1 ag-theme-alpine w-full" key={whGridVersion}>
                        <AgGridReact
                            columnDefs={whGridHeaders}
                            rowModelType="infinite"
                            onGridReady={onWarehouseGridReady}
                            cacheBlockSize={100}
                            maxBlocksInCache={10}
                            rowSelection="multiple"
                            animateRows={true}
                            defaultColDef={{
                                flex: 1,
                                minWidth: 120,
                                filter: true,
                                floatingFilter: true,
                            }}
                        />
                    </div>
                </div>
            )}

            {tab === "csv" && !showCsvGrid && (
                <div className="group relative m-4 flex flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-gray-200 bg-white/40 p-8 text-center backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/40">
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-cyan-50/20 to-transparent" />

                    <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border-4 border-cyan-100 bg-cyan-50 transition-transform duration-500 group-hover:scale-110">
                        <UploadCloud className="h-10 w-10 text-cyan-500" />
                    </div>

                    <h3 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">Upload raw CSV</h3>
                    <p className="mb-8 max-w-md text-gray-500 dark:text-gray-500">
                        Stream large .csv files into the temporary Data Lake. Ideal for ad-hoc files; use the warehouse tab for connected Meta data.
                    </p>

                    <input
                        type="file"
                        accept=".csv"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                    />

                    {file && (
                        <div className="mb-8 flex min-w-[300px] items-center justify-between rounded-xl border border-cyan-100 bg-white p-4 shadow-sm animate-in zoom-in-95 dark:bg-slate-800">
                            <div className="flex items-center">
                                <Table className="mr-3 h-5 w-5 text-cyan-500" />
                                <div className="text-left">
                                    <p className="max-w-[200px] truncate text-sm font-semibold text-gray-900 dark:text-white">{file.name}</p>
                                    <p className="text-xs text-gray-500">
                                        {(file.size / (1024 * 1024)).toFixed(2)} MB · Ready
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {!activeWorkspaceId ? (
                        <p className="text-sm text-amber-700">Select a workspace from the sidebar.</p>
                    ) : !file ? (
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center rounded-xl bg-gray-900 px-6 py-3 font-medium text-white shadow-sm transition-colors hover:bg-black dark:bg-slate-800"
                        >
                            Select .csv file
                        </button>
                    ) : (
                        <div className="flex flex-col items-center">
                            <PrimaryButton
                                type="button"
                                onClick={handleUpload}
                                disabled={isUploading}
                                loading={isUploading}
                                className="rounded-xl px-6 py-3 text-base font-bold shadow-md shadow-cyan-500/20"
                            >
                                {isUploading ? (
                                    "Ingesting…"
                                ) : (
                                    <>
                                        Upload to Data Lake <ArrowRight className="ml-2 h-4 w-4" />
                                    </>
                                )}
                            </PrimaryButton>
                            {uploadError && (
                                <div className="mt-4 w-full max-w-md animate-in fade-in rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
                                    <p className="mb-1 font-semibold">Upload failed</p>
                                    <p className="opacity-90">{uploadError}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {tab === "csv" && showCsvGrid && (
                <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm animate-in fade-in zoom-in-95 duration-500 dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/80">
                        <div className="flex items-center space-x-3">
                            <div className="rounded bg-cyan-100 p-1.5 text-cyan-700">
                                <Database className="h-4 w-4" />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-gray-900 dark:text-white">Data Lake · CSV</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {datasetStats?.filename} · {datasetStats?.size}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={clearCsv}
                            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                        >
                            Clear
                        </button>
                    </div>
                    {csvGridHeaders.length > 0 ? (
                        <div className="min-h-[420px] flex-1 ag-theme-alpine w-full">
                            <AgGridReact
                                columnDefs={csvGridHeaders}
                                rowModelType="infinite"
                                onGridReady={onCsvGridReady}
                                cacheBlockSize={100}
                                maxBlocksInCache={10}
                                rowSelection="multiple"
                                animateRows={true}
                                defaultColDef={{
                                    flex: 1,
                                    minWidth: 150,
                                    filter: true,
                                    floatingFilter: true,
                                }}
                            />
                        </div>
                    ) : (
                        <div className="flex flex-1 items-center justify-center py-20">
                            <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
