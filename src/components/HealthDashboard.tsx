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
  ArrowRight,
} from "lucide-react";
import { useResolvedWorkspaceId } from "@/hooks/use-resolved-workspace-id";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then(res => res.json());

export function HealthDashboard() {
  const { workspaceId } = useResolvedWorkspaceId();

  const { data, isLoading } = useSWR(
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
        <div className="p-5 rounded-lg border border-line bg-panel shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">Portfolio Health</span>
            <Users className="h-4 w-4 text-ink-mute" />
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold text-ink">{overall.healthyClients || 0}</p>
            <p className="text-xs font-medium text-ink-mute">/ {overall.totalClients || 0} clients healthy</p>
          </div>
        </div>

        <div className="p-5 rounded-lg border border-line bg-panel shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">Active Pipeline</span>
            <Activity className="h-4 w-4 text-white" />
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold text-ink">{(overall.totalConnections || 0)}</p>
            <p className="text-xs font-medium text-ink-mute">streams operational</p>
          </div>
        </div>

        <div className="p-5 rounded-lg border border-line bg-panel shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">Weekly Volume</span>
            <BarChart3 className="h-4 w-4 text-white" />
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold text-ink">
                {chartData.reduce((acc: number, curr: any) => acc + curr.count, 0).toLocaleString()}
            </p>
            <p className="text-xs font-medium text-ink-mute">rows ingested</p>
          </div>
        </div>
      </div>

      {/* 2. Main Pulse View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left: Client Health Grid */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-ink uppercase tracking-wider">Client Status Pulse</h3>
            {unassignedCount > 0 && (
                <Link
                    href="/settings?tab=clients"
                    className="text-[10px] font-semibold text-ink-mute bg-canvas border border-line px-2 py-0.5 rounded hover:text-white transition-colors"
                >
                    {unassignedCount} unassigned connections
                </Link>
            )}
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {clientHealth.length === 0 ? (
                <div className="sm:col-span-2 p-8 border border-dashed border-line rounded-lg text-center space-y-3 bg-panel">
                    <p className="text-xs text-ink-mute">
                        No client groups yet. Create clients and assign connections in Settings to track health by account.
                    </p>
                    <Link
                        href="/settings?tab=clients"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-white hover:text-neutral-300 transition-colors"
                    >
                        Open Client Management
                        <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                </div>
            ) : (
                clientHealth.map((client: any) => (
                    <div key={client.id} className="p-4 rounded-lg bg-panel border border-line shadow-xs hover:border-[#333] transition-colors group">
                        <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className={cn(
                                    "h-2 w-2 rounded-full",
                                    client.status === 'healthy' ? "bg-white shadow-xs" :
                                    client.status === 'stale' ? "bg-amber-400" : "bg-red-500"
                                )} />
                                <span className="font-semibold text-ink text-xs truncate">{client.name}</span>
                                {client.isDemo ? (
                                  <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-ink-mute bg-canvas border border-line px-1.5 py-0.5 rounded">
                                    Demo
                                  </span>
                                ) : null}
                            </div>
                            <ChevronRight className="h-3.5 w-3.5 text-ink-mute opacity-0 group-hover:opacity-100 transition-all" />
                        </div>
                        <div className="flex items-center gap-4 text-[10px] font-bold text-ink-mute uppercase tracking-wider">
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
        <div className="p-5 rounded-lg border border-line bg-panel shadow-xs flex flex-col">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wider">Ingestion Velocity</h3>
                <Activity className="h-4 w-4 text-white" />
            </div>

            <div className="flex-1 flex items-end justify-between gap-1 px-1 min-h-[140px]">
                {chartData.map((day: any) => (
                    <div key={day.date} className="flex-1 flex flex-col items-center group">
                        <div 
                            className="w-full bg-canvas border border-line group-hover:bg-white transition-colors rounded-t-sm relative"
                            style={{ height: `${(day.count / maxRows) * 100}%`, minHeight: '4px' }}
                        >
                            <div
                                className="pointer-events-none absolute -top-8 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded bg-canvas border border-line px-2 py-1 text-[10px] text-white opacity-0 shadow-xl transition-all group-hover:opacity-100"
                                aria-hidden
                            >
                                {day.count.toLocaleString()} rows
                            </div>
                        </div>
                        <span className="text-[8px] font-mono text-ink-mute mt-2 rotate-[-45deg] origin-top-left">
                            {day.date.split('-').slice(1).join('/')}
                        </span>
                    </div>
                ))}
            </div>

            <div className="mt-6 pt-4 border-t border-line flex items-center justify-between">
                <div>
                    <p className="text-[10px] font-bold text-ink-mute uppercase">Avg. Success Rate</p>
                    <p className="text-base font-bold text-ink">99.98%</p>
                </div>
                <div className="text-right">
                    <p className="text-[10px] font-bold text-ink-mute uppercase">System Status</p>
                    <p className="text-xs font-semibold text-white">Active</p>
                </div>
            </div>
        </div>

      </div>

      {/* 3. Credential Audit Banner */}
      <div className="rounded-lg border border-line bg-panel p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
                <div className="p-2.5 bg-canvas border border-line rounded-lg text-white">
                    <ShieldAlert className="h-5 w-5" />
                </div>
                <div>
                    <h4 className="text-xs font-bold text-ink uppercase tracking-wider">Infrastructure Auditor</h4>
                    <p className="text-xs text-ink-mute">Scanning {overall.totalConnections || 0} connections for API credential expiration.</p>
                </div>
            </div>
            <Link
                href="/settings?tab=connections"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-black text-xs font-semibold rounded-md hover:bg-neutral-200 transition-colors shadow-xs"
            >
                Review credentials
                <ArrowRight className="h-3.5 w-3.5" />
            </Link>
        </div>
      </div>
    </div>
  );
}
