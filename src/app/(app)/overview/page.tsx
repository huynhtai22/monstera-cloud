"use client";

import React from 'react';
import Image from 'next/image';
import { LayoutDashboard, ArrowUpRight, Activity, Database, CheckCircle2, Clock, AlertCircle, Loader2 } from "lucide-react";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch data');
    }
    return data;
};

// Mock Data for the chart
const syncData = [
    { day: 'Mon', count: 120, height: '40%' },
    { day: 'Tue', count: 340, height: '65%' },
    { day: 'Wed', count: 520, height: '85%' },
    { day: 'Thu', count: 480, height: '75%' },
    { day: 'Fri', count: 850, height: '100%' },
    { day: 'Sat', count: 210, height: '50%' },
    { day: 'Sun', count: 390, height: '70%' },
];

export default function OverviewDashboard() {
    const { activeWorkspaceId } = useWorkspaceStore();
    const { data: pipelines, error, isLoading } = useSWR(
        activeWorkspaceId ? `/api/pipelines?workspaceId=${activeWorkspaceId}` : null,
        fetcher
    );

    const activePipelinesCount = Array.isArray(pipelines) ? pipelines.length : 0;

    // Simulate some row count logic based on recent sync logs for demonstration
    const totalRowsSynced = Array.isArray(pipelines) ? pipelines.reduce((sum: number, p: any) => sum + (p.logs?.[0]?.rowsSynced || 0), 0) : 0;

    return (
        <div className="relative max-w-7xl mx-auto px-8 py-10 w-full animate-in fade-in duration-300">
            {/* Liquid Glass Background Effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-[-10%] left-[10%] w-[50%] h-[50%] rounded-full bg-emerald-200/20 dark:bg-emerald-900/20 blur-[120px]" />
                <div className="absolute top-[30%] right-[0%] w-[40%] h-[60%] rounded-full bg-blue-200/20 dark:bg-blue-900/20 blur-[120px]" />
            </div>

            {/* Header Section */}
            <div className="mb-10 flex flex-col sm:flex-row sm:items-end justify-between space-y-4 sm:space-y-0 relative z-10">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white mb-2">Platform Overview</h1>
                    <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-lg max-w-2xl">
                        Monitor your workspace health, recent pipeline activity, and total data throughput.
                    </p>
                </div>
                <div className="flex items-center space-x-3">
                    <span className="flex items-center text-sm font-medium text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2 animate-pulse"></span>
                        All Systems Operational
                    </span>
                </div>
            </div>

            {/* Top Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 relative z-10">
                {/* Stat 1 */}
                <div className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all group overflow-hidden relative">
                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-gradient-to-br from-emerald-100 to-transparent rounded-full opacity-50 blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
                    <div className="flex items-start justify-between mb-4">
                        <div className="p-2.5 bg-white dark:bg-slate-800 rounded-xl shadow-sm text-gray-700 dark:text-slate-300 border border-gray-100 dark:border-slate-700">
                            <Database className="w-5 h-5" />
                        </div>
                        <span className="flex items-center text-emerald-600 text-sm font-semibold bg-emerald-50/50 px-2 py-1 rounded-md">
                            <ArrowUpRight className="w-3 h-3 mr-1" />
                            12.5%
                        </span>
                    </div>
                    <div>
                        <h3 className="text-gray-500 dark:text-gray-400 dark:text-gray-500 font-medium text-sm mb-1">Rows Synced Today</h3>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">{totalRowsSynced > 0 ? totalRowsSynced : '1.2M'}</p>
                    </div>
                </div>

                {/* Stat 2 */}
                <div className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all group overflow-hidden relative">
                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-gradient-to-br from-blue-100 to-transparent rounded-full opacity-50 blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
                    <div className="flex items-start justify-between mb-4">
                        <div className="p-2.5 bg-white dark:bg-slate-800 rounded-xl shadow-sm text-gray-700 dark:text-slate-300 border border-gray-100 dark:border-slate-700">
                            <Activity className="w-5 h-5" />
                        </div>
                        <span className="flex items-center text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm font-semibold bg-gray-50 dark:bg-slate-800 px-2 py-1 rounded-md border border-gray-100 dark:border-slate-700">
                            No Change
                        </span>
                    </div>
                    <div>
                        <h3 className="text-gray-500 dark:text-gray-400 dark:text-gray-500 font-medium text-sm mb-1">Active Pipelines</h3>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
                            {isLoading ? '...' : activePipelinesCount}
                            <span className="text-lg text-gray-400 dark:text-gray-500 font-normal"> connected</span>
                        </p>
                    </div>
                </div>

                {/* Stat 3 */}
                <div className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all group overflow-hidden relative">
                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-gradient-to-br from-indigo-100 to-transparent rounded-full opacity-50 blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
                    <div className="flex items-start justify-between mb-4">
                        <div className="p-2.5 bg-white dark:bg-slate-800 rounded-xl shadow-sm text-gray-700 dark:text-slate-300 border border-gray-100 dark:border-slate-700">
                            <LayoutDashboard className="w-5 h-5" />
                        </div>
                        <span className="flex items-center text-emerald-600 text-sm font-semibold bg-emerald-50/50 px-2 py-1 rounded-md">
                            <ArrowUpRight className="w-3 h-3 mr-1" />
                            1 Template
                        </span>
                    </div>
                    <div>
                        <h3 className="text-gray-500 dark:text-gray-400 dark:text-gray-500 font-medium text-sm mb-1">Deployed Dashboards</h3>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">3</p>
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 relative z-10">

                {/* Sync Volume Chart (Mocked with beautiful CSS) */}
                <div className="lg:col-span-2 bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-2xl p-6 shadow-sm flex flex-col">
                    <div className="flex justify-between items-end mb-8">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Sync Volume (7 Days)</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">Row throughput across all active pipelines.</p>
                        </div>
                        <div className="text-right">
                            <p className="text-2xl font-bold text-indigo-600">2,910</p>
                            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Avg daily rows</p>
                        </div>
                    </div>

                    <div className="flex-1 min-h-[200px] flex items-end justify-between space-x-2 pt-10 border-b border-gray-200 dark:border-slate-700/50 pb-2 relative">
                        {/* Horizontal Grid lines */}
                        <div className="absolute top-0 w-full border-t border-gray-200 dark:border-slate-700/50 border-dashed"></div>
                        <div className="absolute top-1/2 w-full border-t border-gray-200 dark:border-slate-700/50 border-dashed"></div>

                        {/* Bars */}
                        {syncData.map((data, i) => (
                            <div key={i} className="flex flex-col items-center w-full group cursor-pointer h-full justify-end relative z-10">
                                {/* Tooltip mock */}
                                <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900 dark:bg-slate-800 text-white text-xs py-1 px-2 rounded font-medium shadow-xl pointer-events-none">
                                    {data.count} rows
                                </div>
                                <div
                                    className="w-full max-w-[48px] bg-gradient-to-t from-indigo-500 to-indigo-400 rounded-t-sm opacity-80 group-hover:opacity-100 group-hover:from-emerald-500 group-hover:to-emerald-400 transition-all duration-300 shadow-[0_0_15px_rgba(99,102,241,0.2)]"
                                    style={{ height: data.height }}
                                ></div>
                            </div>
                        ))}
                    </div>
                    {/* X Axis Labels */}
                    <div className="flex justify-between items-center pt-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">
                        {syncData.map((data, i) => (
                            <div key={i} className="w-full text-center">{data.day}</div>
                        ))}
                    </div>
                </div>

                {/* Recent Activity Feed */}
                <div className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-2xl p-6 shadow-sm flex flex-col h-[400px]">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Recent Activity</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 mb-6 border-b border-gray-100 dark:border-slate-700 pb-4">Latest events from your pipelines.</p>

                    <div className="flex-1 overflow-y-auto pr-2 space-y-5">
                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center h-full text-center py-10">
                                <Loader2 className="w-6 h-6 text-emerald-500 animate-spin mb-3" />
                                <span className="text-sm text-gray-500">Loading activity...</span>
                            </div>
                        ) : error ? (
                            <div className="flex flex-col items-center justify-center h-full text-center flex-1 py-10 text-red-500">
                                <AlertCircle className="w-6 h-6 mb-2" />
                                <span className="text-sm">Failed to load activity feed.</span>
                            </div>
                        ) : Array.isArray(pipelines) && pipelines.length > 0 ? (
                            pipelines.map((pipeline: any, index: number) => {
                                const isLast = index === pipelines.length - 1;
                                const isError = pipeline.status === 'error';
                                const latestLog = pipeline.logs?.[0];

                                return (
                                    <div key={pipeline.id} className={`flex items-start space-x-3 ${isLast ? 'opacity-80' : ''}`}>
                                        <div className="relative mt-1 shrink-0">
                                            <div className={`w-2.5 h-2.5 rounded-full ${isError ? 'bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.1)]' : 'bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.1)]'}`}></div>
                                            {!isLast && <div className="absolute top-4 bottom-[-16px] left-[5px] w-[1px] bg-gray-200 dark:bg-slate-700"></div>}
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-gray-900 dark:text-white">
                                                {pipeline.name} {isError ? 'Failed' : 'Synced'}
                                            </p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">
                                                {isError
                                                    ? `Error connecting ${pipeline.sourceConnection?.name} to ${pipeline.destinationConnection?.name}.`
                                                    : latestLog
                                                        ? `Successfully synced ${latestLog.rowsSynced} rows to ${pipeline.destinationConnection?.name}.`
                                                        : `Pipeline established: ${pipeline.sourceConnection?.name} → ${pipeline.destinationConnection?.name}`
                                                }
                                            </p>
                                            <div className="flex items-center text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 mt-1">
                                                <Clock className="w-3 h-3 mr-1" />
                                                {new Date(pipeline.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-center flex-1 py-10">
                                <span className="text-sm text-gray-500 dark:text-gray-400">No recent pipeline activity found.</span>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
