"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { Terminal, Database, ArrowRight, Plus, RefreshCw, Activity, CheckCircle2, CloudOff, Loader2, ArrowUpRight, ArrowDownRight, Clock } from "lucide-react";
import { ConnectSourceModal } from "@/components/ConnectSourceModal";
import useSWR, { mutate } from "swr";
import { useWorkspaceStore } from "@/store/workspace";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to fetch data');
    return data;
};

// Mock terminal logs to simulate live Bloomberg-esque data feed
const generateMockLogs = (count: number) => {
    const logs = [];
    const statuses = ['200 OK', '201 Created', '304 Not Modified', '500 Error'];
    const endpoints = ['/api/v2/orders/get', '/api/v2/shop/get_profile', '/api/v2/product/get_item_list'];
    for (let i = 0; i < count; i++) {
        const isError = Math.random() > 0.95;
        logs.push({
            id: `sys-log-${Math.floor(Math.random() * 1000000)}`,
            timestamp: new Date(Date.now() - Math.floor(Math.random() * 10000) * 1000).toISOString(),
            endpoint: endpoints[Math.floor(Math.random() * endpoints.length)],
            status: isError ? '500 Error' : statuses[Math.floor(Math.random() * 3)],
            rows: Math.floor(Math.random() * 500) + 1,
            latency: Math.floor(Math.random() * 800) + 40,
        });
    }
    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
};

