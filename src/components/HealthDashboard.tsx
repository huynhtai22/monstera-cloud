"use client";

import React from "react";
import useSWR from "swr";
import { 
  Activity, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Database, 
  BarChart3,
  ExternalLink,
  Users
} from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then(res => res.json());

export function HealthDashboard() {
  const { activeWorkspaceId } = useWorkspaceStore();
  
  const { data, error, isLoading } = useSWR(
    activeWorkspaceId ? `/api/workspaces/${activeWorkspaceId}/health-stats` : null,
    fetcher,
    { refreshInterval: 30000 } // Refresh every 30s
  );

  if (isLoading) return <div className="animate-pulse space-y-4">
    <div className="h-32 bg-gray-100 rounded-2xl" />
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="h-64 bg-gray-100 rounded-2xl" />
      <div className="h-64 bg-gray-100 rounded-2xl" />
    </div>
  </div>;

  if (error) return (
    <div className="p-6 border border-red-100 bg-red-50 rounded-2xl flex items-center gap-3 text-red-700">
      <AlertCircle className="h-5 w-5" />
      <span className="text-sm font-medium">Failed to load health metrics.</span>
    </div>
  );

  const { chartData = [], recentErrors = [], health = {} } = data || {};
  const maxRows = Math.max(...chartData.map((d: any) => d.count), 1);

  return (
    <div className="space-y-6">
      {/* 1. Health Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-5 rounded-2xl border border-white bg-white/50 backdrop-blur-xl shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">System Status</span>
            <div className={cn(
              "h-2.5 w-2.5 rounded-full animate-pulse",
              health.offline > 0 ? "bg-amber-500" : "bg-emerald-500"
            )} />
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {health.online} / {health.total}
          </p>
          <p className="text-xs text-gray-500 mt-1">Active Agency Connections</p>
        </div>

        <div className="p-5 rounded-2xl border border-white bg-white/50 backdrop-blur-xl shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Data Freshness</span>
            <Clock className="h-4 w-4 text-gray-400" />
          </div>
          <p className="text-2xl font-bold text-gray-900">99.8%</p>
          <p className="text-xs text-gray-500 mt-1">Avg. Sync Success Rate</p>
        </div>

        <div className="p-5 rounded-2xl border border-white bg-white/50 backdrop-blur-xl shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Total Throughput</span>
            <Activity className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {chartData.reduce((acc: number, curr: any) => acc + curr.count, 0).toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-1">Rows ingested (7d)</p>
        </div>
      </div>

      {/* 2. Visual Graphs & Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Data Throughput Chart (Pure CSS) */}
        <div className="p-6 rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-indigo-500" />
              <h3 className="text-sm font-bold text-gray-900">Ingestion Velocity</h3>
            </div>
            <span className="text-[10px] font-bold text-gray-400 uppercase">Last 7 Days</span>
          </div>
          
          <div className="flex items-end justify-between h-40 gap-2 px-2">
            {chartData.map((day: any) => (
              <div key={day.date} className="flex-1 flex flex-col items-center group">
                <div 
                  className="w-full bg-emerald-100 group-hover:bg-emerald-200 transition-all rounded-t-md relative"
                  style={{ height: `${(day.count / maxRows) * 100}%`, minHeight: '4px' }}
                >
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                    {day.count.toLocaleString()} rows
                  </div>
                </div>
                <span className="text-[9px] text-gray-400 mt-2 font-medium">
                  {day.date.split('-').slice(1).join('/')}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Actionable Error Feed */}
        <div className="p-6 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-bold text-gray-900">Critical Alerts</h3>
            </div>
            {recentErrors.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold">
                {recentErrors.length} issues
              </span>
            )}
          </div>

          <div className="space-y-4 flex-1">
            {recentErrors.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <CheckCircle2 className="h-8 w-8 text-emerald-100 mb-2" />
                <p className="text-xs text-gray-400">All clients healthy. No errors in last 24h.</p>
              </div>
            ) : (
              recentErrors.map((err: any) => (
                <div key={err.id} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100 hover:border-amber-200 transition-colors">
                  <div className="p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                    <Database className="h-3.5 w-3.5 text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between">
                      <p className="text-xs font-bold text-gray-900 truncate">{err.pipelineName}</p>
                      <span className="text-[10px] text-gray-400 font-medium">
                        {new Date(err.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-[11px] text-amber-700 mt-1 line-clamp-1">{err.message}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          
          <button className="mt-4 w-full py-2 text-[11px] font-bold text-gray-500 border-t border-gray-50 hover:text-gray-900 transition-colors flex items-center justify-center gap-2">
            View full Audit Log
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* 3. Agency "Client View" Teaser */}
      <div className="p-6 rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-white rounded-xl shadow-sm border border-gray-100">
            <Users className="h-6 w-6 text-gray-400" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-gray-900">Agency View: Multi-Client Grouping</h4>
            <p className="text-xs text-gray-500">You have 12 clients pending grouping. Organize pipelines to reduce management overhead.</p>
          </div>
        </div>
        <button className="px-4 py-2 bg-gray-900 text-white text-xs font-bold rounded-xl hover:bg-gray-800 transition-all shadow-sm">
          Set up Client Groups
        </button>
      </div>
    </div>
  );
}
