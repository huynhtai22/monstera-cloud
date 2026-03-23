"use client";

import React, { useState, useCallback } from "react";
import Image from "next/image";
import { Loader2, Play, CheckCircle2, AlertCircle, Download, RefreshCw } from "lucide-react";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ── Preset metrics / dimensions ──────────────────────────────────────────────
const DIMENSION_OPTIONS = [
  { value: "stat_time_day", label: "Day" },
  { value: "campaign_id", label: "Campaign ID" },
  { value: "campaign_name", label: "Campaign Name" },
  { value: "adgroup_id", label: "Ad Group ID" },
  { value: "adgroup_name", label: "Ad Group Name" },
  { value: "ad_id", label: "Ad ID" },
  { value: "ad_name", label: "Ad Name" },
];

const METRIC_OPTIONS = [
  { value: "spend", label: "Spend" },
  { value: "impressions", label: "Impressions" },
  { value: "clicks", label: "Clicks" },
  { value: "ctr", label: "CTR (%)" },
  { value: "cpm", label: "CPM" },
  { value: "cpc", label: "CPC" },
  { value: "conversion", label: "Conversions" },
  { value: "cost_per_conversion", label: "Cost / Conversion" },
  { value: "conversion_rate", label: "Conv. Rate (%)" },
  { value: "real_time_conversion", label: "Real-time Conversions" },
  { value: "video_play_actions", label: "Video Plays" },
  { value: "video_watched_2s", label: "2s Views" },
  { value: "video_watched_6s", label: "6s Views" },
  { value: "reach", label: "Reach" },
];

const DATA_LEVELS = [
  { value: "AUCTION_ADVERTISER", label: "Account" },
  { value: "AUCTION_CAMPAIGN", label: "Campaign" },
  { value: "AUCTION_ADGROUP", label: "Ad Group" },
  { value: "AUCTION_AD", label: "Ad" },
];

type TaskStatus = "INIT" | "RUNNING" | "COMPLETED" | "FAILED" | null;