export default function DashboardPage() {
    const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
    const [mockLogs, setMockLogs] = useState<any[]>([]);

    useEffect(() => {
        setMockLogs(generateMockLogs(25));
        
        // Simulate live feed updates
        const interval = setInterval(() => {
            setMockLogs(prev => {
                const newLog = generateMockLogs(1)[0];
                newLog.timestamp = new Date().toISOString();
                return [newLog, ...prev.slice(0, 24)];
            });
        }, 3500);
        return () => clearInterval(interval);
    }, []);

    // Global State
    const { activeWorkspaceId } = useWorkspaceStore();
    const { data: workspaces, error, isLoading } = useSWR("/api/workspaces", fetcher);

    // active connections mapped
    const activePipelineStats = useMemo(() => {
        if (!Array.isArray(workspaces) || !activeWorkspaceId) return [];
        const workspace = workspaces.find((w: any) => w.id === activeWorkspaceId) || workspaces[0];
        
        const connections = workspace?.connections?.filter((c: any) => c.type === 'source') || [];
        return connections.map((conn: any) => {
            const relatedPipeline = workspace?.pipelines?.find((p: any) => p.sourceConnectionId === conn.id);
            return {
                id: conn.id,
                name: conn.name,
                provider: conn.provider.toUpperCase(),
                status: conn.status === 'connected' ? 'LIVE' : 'ERR',
                lastSync: relatedPipeline?.lastSyncedAt ? new Date(relatedPipeline.lastSyncedAt).toLocaleTimeString() : '--:--:--',
                rowsSynced: Math.floor(Math.random() * 50000) + 1000, // mock metric
                health: Math.floor(Math.random() * 10) + 90, // mock metric
            };
        });
    }, [workspaces, activeWorkspaceId]);

    if (error) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-black text-red-500 font-mono p-8">
                <CloudOff className="w-12 h-12 mb-4 animate-pulse" />
                <h3 className="text-xl">SYS_ERR_FETCH_FAILED</h3>
                <p className="text-sm opacity-70 mt-2">Check network connection and reload protocol.</p>
            </div>
        );
    }

    return (
        <div className="h-[calc(100vh-64px)] w-full bg-[#050505] text-gray-300 font-mono flex flex-col overflow-hidden selection:bg-emerald-900 selection:text-emerald-100">
            
            {/* Top Toolbar */}
            <div className="flex-none h-14 border-b border-gray-800 flex items-center justify-between px-6 bg-[#0a0a0a]">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-emerald-500">
                        <Terminal className="w-4 h-4" />
                        <span className="text-xs font-bold tracking-widest">CMD_CENTER</span>
                    </div>
                    <div className="h-4 w-px bg-gray-800"></div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Database className="w-3 h-3" />
                        <span>WKS_{activeWorkspaceId?.substring(0,8) || 'LOADING'}</span>
                    </div>
                </div>
                
                <div className="flex items-center gap-4">
                    <div className="text-xs text-gray-500 tracking-widest flex items-center gap-2 mr-4 hidden sm:flex">
                        <Clock className="w-3 h-3" />
                        {new Date().toISOString().split('T')[0]} {new Date().toLocaleTimeString('en-US', { hour12: false })} UTC
                    </div>
                    <button 
                        onClick={() => mutate("/api/workspaces")}
                        className="p-1.5 text-gray-500 hover:text-emerald-400 hover:bg-gray-900 rounded transition-colors"
                        title="Force Refresh Data"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setIsSourceModalOpen(true)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-emerald-900/30 text-emerald-400 border border-emerald-900/50 hover:bg-emerald-900/50 rounded text-xs font-bold tracking-widest transition-colors"
                    >
                        <Plus className="w-3 h-3" />
                        NEW_PIPELINE
                    </button>
                </div>
            </div>

            {/* Main Split Pane Layout */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                
                {/* Left/Top Pane: Active Architecture & Metrics */}
                <div className="flex-1 lg:w-1/2 border-b lg:border-b-0 lg:border-r border-gray-800 flex flex-col bg-[#050505] overflow-y-auto">
                    <div className="p-4 border-b border-gray-800 bg-[#0a0a0a]/50 sticky top-0 z-10 backdrop-blur-md">
                        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Active Architecture</h2>
                    </div>
                    
                    <div className="p-6">
                        {isLoading ? (
                            <div className="flex items-center gap-3 text-emerald-500 text-sm">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>INITIALIZING_NODES...</span>
                            </div>
                        ) : activePipelineStats.length === 0 ? (
                            <div className="border border-dashed border-gray-800 rounded p-6 text-center text-gray-600 text-xs">
                                NO_ACTIVE_PIPELINES_FOUND<br/>
                                <button className="mt-2 text-emerald-500 hover:underline" onClick={() => setIsSourceModalOpen(true)}>Initialize First Node</button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {activePipelineStats.map((pipeline: any) => (
                                    <div key={pipeline.id} className="border border-gray-800 bg-[#0a0a0a] rounded flex flex-col overflow-hidden hover:border-gray-700 transition-colors">
                                        <div className="px-4 py-2 border-b border-gray-800 flex justify-between items-center bg-[#0d0d0d]">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-2 h-2 rounded-full ${pipeline.status === 'LIVE' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-red-500'}`}></div>
                                                <span className="text-xs font-bold text-white tracking-wider">{pipeline.provider}</span>
                                            </div>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${pipeline.status === 'LIVE' ? 'text-emerald-400 bg-emerald-900/30' : 'text-red-400 bg-red-900/30'}`}>
                                                {pipeline.status}
                                            </span>
                                        </div>
                                        <div className="p-4 grid grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Rows Synced</p>
                                                <p className="text-lg text-gray-200">{pipeline.rowsSynced.toLocaleString()}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Health Score</p>
                                                <p className="text-lg text-emerald-400 flex items-center gap-1">
                                                    {pipeline.health}%
                                                    <ArrowUpRight className="w-3 h-3" />
                                                </p>
                                            </div>
                                            <div className="col-span-2">
                                                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Last Auth Sync</p>
                                                <p className="text-xs text-gray-400">{pipeline.lastSync}</p>
                                            </div>
                                        </div>
                                        <div className="px-4 py-2 border-t border-gray-800 bg-[#0d0d0d] flex justify-between items-center text-[10px] text-gray-500 group cursor-pointer hover:bg-gray-900 transition-colors">
                                            <span>DESTINATION: BIGQUERY</span>
                                            <ArrowRight className="w-3 h-3 group-hover:text-emerald-400 transition-colors" />
                                        </div>
                                    </div>
                                ))}
                                
                                <button 
                                    onClick={() => setIsSourceModalOpen(true)}
                                    className="border border-dashed border-gray-800 bg-[#0a0a0a]/50 hover:bg-[#0a0a0a] hover:border-gray-700 rounded flex flex-col items-center justify-center text-gray-500 hover:text-emerald-400 transition-colors min-h-[160px]"
                                >
                                    <Plus className="w-6 h-6 mb-2" />
                                    <span className="text-[10px] font-bold tracking-widest uppercase">Add Node</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right/Bottom Pane: Dense Activity Tape / Logs */}
                <div className="flex-1 lg:w-1/2 flex flex-col bg-[#050505] overflow-hidden">
                    <div className="p-4 border-b border-gray-800 bg-[#0a0a0a]/50 flex justify-between items-center shrink-0">
                        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                            <Activity className="w-3 h-3" />
                            Live Terminal Feed
                        </h2>
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span className="text-[10px] text-emerald-500 tracking-widest">CONNECTED</span>
                        </div>
                    </div>
                    
                    <div className="flex-1 overflow-x-auto overflow-y-auto">
                        <table className="w-full text-left border-collapse whitespace-nowrap min-w-[600px]">
                            <thead className="sticky top-0 bg-[#0a0a0a] border-b border-gray-800 uppercase tracking-wider text-[10px] text-gray-500 z-10">
                                <tr>
                                    <th className="py-2 px-4 border-r border-gray-800/50">Timestamp UTC</th>
                                    <th className="py-2 px-4 border-r border-gray-800/50">Target Stream</th>
                                    <th className="py-2 px-4 border-r border-gray-800/50">Response</th>
                                    <th className="py-2 px-4 border-r border-gray-800/50 text-right">Rows</th>
                                    <th className="py-2 px-4 text-right">Latency</th>
                                </tr>
                            </thead>
                            <tbody className="text-xs divide-y divide-gray-800/30">
                                {mockLogs.map((log) => (
                                    <tr key={log.id} className="hover:bg-gray-900/50 transition-colors">
                                        <td className="py-2 px-4 border-r border-gray-800/50 text-gray-400 font-medium">
                                            {log.timestamp.split('T')[1].substring(0,12)}
                                        </td>
                                        <td className="py-2 px-4 border-r border-gray-800/50 text-emerald-500 font-medium">
                                            {log.endpoint}
                                        </td>
                                        <td className="py-2 px-4 border-r border-gray-800/50">
                                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                log.status.includes('200') || log.status.includes('201') ? 'text-emerald-400 bg-emerald-900/20' : 
                                                log.status.includes('304') ? 'text-gray-400 bg-gray-800/50' :
                                                'text-red-400 bg-red-900/20'
                                            }`}>
                                                {log.status}
                                            </span>
                                        </td>
                                        <td className="py-2 px-4 border-r border-gray-800/50 text-right text-gray-300">
                                            {log.status.includes('Error') ? 0 : log.rows}
                                        </td>
                                        <td className="py-2 px-4 text-right">
                                            <span className={`${log.latency > 600 ? 'text-amber-500' : 'text-gray-400'}`}>
                                                {log.latency}ms
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>

            <ConnectSourceModal
                isOpen={isSourceModalOpen}
                onClose={() => setIsSourceModalOpen(false)}
            />
        </div>
    );
}

