"use client";

import React, { useState, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { IDatasource, IGetRowsParams, GridReadyEvent, ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

// Register AG Grid modules to prevent #272 error
ModuleRegistry.registerModules([AllCommunityModule]);

import { UploadCloud, Database, Loader2, ArrowRight, Table, Download } from 'lucide-react';
import { useWorkspaceStore } from "@/store/workspace";

export default function DataExplorerPage() {
    const { activeWorkspaceId } = useWorkspaceStore();

    // UI State
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [datasetId, setDatasetId] = useState<string | null>(null);
    const [datasetStats, setDatasetStats] = useState<{ filename: string, size: string } | null>(null);
    const [gridHeaders, setGridHeaders] = useState<{ field: string }[]>([]);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- 1. File Upload Logic ---
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
        formData.append('file', file);
        formData.append('workspaceId', activeWorkspaceId);

        try {
            const res = await fetch('/api/data-explorer/upload', {
                method: 'POST',
                body: formData,
            });

            if (res.ok) {
                const data = await res.json();
                setDatasetId(data.datasetId);
                setDatasetStats({ filename: data.filename, size: data.size });

                // Fetch the first row just to get the columns for AG Grid initialization
                const headRes = await fetch(`/api/data-explorer/query?datasetId=${data.datasetId}&startRow=0&endRow=1`);
                if (headRes.ok) {
                    const headData = await headRes.json();
                    if (headData.columns) {
                        setGridHeaders(headData.columns.map((col: string) => ({
                            field: col,
                            sortable: true,
                            filter: true,
                            resizable: true
                        })));
                    }
                } else {
                    const errorData = await headRes.json().catch(() => ({}));
                    setUploadError(errorData.error || `Failed to read dataset: ${headRes.status}`);
                    setDatasetId(null); // Revert back to upload screen to show error
                }
            } else {
                const errorData = await res.json().catch(() => ({}));
                setUploadError(errorData.error || `Upload failed with status: ${res.status}`);
            }
        } catch (error: any) {
            console.error("Network error during upload:", error);
            setUploadError(error.message || "A network error occurred.");
        } finally {
            setIsUploading(false);
        }
    };

    // --- 2. AG Grid Infinite Scroll Logic ---
    const onGridReady = useCallback((params: GridReadyEvent) => {
        if (!datasetId) return;

        const dataSource: IDatasource = {
            getRows: async (params: IGetRowsParams) => {
                try {
                    // Fetch specifically the chunk AG Grid is looking for right now
                    const response = await fetch(
                        `/api/data-explorer/query?datasetId=${datasetId}&startRow=${params.startRow}&endRow=${params.endRow}`
                    );
                    const data = await response.json();

                    if (data.rows) {
                        // Tell AG Grid here are the rows, and here is the last row if we found the end of the file
                        params.successCallback(data.rows, data.lastRow);
                    } else {
                        params.failCallback();
                    }
                } catch (error) {
                    console.error("Error fetching rows:", error);
                    params.failCallback();
                }
            }
        };

        params.api.setGridOption('datasource', dataSource);
    }, [datasetId]);

    return (
        <div className="relative max-w-7xl mx-auto px-8 py-10 w-full animate-in fade-in duration-300 flex flex-col h-[calc(100vh-80px)]">
            {/* Header */}
            <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between space-y-4 sm:space-y-0 relative z-10 shrink-0">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white mb-2">Data Explorer</h1>
                    <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-base max-w-2xl">
                        Upload massive raw datasets directly into the temporary Data Lake. Our virtualized grid handles 500,000+ rows directly in your browser without crashing.
                    </p>
                </div>
                {datasetId && (
                    <div className="flex space-x-3">
                        <button
                            onClick={() => { setDatasetId(null); setFile(null); }}
                            className="flex items-center space-x-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-gray-50 dark:bg-slate-800 transition-colors shadow-sm"
                        >
                            <span>Clear Data Lake</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Main Content Area */}
            {!datasetId ? (
                // Upload Zone
                <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-2xl bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl m-4 p-8 text-center relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-b from-emerald-50/20 to-transparent pointer-events-none" />

                    <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-6 border-4 border-emerald-100 group-hover:scale-110 transition-transform duration-500">
                        <UploadCloud className="w-10 h-10 text-emerald-500" />
                    </div>

                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Upload Raw Data</h3>
                    <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 max-w-md mb-8">
                        Select a massively large .csv file (e.g. 100,000+ rows). We'll stream it into the Data Lake and load only the visible chunks.
                    </p>

                    <input
                        type="file"
                        accept=".csv"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                    />

                    {file && (
                        <div className="mb-8 p-4 bg-white dark:bg-slate-800 border border-emerald-100 rounded-xl flex items-center justify-between min-w-[300px] shadow-sm animate-in zoom-in-95">
                            <div className="flex items-center">
                                <Table className="w-5 h-5 text-emerald-500 mr-3" />
                                <div className="text-left">
                                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[200px]">{file.name}</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">{(file.size / (1024 * 1024)).toFixed(2)} MB • Ready for ingestion</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {!file ? (
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="px-6 py-3 bg-gray-900 dark:bg-slate-800 text-white font-medium rounded-xl hover:bg-black transition-colors shadow-sm flex items-center"
                        >
                            Select .csv File
                        </button>
                    ) : (
                        <div className="flex flex-col items-center">
                            <button
                                onClick={handleUpload}
                                disabled={isUploading}
                                className="px-6 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-70 flex items-center shadow-md shadow-emerald-500/20"
                            >
                                {isUploading ? (
                                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Ingesting to Lake...</>
                                ) : (
                                    <>Explode Data <ArrowRight className="w-4 h-4 ml-2" /></>
                                )}
                            </button>
                            {uploadError && (
                                <div className="mt-4 p-3 bg-red-50 text-red-600 border border-red-100 rounded-lg text-sm max-w-md w-full animate-in fade-in">
                                    <p className="font-semibold mb-1">Upload Failed</p>
                                    <p className="opacity-90">{uploadError}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ) : (
                // AG Grid Virtualized Viewer
                <div className="flex-1 flex flex-col bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm animate-in fade-in zoom-in-95 duration-500">

                    {/* Active Dataset Bar */}
                    <div className="bg-gray-50 dark:bg-slate-800/80 border-b border-gray-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between shrink-0">
                        <div className="flex items-center space-x-3">
                            <div className="p-1.5 bg-emerald-100 rounded text-emerald-700"><Database className="w-4 h-4" /></div>
                            <div>
                                <p className="text-sm font-bold text-gray-900 dark:text-white">Active Datalake Node</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 flex items-center">
                                    {datasetStats?.filename} <span className="mx-1">•</span> {datasetStats?.size} <span className="mx-1">•</span> Virtualized DOM
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded border border-emerald-100 shadow-sm">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>
                            Live Connection
                        </div>
                    </div>

                    {/* The Grid Component */}
                    {gridHeaders.length > 0 ? (
                        <div className="flex-1 w-full ag-theme-alpine">
                            <AgGridReact
                                columnDefs={gridHeaders}
                                rowModelType="infinite"
                                onGridReady={onGridReady}
                                cacheBlockSize={100} // Fetch 100 rows per request
                                maxBlocksInCache={10} // Keep 10 pages in memory (1000 rows max in memory)
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
                        <div className="flex-1 flex items-center justify-center">
                            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
