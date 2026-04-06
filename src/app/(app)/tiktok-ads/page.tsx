"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import Image from "next/image";
import { Loader2, Play, CheckCircle2, AlertCircle, RefreshCw, FlaskConical, Plus, Sparkles } from "lucide-react";
import { ExportDropdown } from "@/components/ExportDropdown";
import { downloadCsv, downloadExcel } from "@/lib/export-utils";
import useSWR, { mutate } from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { IntegrationPageLayout, inputFocus } from "@/components/ui/IntegrationPageLayout";
import { IntegrationSectionCard } from "@/components/ui/IntegrationSectionCard";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { SecondaryButton } from "@/components/ui/SecondaryButton";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const selectClass = cn(
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white",
  inputFocus
);

// ── Preset metrics / dimensions ──────────────────────────────────────────────
// TikTok only accepts ID + time dimensions. Name fields (campaign_name etc.)
// are returned automatically in the response alongside their ID dimension.
const DIMENSION_OPTIONS: Array<{ value: string; label: string; levels: string[] }> = [
  { value: "stat_time_day",  label: "Day",         levels: ["AUCTION_ADVERTISER","AUCTION_CAMPAIGN","AUCTION_ADGROUP","AUCTION_AD"] },
  { value: "campaign_id",   label: "Campaign ID",  levels: ["AUCTION_CAMPAIGN","AUCTION_ADGROUP","AUCTION_AD"] },
  { value: "adgroup_id",    label: "Ad Group ID",  levels: ["AUCTION_ADGROUP","AUCTION_AD"] },
  { value: "ad_id",         label: "Ad ID",        levels: ["AUCTION_AD"] },
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

/** Flatten TikTok's nested { dimensions, metrics } row format into plain objects. */
function flattenRows(
  rows: ReportRow[],
  columns: string[]
): Record<string, unknown>[] {
  return rows.map((r) => {
    const obj: Record<string, unknown> = {};
    for (const col of columns) {
      obj[col] = r.dimensions[col] ?? r.metrics[col] ?? "";
    }
    return obj;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TikTokAdsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { data: workspaces } = useSWR("/api/workspaces", fetcher);

  // Derive TikTok Business connections from current workspace
  const tiktokConnections: Array<{ id: string; name: string; advertiserIds: string[]; sandbox: boolean }> =
    React.useMemo(() => {
      if (!Array.isArray(workspaces) || !activeWorkspaceId) return [];
      const ws = workspaces.find((w: any) => w.id === activeWorkspaceId);
      return (ws?.connections || [])
        .filter((c: any) => c.provider === "tiktok_business" && c.status === "connected")
        .map((c: any) => {
          let advertiserIds: string[] = [];
          let sandbox = false;
          try {
            const creds = JSON.parse(c.credentials || "{}");
            advertiserIds = creds.advertiserIds ?? [];
            sandbox = creds.sandbox === true;
          } catch {}
          return { id: c.id, name: c.name, advertiserIds, sandbox };
        });
    }, [workspaces, activeWorkspaceId]);

  // Form state
  const [connectionId, setConnectionId] = useState("");
  const [advertiserId, setAdvertiserId] = useState("");
  const [dataLevel, setDataLevel] = useState("AUCTION_CAMPAIGN");

  // Valid dimensions for the currently selected data level
  const availableDims = DIMENSION_OPTIONS.filter((d) => d.levels.includes(dataLevel));
  const [startDate, setStartDate] = useState(daysAgo(7));
  const [endDate, setEndDate] = useState(today());
  const [selectedDims, setSelectedDims] = useState<string[]>(["stat_time_day", "campaign_id"]);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(["spend", "impressions", "clicks", "ctr", "conversion"]);

  // Task / result state
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>(null);
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  // Sandbox connect form
  const [showSandboxForm, setShowSandboxForm] = useState(false);
  const [sandboxToken, setSandboxToken] = useState("");
  const [sandboxAdvertiserId, setSandboxAdvertiserId] = useState("7620367281593548818");
  const [sandboxName, setSandboxName] = useState("Monstera SandBox");
  const [sandboxSaving, setSandboxSaving] = useState(false);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [sandboxSuccess, setSandboxSuccess] = useState<string | null>(null);

  // Sandbox seed state
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);

  // Polling interval ref — cleared on unmount to prevent memory leaks
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };
  }, []);

  const handleSeedData = async () => {
    if (!connectionId) { setSeedError("Select a connection first."); return; }
    setIsSeeding(true);
    setSeedResult(null);
    setSeedError(null);
    try {
      const res = await fetch("/api/tiktok-business/sandbox-seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Seed failed");
      const adv = data.advertiser as Record<string, string> | null;
      const advName = adv?.name ?? "account";
      if (data.campaign_id) {
        setSeedResult(`✅ Account verified (${advName}). Test campaign created (ID: ${data.campaign_id}). Wait 1–2 min then click Run Report.`);
      } else {
        setSeedResult(`✅ Account "${advName}" verified. ${data.warning ?? ""}`);
      }
    } catch (e: any) {
      setSeedError(e.message);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleSandboxConnect = async () => {
    if (!sandboxToken.trim()) {
      setSandboxError("Access token is required — click Generate in the TikTok portal.");
      return;
    }
    if (!sandboxAdvertiserId.trim()) {
      setSandboxError("Advertiser ID is required.");
      return;
    }
    setSandboxSaving(true);
    setSandboxError(null);
    try {
      // Resolve workspace: use active workspace or fall back to first in the list
      const wsId =
        activeWorkspaceId ||
        (Array.isArray(workspaces) && workspaces[0]?.id) ||
        undefined;

      const res = await fetch("/api/tiktok-business/sandbox-connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: sandboxToken.trim(),
          advertiserId: sandboxAdvertiserId.trim(),
          accountName: sandboxName || `TikTok Ads Sandbox (${sandboxAdvertiserId})`,
          workspaceId: wsId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save sandbox connection");
      // Refresh workspace data so the new connection appears in the dropdown
      mutate("/api/workspaces");
      setShowSandboxForm(false);
      setSandboxToken("");
      setSandboxSuccess(`Connected! "${data.name}" is ready. Select it in the dropdown below to run a report.`);
    } catch (e: any) {
      setSandboxError(e.message);
    } finally {
      setSandboxSaving(false);
    }
  };

  const toggleItem = (list: string[], setList: (v: string[]) => void, val: string) => {
    setList(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]);
  };

  const poll = useCallback(
    async (tid: string, connId: string, advId: string) => {
      setIsPolling(true);
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(
            `/api/tiktok-business/report/${tid}?connectionId=${connId}&advertiser_id=${advId}`
          );
          const data = await res.json();
          setTaskStatus(data.status);

          if (data.status === "COMPLETED") {
            setRows(data.rows ?? []);
            clearInterval(pollingIntervalRef.current!);
            pollingIntervalRef.current = null;
            setIsPolling(false);
          } else if (data.status === "FAILED") {
            setError("Report task failed on TikTok side. Try a smaller date range.");
            clearInterval(pollingIntervalRef.current!);
            pollingIntervalRef.current = null;
            setIsPolling(false);
          }
        } catch (e: any) {
          clearInterval(pollingIntervalRef.current!);
          pollingIntervalRef.current = null;
          setIsPolling(false);
          setError(e.message || "Polling interrupted. Please try again.");
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

      if (data.mode === "sync") {
        // Sandbox: rows returned immediately, no polling needed
        setTaskStatus("COMPLETED");
        setRows(data.rows ?? []);
      } else {
        // Production: async task, start polling
        setTaskId(data.task_id);
        setTaskStatus("INIT");
        poll(data.task_id, connectionId, advertiserId);
      }
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Build column list from actual data so name fields (campaign_name etc.)
  // that TikTok returns automatically are also shown
  const allColumns = React.useMemo(() => {
    if (!rows || rows.length === 0) return [...selectedDims, ...selectedMetrics];
    const dimKeys = Object.keys(rows[0].dimensions ?? {});
    const metricKeys = Object.keys(rows[0].metrics ?? {});
    return [...dimKeys, ...metricKeys];
  }, [rows, selectedDims, selectedMetrics]);


  return (
    <IntegrationPageLayout
      title="TikTok Ads Report"
      description="Pull async ad performance reports from TikTok Business API into your workspace."
      icon={<Image src="/logos/tiktok.svg" alt="TikTok" width={22} height={22} />}
      banner={
        tiktokConnections.length === 0 ? (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            No TikTok Business connection found. Connect via OAuth on the{" "}
            <a href="/console" className="font-semibold underline">Data Sources</a> page, or add a sandbox account in Connection below.
          </div>
        ) : null
      }
      leftColumn={
        <>
          <IntegrationSectionCard title="Connection">
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">TikTok Business Account</label>
            <select
              value={connectionId}
              onChange={(e) => {
                setConnectionId(e.target.value);
                const conn = tiktokConnections.find((c) => c.id === e.target.value);
                if (conn?.advertiserIds?.[0]) setAdvertiserId(conn.advertiserIds[0]);
              }}
              className={cn(selectClass, "mb-4")}
            >
              <option value="">Select connection…</option>
              {tiktokConnections.map((c) => (
                <option key={c.id} value={c.id}>{c.sandbox ? "🧪 " : ""}{c.name}</option>
              ))}
            </select>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Advertiser ID</label>
            {(tiktokConnections.find((c) => c.id === connectionId)?.advertiserIds?.length ?? 0) > 1 ? (
              <select value={advertiserId} onChange={(e) => setAdvertiserId(e.target.value)} className={selectClass}>
                <option value="">Select advertiser…</option>
                {tiktokConnections.find((c) => c.id === connectionId)?.advertiserIds.map((aid) => (
                  <option key={aid} value={aid}>{aid}</option>
                ))}
              </select>
            ) : (
              <input type="text" placeholder="Auto-filled on connect, or enter manually" value={advertiserId} onChange={(e) => setAdvertiserId(e.target.value)} className={selectClass} />
            )}
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Auto-filled from your TikTok Ads account on connect</p>
            <div className="mt-4 border-t border-gray-100 pt-4 dark:border-slate-700">
              <SecondaryButton type="button" className="w-full" onClick={() => setShowSandboxForm((v) => !v)}>
                <FlaskConical className="h-4 w-4" />
                {showSandboxForm ? "Hide sandbox setup" : "Connect Sandbox Ad Account"}
              </SecondaryButton>
            </div>
            {sandboxSuccess && (
              <div className="mt-3 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-700/50 dark:bg-emerald-900/20 dark:text-emerald-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span className="flex-1">{sandboxSuccess}</span>
                <button type="button" onClick={() => setSandboxSuccess(null)} className="text-xs text-emerald-600 hover:text-emerald-800">✕</button>
              </div>
            )}
            {showSandboxForm && (
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/80 p-4 dark:border-slate-600 dark:bg-slate-800/50">
                <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">Sandbox Ad Account Setup</h3>
                <p className="mb-3 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                  Go to{" "}
                  <a href="https://business-api.tiktok.com/portal/apps/7620309837959675921" target="_blank" rel="noopener noreferrer" className="font-semibold underline">business-api.tiktok.com → your app → Sandbox Ad Account</a>
                  , click <strong>Generate</strong> under Access Token, then paste it below.
                </p>
                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Account Name</label>
                    <input type="text" value={sandboxName} onChange={(e) => setSandboxName(e.target.value)} className={selectClass} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Advertiser ID</label>
                    <input type="text" value={sandboxAdvertiserId} onChange={(e) => setSandboxAdvertiserId(e.target.value)} className={selectClass} />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Access Token</label>
                  <input type="password" placeholder="Paste the generated token…" value={sandboxToken} onChange={(e) => setSandboxToken(e.target.value)} className={selectClass} />
                </div>
                {sandboxError && <p className="mb-2 flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><AlertCircle className="h-3 w-3" />{sandboxError}</p>}
                <SecondaryButton type="button" className="w-full" onClick={handleSandboxConnect} disabled={sandboxSaving}>
                  {sandboxSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {sandboxSaving ? "Saving…" : "Add Sandbox Connection"}
                </SecondaryButton>
              </div>
            )}
            {tiktokConnections.find((c) => c.id === connectionId)?.sandbox && (
              <div className="mt-4 border-t border-gray-100 pt-4 dark:border-slate-700">
                <p className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">Sandbox — no data yet? Seed a test campaign first.</p>
                <SecondaryButton type="button" onClick={handleSeedData} disabled={isSeeding}>
                  {isSeeding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {isSeeding ? "Creating…" : "Verify & Seed Test Data"}
                </SecondaryButton>
                {seedResult && <p className="mt-2 text-xs leading-relaxed text-emerald-700 dark:text-emerald-400">{seedResult}</p>}
                {seedError && <p className="mt-2 flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><AlertCircle className="h-3 w-3" />{seedError}</p>}
              </div>
            )}
          </IntegrationSectionCard>
          <IntegrationSectionCard title="Date range & level">
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Start</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={selectClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">End</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={selectClass} />
              </div>
            </div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Data Level</label>
            <select
              value={dataLevel}
              onChange={(e) => {
                const newLevel = e.target.value;
                setDataLevel(newLevel);
                const validForNew = DIMENSION_OPTIONS.filter((d) => d.levels.includes(newLevel)).map((d) => d.value);
                setSelectedDims((prev) => prev.filter((d) => validForNew.includes(d)));
              }}
              className={selectClass}
            >
              {DATA_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </IntegrationSectionCard>
          <IntegrationSectionCard title="Dimensions">
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">Available dimensions depend on the Data Level above.</p>
            <div className="mb-3 space-y-0.5 text-xs text-gray-400 dark:text-gray-500">
              <p>• <span className="font-medium text-gray-500">Ad Group ID</span> → switch to <em>Ad Group</em> level</p>
              <p>• <span className="font-medium text-gray-500">Ad ID</span> → switch to <em>Ad</em> level</p>
            </div>
            <div className="space-y-1.5">
              {availableDims.map((d) => (
                <label key={d.value} className="group flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={selectedDims.includes(d.value)} onChange={() => toggleItem(selectedDims, setSelectedDims, d.value)} className="h-4 w-4 rounded accent-emerald-600" />
                  <span className="text-sm text-gray-700 transition-colors group-hover:text-primary dark:text-gray-300">{d.label}</span>
                </label>
              ))}
            </div>
            {DIMENSION_OPTIONS.filter((d) => !d.levels.includes(dataLevel)).map((d) => (
              <div key={d.value} className="mt-1.5 flex cursor-not-allowed select-none items-center gap-2 opacity-35">
                <input type="checkbox" disabled className="h-4 w-4 rounded" />
                <span className="text-sm text-gray-400 line-through dark:text-gray-500">{d.label}</span>
                <span className="ml-auto text-[10px] text-gray-400">{d.value === "adgroup_id" ? "Ad Group level" : d.value === "ad_id" ? "Ad level" : ""}</span>
              </div>
            ))}
          </IntegrationSectionCard>
          <IntegrationSectionCard title="Metrics">
            <div className="space-y-1.5">
              {METRIC_OPTIONS.map((m) => (
                <label key={m.value} className="group flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={selectedMetrics.includes(m.value)} onChange={() => toggleItem(selectedMetrics, setSelectedMetrics, m.value)} className="h-4 w-4 rounded accent-emerald-600" />
                  <span className="text-sm text-gray-700 group-hover:text-primary dark:text-gray-300">{m.label}</span>
                </label>
              ))}
            </div>
          </IntegrationSectionCard>
        </>
      }
      primaryAction={
        <PrimaryButton className="w-full py-3" onClick={handleRun} disabled={isSubmitting || isPolling} loading={isSubmitting || isPolling}>
          {isSubmitting || isPolling ? (isSubmitting ? "Creating task…" : "Waiting for TikTok…") : (<><Play className="h-4 w-4" /> Run Report</>)}
        </PrimaryButton>
      }
      resultsHeader={
        <div className="flex w-full min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-sm font-semibold text-gray-800 dark:text-white">Results</span>
            {taskId && <span className="truncate font-mono text-xs text-gray-400 dark:text-gray-500">task: {taskId.slice(0, 14)}…</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {taskStatus && taskStatus !== "COMPLETED" && taskStatus !== "FAILED" && (
              <span className="flex items-center gap-1.5 rounded-full bg-primary-muted px-2.5 py-1 text-xs font-medium text-primary-hover dark:bg-emerald-950/40 dark:text-emerald-300">
                <Loader2 className="h-3 w-3 animate-spin" />{taskStatus}
              </span>
            )}
            {taskStatus === "COMPLETED" && (
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" /> Ready
              </span>
            )}
            {taskStatus === "FAILED" && (
              <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/20 dark:text-red-400">
                <AlertCircle className="h-3 w-3" /> Failed
              </span>
            )}
            {rows && rows.length > 0 && (
              <ExportDropdown
                onCsv={() => downloadCsv(flattenRows(rows, allColumns), `tiktok_ads_report_${today()}`)}
                onExcel={() => downloadExcel(flattenRows(rows, allColumns), `tiktok_ads_report_${today()}`)}
              />
            )}
          </div>
        </div>
      }
      results={
        <>
          {error && (
            <div className="m-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700/50 dark:bg-red-900/20 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
            </div>
          )}
          {!taskStatus && !error && (
            <div className="flex min-h-[280px] flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-slate-800">
                <RefreshCw className="h-5 w-5 text-gray-400 dark:text-gray-500" />
              </div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Configure your report and click <strong>Run Report</strong></p>
            </div>
          )}
          {(taskStatus === "INIT" || taskStatus === "RUNNING") && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">TikTok is generating your report…</p>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Usually takes 5–30 seconds. Polling every 3s.</p>
            </div>
          )}
          {rows && rows.length === 0 && taskStatus === "COMPLETED" && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">Report returned 0 rows for this date range.</p>
            </div>
          )}
          {rows && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-[600px] w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-gray-50/80 dark:bg-slate-800/80">
                  <tr>
                    {allColumns.map((col) => (
                      <th key={col} className="whitespace-nowrap border-b border-gray-100 px-4 py-3 font-semibold uppercase tracking-wider text-gray-600 dark:border-slate-700/60 dark:text-gray-300">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700/40">
                  {rows.map((row, i) => (
                    <tr key={i} className="transition-colors hover:bg-gray-50/60 dark:hover:bg-slate-800/40">
                      {allColumns.map((col) => (
                        <td key={col} className="whitespace-nowrap px-4 py-2.5 text-gray-700 dark:text-gray-300">{String(row.dimensions[col] ?? row.metrics[col] ?? "—")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-5 py-3 text-xs text-gray-400 dark:text-gray-500">{rows.length} rows returned</p>
            </div>
          )}
        </>
      }
    />
  );
}
