"use client";

import React, { useState, useRef, useCallback } from "react";
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

import { UploadCloud, Database, Loader2, ArrowRight, Table } from "lucide-react";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useWorkspaceStore } from "@/store/workspace";
import { PageShell } from "@/components/ui/PageShell";
import { WarehouseWorkbench } from "@/components/data-explorer/WarehouseWorkbench";

type ExplorerTab = "warehouse" | "csv";

export default function DataExplorerPage() {
    const { activeWorkspaceId } = useWorkspaceStore();

    const [tab, setTab] = useState<ExplorerTab>("warehouse");

    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [datasetId, setDatasetId] = useState<string | null>(null);
    const [datasetStats, setDatasetStats] = useState<{ filename: string; size: string } | null>(null);
    const [csvGridHeaders, setCsvGridHeaders] = useState<{ field: string }[]>([]);

    const fileInputRef = useRef<HTMLInputElement>(null);

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

    const clearCsv = () => {
        setDatasetId(null);
        setFile(null);
        setCsvGridHeaders([]);
        setDatasetStats(null);
    };

    const showCsvGrid = tab === "csv" && datasetId && csvGridHeaders.length > 0;

    return (
        <PageShell className="max-w-7xl">
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/50 bg-gradient-to-br from-cyan-500/20 to-white text-cyan-700 shadow-sm dark:border-cyan-900/40 dark:from-cyan-900/30 dark:to-slate-900 dark:text-cyan-300">
                        <Database className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                            Data explorer
                        </h1>
                        <p className="mt-2 max-w-2xl text-base text-gray-600 dark:text-slate-400">
                            Import from connected ad platforms into the workspace warehouse (Meta, Google Ads, TikTok), query stored campaign
                            metrics, or upload temporary CSV datasets for quick analysis.
                        </p>
                    </div>
                </div>
            </div>

            <div className="mb-8 flex shrink-0 flex-wrap gap-2 border-b border-gray-200/80 pb-4 dark:border-slate-700/80">
                <button
                    type="button"
                    onClick={() => setTab("warehouse")}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                        tab === "warehouse"
                            ? "bg-cyan-600 text-white shadow-md shadow-cyan-500/25"
                            : "border border-gray-200 bg-white/80 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-200 dark:hover:bg-slate-800"
                    }`}
                >
                    <Database className="h-4 w-4" />
                    Warehouse &amp; metrics
                </button>
                <button
                    type="button"
                    onClick={() => setTab("csv")}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                        tab === "csv"
                            ? "bg-cyan-600 text-white shadow-md shadow-cyan-500/25"
                            : "border border-gray-200 bg-white/80 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-200 dark:hover:bg-slate-800"
                    }`}
                >
                    <UploadCloud className="h-4 w-4" />
                    CSV upload
                </button>
            </div>

            {tab === "warehouse" && <WarehouseWorkbench />}

            {tab === "csv" && !showCsvGrid && (
                <div className="group relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-gray-200/90 bg-white/50 p-8 text-center backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/40">
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-cyan-500/10 to-transparent" />

                    <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border-4 border-cyan-100 bg-cyan-50 transition-transform duration-500 group-hover:scale-105 dark:border-cyan-900/60 dark:bg-cyan-950/40">
                        <UploadCloud className="h-10 w-10 text-cyan-500" />
                    </div>

                    <h3 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">Upload raw CSV</h3>
                    <p className="mb-8 max-w-md text-sm text-gray-500 dark:text-slate-400">
                        Stream large .csv files into the temporary data lake — ideal for ad-hoc extracts. Use the warehouse tab for synced ad
                        platform metrics stored in CampaignMetric.
                    </p>

                    <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileChange} />

                    {file && (
                        <div className="mb-8 flex min-w-[300px] items-center justify-between rounded-xl border border-cyan-100 bg-white p-4 shadow-sm dark:bg-slate-800">
                            <div className="flex items-center">
                                <Table className="mr-3 h-5 w-5 text-cyan-500" />
                                <div className="text-left">
                                    <p className="max-w-[220px] truncate text-sm font-semibold text-gray-900 dark:text-white">{file.name}</p>
                                    <p className="text-xs text-gray-500">
                                        {(file.size / (1024 * 1024)).toFixed(2)} MB · ready
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {!activeWorkspaceId ? (
                        <p className="text-sm text-amber-700 dark:text-amber-400">Select a workspace from the sidebar.</p>
                    ) : !file ? (
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-black dark:bg-slate-800"
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
                                        Upload to data lake <ArrowRight className="ml-2 h-4 w-4" />
                                    </>
                                )}
                            </PrimaryButton>
                            {uploadError && (
                                <div className="mt-4 w-full max-w-md rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                                    <p className="mb-1 font-semibold">Upload failed</p>
                                    <p className="opacity-90">{uploadError}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {tab === "csv" && showCsvGrid && (
                <div className="flex min-h-[480px] flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white/80 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
                    <div className="flex shrink-0 items-center justify-between border-b border-gray-200/80 bg-gray-50/90 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
                        <div className="flex items-center space-x-3">
                            <div className="rounded-lg bg-cyan-100 p-1.5 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300">
                                <Database className="h-4 w-4" />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-gray-900 dark:text-white">Data lake · CSV</p>
                                <p className="text-xs text-gray-500 dark:text-slate-400">
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
        </PageShell>
    );
}