interface ReportRow {
  dimensions: Record<string, string | number>;
  metrics: Record<string, string | number>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function exportCsv(rows: ReportRow[], dims: string[], metrics: string[]) {
  const headers = [...dims, ...metrics];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const v = r.dimensions[h] ?? r.metrics[h] ?? "";
          return `"${String(v).replace(/"/g, '""')}"`;
        })
        .join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tiktok_ads_report_${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TikTokAdsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { data: workspaces } = useSWR("/api/workspaces", fetcher);

  // Derive TikTok Business connections from current workspace
  const tiktokConnections: Array<{ id: string; name: string }> = React.useMemo(() => {
    if (!Array.isArray(workspaces) || !activeWorkspaceId) return [];
    const ws = workspaces.find((w: any) => w.id === activeWorkspaceId);
    return (ws?.connections || []).filter(
      (c: any) => c.provider === "tiktok_business" && c.status === "connected"
    );
  }, [workspaces, activeWorkspaceId]);

  // Form state
  const [connectionId, setConnectionId] = useState("");
  const [advertiserId, setAdvertiserId] = useState("");
  const [dataLevel, setDataLevel] = useState("AUCTION_CAMPAIGN");
  const [startDate, setStartDate] = useState(daysAgo(7));
  const [endDate, setEndDate] = useState(today());
  const [selectedDims, setSelectedDims] = useState<string[]>(["stat_time_day", "campaign_name"]);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(["spend", "impressions", "clicks", "ctr", "conversion"]);

  // Task / result state
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>(null);
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  const toggleItem = (list: string[], setList: (v: string[]) => void, val: string) => {
    setList(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]);
  };

  const poll = useCallback(
    async (tid: string, connId: string, advId: string) => {
      setIsPolling(true);
      const interval = setInterval(async () => {
        try {
          const res = await fetch(
            `/api/tiktok-business/report/${tid}?connectionId=${connId}&advertiser_id=${advId}`
          );
          const data = await res.json();
          setTaskStatus(data.status);

          if (data.status === "COMPLETED") {
            setRows(data.rows ?? []);
            clearInterval(interval);
            setIsPolling(false);
          } else if (data.status === "FAILED") {
            setError("Report task failed on TikTok side. Try a smaller date range.");
            clearInterval(interval);
            setIsPolling(false);
          }
        } catch {
          clearInterval(interval);
          setIsPolling(false);
        }
      }, 3000);
    },
    []
  );

  const handleRun = async () => {
    if (!connectionId || !advertiserId) {
      setError("Select a connection and enter an Advertiser ID.");
      return;
    }
    if (selectedDims.length === 0 || selectedMetrics.length === 0) {
      setError("Select at least one dimension and one metric.");
      return;
    }

    setError(null);
    setRows(null);
    setTaskId(null);
    setTaskStatus(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/tiktok-business/report/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          advertiser_id: advertiserId,
          report_type: "BASIC",
          data_level: dataLevel,
          dimensions: selectedDims,
          metrics: selectedMetrics,
          start_date: startDate,
          end_date: endDate,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create task");

      setTaskId(data.task_id);
      setTaskStatus("INIT");
      poll(data.task_id, connectionId, advertiserId);
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  };

  const allColumns = [...selectedDims, ...selectedMetrics];

  return (
    <div className="relative max-w-7xl mx-auto px-6 py-10 w-full animate-in fade-in duration-300">
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-0 right-[10%] w-[40%] h-[40%] rounded-full bg-pink-200/20 dark:bg-pink-900/20 blur-[120px]" />
        <div className="absolute bottom-[10%] left-0 w-[40%] h-[50%] rounded-full bg-emerald-200/20 dark:bg-emerald-900/20 blur-[120px]" />
      </div>

      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-white/50 dark:bg-slate-900/50 border border-white dark:border-slate-700/60 flex items-center justify-center shadow-sm">
          <Image src="/logos/tiktok.svg" alt="TikTok" width={22} height={22} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">
            TikTok Ads Report
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Pull async ad performance reports from TikTok Business API into your workspace.
          </p>
        </div>
      </div>

      {/* No connections notice */}
      {tiktokConnections.length === 0 && (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 text-amber-800 dark:text-amber-300 text-sm font-medium">
          <AlertCircle className="w-4 h-4 shrink-0" />
          No TikTok Business connection found. Go to{" "}
          <a href="/dashboard" className="underline font-semibold">Data Sources</a>{" "}
          and connect TikTok Business first.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: config panel ── */}
        <div className="lg:col-span-1 space-y-5">

          {/* Connection */}
          <div className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl border border-white dark:border-slate-700/60 rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">Connection</h2>

            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">TikTok Business Account</label>
            <select
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="">Select connection…</option>
              {tiktokConnections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <label className="block text-xs text-gray-500 dark:text-gray-400 mt-4 mb-1 font-medium">Advertiser ID</label>
            <input
              type="text"
              placeholder="e.g. 7123456789012345"
              value={advertiserId}
              onChange={(e) => setAdvertiserId(e.target.value)}
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Find in TikTok Ads Manager → Account info
            </p>
          </div>

          {/* Date & Level */}
          <div className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl border border-white dark:border-slate-700/60 rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">Date Range &amp; Level</h2>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">Start</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">End</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
              </div>
            </div>

            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">Data Level</label>
            <select value={dataLevel} onChange={(e) => setDataLevel(e.target.value)}
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30">
              {DATA_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          {/* Dimensions */}
          <div className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl border border-white dark:border-slate-700/60 rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Dimensions</h2>
            <div className="space-y-1.5">
              {DIMENSION_OPTIONS.map((d) => (
                <label key={d.value} className="flex items-center gap-2 cursor-pointer group">
                  <input type="checkbox" checked={selectedDims.includes(d.value)}
                    onChange={() => toggleItem(selectedDims, setSelectedDims, d.value)}
                    className="w-4 h-4 rounded accent-emerald-500" />
                  <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{d.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Metrics */}
          <div className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl border border-white dark:border-slate-700/60 rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Metrics</h2>
            <div className="space-y-1.5">
              {METRIC_OPTIONS.map((m) => (
                <label key={m.value} className="flex items-center gap-2 cursor-pointer group">
                  <input type="checkbox" checked={selectedMetrics.includes(m.value)}
                    onChange={() => toggleItem(selectedMetrics, setSelectedMetrics, m.value)}
                    className="w-4 h-4 rounded accent-emerald-500" />
                  <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{m.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Run button */}
          <button
            onClick={handleRun}
            disabled={isSubmitting || isPolling}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting || isPolling ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> {isSubmitting ? "Creating task…" : "Waiting for TikTok…"}</>
            ) : (
              <><Play className="w-4 h-4" /> Run Report</>
            )}
          </button>
        </div>

        {/* ── Right: results panel ── */}
        <div className="lg:col-span-2">
          <div className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl border border-white dark:border-slate-700/60 rounded-2xl shadow-sm overflow-hidden h-full min-h-[420px] flex flex-col">

            {/* Panel header */}
            <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-700/60 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-800 dark:text-white">Results</span>
                {taskId && (
                  <span className="text-xs font-mono text-gray-400 dark:text-gray-500">task: {taskId.slice(0, 14)}…</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {taskStatus && taskStatus !== "COMPLETED" && taskStatus !== "FAILED" && (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-2.5 py-1 rounded-full">
                    <Loader2 className="w-3 h-3 animate-spin" /> {taskStatus}
                  </span>
                )}
                {taskStatus === "COMPLETED" && (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 rounded-full">
                    <CheckCircle2 className="w-3 h-3" /> Ready
                  </span>
                )}
                {taskStatus === "FAILED" && (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 dark:bg-red-900/20 px-2.5 py-1 rounded-full">
                    <AlertCircle className="w-3 h-3" /> Failed
                  </span>
                )}
                {rows && rows.length > 0 && (
                  <button
                    onClick={() => exportCsv(rows, selectedDims, selectedMetrics)}
                    className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-2.5 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    <Download className="w-3 h-3" /> Export CSV
                  </button>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
              {error && (
                <div className="m-5 flex items-start gap-3 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-300 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {!taskStatus && !error && (
                <div className="flex flex-col items-center justify-center h-full py-20 text-center">
                  <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                    <RefreshCw className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                  </div>
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    Configure your report and click <strong>Run Report</strong>
                  </p>
                </div>
              )}

              {(taskStatus === "INIT" || taskStatus === "RUNNING") && (
                <div className="flex flex-col items-center justify-center h-full py-20 text-center">
                  <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-4" />
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                    TikTok is generating your report…
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Usually takes 5–30 seconds. Polling every 3s.
                  </p>
                </div>
              )}

              {rows && rows.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full py-20 text-center">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Report returned 0 rows for this date range.
                  </p>
                </div>
              )}

              {rows && rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs min-w-[600px]">
                    <thead className="bg-gray-50/80 dark:bg-slate-800/80 sticky top-0">
                      <tr>
                        {allColumns.map((col) => (
                          <th key={col} className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap border-b border-gray-100 dark:border-slate-700/60">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700/40">
                      {rows.map((row, i) => (
                        <tr key={i} className="hover:bg-gray-50/60 dark:hover:bg-slate-800/40 transition-colors">
                          {allColumns.map((col) => (
                            <td key={col} className="px-4 py-2.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                              {String(row.dimensions[col] ?? row.metrics[col] ?? "—")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-gray-400 dark:text-gray-500 px-5 py-3">
                    {rows.length} rows returned
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
