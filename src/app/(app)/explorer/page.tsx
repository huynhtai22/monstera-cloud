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
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight text-ink">Data explorer</h1>
                    <p className="mt-1 max-w-2xl text-sm text-ink-mute">
                        Query warehouse campaign metrics. Import from connected sources when you need a fresh range.
                    </p>
                </div>
                <div className="flex gap-1 rounded-md border border-line p-0.5">
                    <button
                        type="button"
                        onClick={() => setTab("warehouse")}
                        className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${
                            tab === "warehouse" ? "bg-white/[0.06] text-ink" : "text-ink-mute hover:text-ink"
                        }`}
                    >
                        <Database className="h-3.5 w-3.5" strokeWidth={1.5} />
                        Warehouse
                    </button>
                    <button
                        type="button"
                        onClick={() => setTab("csv")}
                        className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${
                            tab === "csv" ? "bg-white/[0.06] text-ink" : "text-ink-mute hover:text-ink"
                        }`}
                    >
                        <UploadCloud className="h-3.5 w-3.5" strokeWidth={1.5} />
                        CSV
                    </button>
                </div>
            </div>

            {tab === "warehouse" && <WarehouseWorkbench />}

            {tab === "csv" && !showCsvGrid && (
                <div className="group relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-line bg-panel p-8 text-center">
                    <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-md border border-line bg-canvas">
                        <UploadCloud className="h-6 w-6 text-ink" strokeWidth={1.5} />
                    </div>

                    <h3 className="mb-2 text-xl font-semibold text-ink">Upload raw CSV</h3>
                    <p className="mb-8 max-w-md text-sm text-ink-mute">
                        Stream large .csv files into the temporary data lake — ideal for ad-hoc extracts. Use the warehouse tab for synced ad
                        platform metrics stored in CampaignMetric.
                    </p>

                    <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileChange} />

                    {file && (
                        <div className="mb-8 flex min-w-[300px] items-center justify-between rounded-lg border border-line bg-canvas p-4 shadow-xs">
                            <div className="flex items-center">
                                <Table className="mr-3 h-4 w-4 text-white" />
                                <div className="text-left">
                                    <p className="max-w-[220px] truncate text-xs font-semibold text-ink">{file.name}</p>
                                    <p className="text-[11px] text-ink-mute">
                                        {(file.size / (1024 * 1024)).toFixed(2)} MB · ready
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {!activeWorkspaceId ? (
                        <p className="text-xs text-amber-400">Select a workspace from the sidebar.</p>
                    ) : !file ? (
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center rounded-md bg-white px-5 py-2.5 text-xs font-semibold text-black shadow-xs transition-colors hover:bg-neutral-200"
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
                                className="rounded-md px-6 py-2.5 text-xs font-semibold shadow-xs"
                            >
                                {isUploading ? (
                                    "Ingesting…"
                                ) : (
                                    <>
                                        Upload to data lake <ArrowRight className="ml-2 h-3.5 w-3.5" />
                                    </>
                                )}
                            </PrimaryButton>
                            {uploadError && (
                                <div className="mt-4 w-full max-w-md rounded-md border border-red-900/60 bg-red-950/40 p-3 text-xs text-red-200">
                                    <p className="mb-1 font-semibold">Upload failed</p>
                                    <p className="opacity-90">{uploadError}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {tab === "csv" && showCsvGrid && (
                <div className="flex min-h-[480px] flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-xs">
                    <div className="flex shrink-0 items-center justify-between border-b border-line bg-canvas px-4 py-3">
                        <div className="flex items-center space-x-3">
                            <div className="rounded-md bg-panel border border-line p-1.5 text-white">
                                <Database className="h-4 w-4" />
                            </div>
                            <div>
                                <p className="text-xs font-bold text-ink">Data lake · CSV</p>
                                <p className="text-[11px] text-ink-mute">
                                    {datasetStats?.filename} · {datasetStats?.size}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={clearCsv}
                            className="rounded-md border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/[0.06]"
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
                            <Loader2 className="h-8 w-8 animate-spin text-white" />
                        </div>
                    )}
                </div>
            )}
        </PageShell>
    );
}
