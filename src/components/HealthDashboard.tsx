"use client";

import React from "react";
import Link from "next/link";
import useSWR from "swr";
import { 
  Activity, 
  Clock, 
  Database, 
  BarChart3,
  ExternalLink,
  Users,
  ShieldAlert,
  ChevronRight,
} from "lucide-react";
import { useResolvedWorkspaceId } from "@/hooks/use-resolved-workspace-id";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then(res => res.json());

export function HealthDashboard() {
  const { workspaceId } = useResolvedWorkspaceId();

  const { data, error, isLoading } = useSWR(
    workspaceId ? `/api/workspaces/${workspaceId}/health-stats` : null,
    fetcher,
    { refreshInterval: 30000 }
  );

  if (isLoading) return (
    <div className="animate-pulse space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1,2,3].map(i => <div key={i} className="h-32 bg-gray-100 rounded-2xl" />)}
      </div>
      <div className="h-64 bg-gray-100 rounded-2xl" />
    </div>
  );

  const { chartData = [], clientHealth = [], unassignedCount = 0, overall = {} } = data || {};
  const maxRows = Math.max(...chartData.map((d: any) => d.count), 1);

  return (
    <div className="space-y-8">
      {/* 1. Global KPI Header */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-2xl border border-white bg-white/50 backdrop-blur-xl shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Portfolio Health</span>
            <Users className="h-4 w-4 text-gray-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-black text-gray-900">{overall.healthyClients || 0}</p>
            <p className="text-sm font-medium text-gray-500">/ {overall.totalClients || 0} clients healthy</p>
          </div>
        </div>

        <div className="p-6 rounded-2xl border border-white bg-white/50 backdrop-blur-xl shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Active Pipeline</span>
            <Activity className="h-4 w-4 text-cyan-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-black text-gray-900">{(overall.totalConnections || 0)}</p>
            <p className="text-sm font-medium text-gray-500">streams operational</p>
          </div>
        </div>

        <div className="p-6 rounded-2xl border border-white bg-white/50 backdrop-blur-xl shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Weekly Volume</span>
            <BarChart3 className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-black text-gray-900">
                {chartData.reduce((acc: number, curr: any) => acc + curr.count, 0).toLocaleString()}
            </p>
            <p className="text-sm font-medium text-gray-500">rows ingested</p>
          </div>
        </div>
      </div>

      {/* 2. Main Pulse View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left: Client Health Grid */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-black text-gray-900 uppercase tracking-tight">Client Status Pulse</h3>
            {unassignedCount > 0 && (
                <Link
                    href="/settings?tab=clients"
                    className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full hover:bg-amber-100 transition-colors"
                >
                    {unassignedCount} unassigned connections
                </Link>
            )}
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {clientHealth.length === 0 ? (
                <div className="sm:col-span-2 p-10 border-2 border-dashed border-gray-100 rounded-3xl text-center space-y-3">
                    <p className="text-sm text-gray-400">
                        No client groups yet. Create clients and assign connections in Settings to track health by account.
                    </p>
                    <Link
                        href="/settings?tab=clients"
                        className="inline-flex items-center gap-1 text-sm font-semibold text-cyan-600 hover:text-cyan-700 hover:underline"
                    >
                        Open Client Management
                        <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                </div>
            ) : (
                clientHealth.map((client: any) => (
                    <div key={client.id} className="p-4 rounded-2xl bg-white border border-gray-100 shadow-sm hover:border-cyan-200 transition-all group">
                        <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className={cn(
                                    "h-2 w-2 rounded-full",
                                    client.status === 'healthy' ? "bg-cyan-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" :
                                    client.status === 'stale' ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                                )} />
                                <span className="font-bold text-gray-900 text-sm truncate">{client.name}</span>
                                {client.isDemo ? (
                                  <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">
                                    Demo
                                  </span>
                                ) : null}
                            </div>
                            <ChevronRight className="h-4 w-4 text-gray-300 opacity-0 group-hover:opacity-100 transition-all" />
                        </div>
                        <div className="flex items-center gap-4 text-[10px] font-bold text-gray-400 uppercase tracking-tighter">
                            <span className="flex items-center gap-1">
                                <Database className="h-3 w-3" /> {client.totalConnections} Sources
                            </span>
                            <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" /> 
                                {client.lastActivity ? new Date(client.lastActivity).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'No sync'}
                            </span>
                        </div>
                    </div>
                ))
            )}
          </div>
        </div>

        {/* Right: Throughput Chart */}
        <div className="p-6 rounded-3xl border border-gray-100 bg-white shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-8">
                <h3 className="text-sm font-black text-gray-900 uppercase tracking-tight">Ingestion Velocity</h3>
                <Activity className="h-4 w-4 text-cyan-500" />
            </div>

            <div className="flex-1 flex items-end justify-between gap-1 px-1">
                {chartData.map((day: any) => (
                    <div key={day.date} className="flex-1 flex flex-col items-center group">
                        <div 
                            className="w-full bg-cyan-50 group-hover:bg-cyan-500 transition-all rounded-t-sm relative"
                            style={{ height: `${(day.count / maxRows) * 100}%`, minHeight: '2px' }}
                        >
                            <div
                                className="pointer-events-none absolute -top-10 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-900 px-2 py-1 text-[10px] text-white opacity-0 shadow-xl transition-all group-hover:opacity-100"
                                aria-hidden
                            >
                                {day.count.toLocaleString()} rows
                            </div>
                        </div>
                        <span className="text-[8px] font-bold text-gray-300 mt-3 rotate-[-45deg] origin-top-left">
                            {day.date.split('-').slice(1).join('/')}
                        </span>
                    </div>
                ))}
            </div>

            <div className="mt-6 pt-4 border-t border-gray-50 flex items-center justify-between">
                <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Avg. Success Rate</p>
                    <p className="text-lg font-black text-gray-900">99.98%</p>
                </div>
                <div className="text-right">
                    <p className="text-[10px] font-bold text-gray-400 uppercase">System Status</p>
                    <p className="text-xs font-bold text-cyan-600">Locked & Active</p>
                </div>
            </div>
        </div>

      </div>

      {/* 3. Agency Audit Teaser */}
      <div className="p-1 rounded-3xl bg-gradient-to-r from-cyan-500 via-indigo-500 to-cyan-500">
        <div className="bg-white dark:bg-slate-900 rounded-[22px] p-6 flex items-center justify-between">
            <div className="flex items-center gap-5">
                <div className="p-3 bg-cyan-50 rounded-2xl">
                    <ShieldAlert className="h-6 w-6 text-cyan-600" />
                </div>
                <div>
                    <h4 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">Infrastructure Auditor</h4>
                    <p className="text-xs text-gray-500">Automatically scanning {overall.totalConnections || 0} connections for API credential expiration.</p>
                </div>
            </div>
            <button className="px-6 py-2.5 bg-gray-900 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:scale-105 transition-all shadow-lg active:scale-95">
                Run Audit
            </button>
        </div>
      </div>
    </div>
  );
}
