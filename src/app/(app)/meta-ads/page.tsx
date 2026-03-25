"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { ExportDropdown } from "@/components/ExportDropdown";
import { downloadCsv, downloadExcel } from "@/lib/export-utils";
import { RefreshCw, AlertCircle, Facebook, TrendingUp } from "lucide-react";
import { META_BREAKDOWN_OPTIONS, META_LEVEL_OPTIONS } from "@/lib/meta-ads";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const DATE_PRESETS = [
  { value: "last_7d", label: "Last 7 days" },
  { value: "last_14d", label: "Last 14 days" },
  { value: "last_30d", label: "Last 30 days" },
  { value: "last_month", label: "Last month" },
  { value: "this_month", label: "This month" },
  { value: "last_90d", label: "Last 90 days" },
];

const METRIC_OPTIONS = [
  { value: "spend", label: "Spend" },
  { value: "impressions", label: "Impressions" },
  { value: "reach", label: "Reach" },
  { value: "clicks", label: "Clicks" },
  { value: "cpm", label: "CPM" },
  { value: "cpc", label: "CPC" },
  { value: "ctr", label: "CTR" },
  { value: "frequency", label: "Frequency" },
  { value: "purchase_roas", label: "Purchase ROAS" },
  { value: "actions", label: "Actions" },
  { value: "action_values", label: "Action Values" },
  { value: "cost_per_action_type", label: "Cost per Action" },
];

const DEFAULT_FIELDS = [
  "campaign_name", "adset_name", "spend", "impressions",
  "clicks", "cpm", "cpc", "ctr", "purchase_roas", "date_start", "date_stop",
];

export default function MetaAdsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { data: workspaces } = useSWR("/api/workspaces", fetcher);

  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [selectedAdAccountId, setSelectedAdAccountId] = useState<string>("");
  const [level, setLevel] = useState("campaign");
  const [datePreset, setDatePreset] = useState("last_30d");
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(["spend", "impressions", "clicks", "ctr", "cpm", "purchase_roas"]);
  const [selectedBreakdowns, setSelectedBreakdowns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [asyncJobId, setAsyncJobId] = useState<string | null>(null);
  const [asyncPercent, setAsyncPercent] = useState(0);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Derive Meta Ads connections from workspace data
  const workspace = Array.isArray(workspaces)
    ? workspaces.find((w: any) => w.id === activeWorkspaceId) ?? workspaces[0]
    : null;

  const metaConnections: Array<{ id: string; name: string; credentials: string }> =
    (workspace?.connections ?? []).filter(
      (c: any) => c.provider === "meta_ads" && c.status === "connected"
    );

  // Auto-select first connection
  useEffect(() => {
    if (metaConnections.length && !selectedConnectionId) {
      const first = metaConnections[0];
      setSelectedConnectionId(first.id);
      try {
        const creds = JSON.parse(first.credentials);
        const firstAccount = creds.adAccountIds?.[0] ?? creds.adAccounts?.[0]?.id ?? "";
        setSelectedAdAccountId(firstAccount.replace("act_", ""));
      } catch {}
    }
  }, [metaConnections, selectedConnectionId]);

  // Get ad accounts for selected connection
  const selectedConn = metaConnections.find((c) => c.id === selectedConnectionId);
  const adAccounts: Array<{ id: string; name: string }> = selectedConn
    ? (() => {
        try {
          const creds = JSON.parse(selectedConn.credentials);
          return creds.adAccounts ?? (creds.adAccountIds ?? []).map((id: string) => ({ id, name: id }));
        } catch { return []; }
      })()
    : [];

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollStatus = (reportRunId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/meta-ads/report/${reportRunId}?connectionId=${selectedConnectionId}`
        );
        const data = await res.json();

        if (data.status === "COMPLETED") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setAsyncJobId(null);
          setRows(flattenRows(data.rows ?? []));
          setLastUpdated(new Date().toLocaleTimeString());
          setLoading(false);
        } else if (data.status === "FAILED") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setAsyncJobId(null);
          setError("Report job failed. Please try again.");
          setLoading(false);
        } else {
          setAsyncPercent(data.percent ?? 0);
        }
      } catch {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setError("Failed to poll report status.");
        setLoading(false);
      }
    }, 3000);
  };

  const runReport = async () => {
    if (!selectedConnectionId || !selectedAdAccountId) {
      setError("Please select a connection and ad account.");
      return;
    }

    if (pollRef.current) clearInterval(pollRef.current);
    setLoading(true);
    setError(null);
    setRows([]);
    setAsyncJobId(null);
    setAsyncPercent(0);

    const fields = [
      ...DEFAULT_FIELDS.filter((f) => !f.startsWith("spend") && !f.startsWith("impression")),
      ...selectedMetrics,
      "date_start",
      "date_stop",
    ];

    try {
      const res = await fetch("/api/meta-ads/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: selectedConnectionId,
          adAccountId: selectedAdAccountId,
          fields: [...new Set(fields)],
          level,
          datePreset,
          breakdowns: selectedBreakdowns,
          timeIncrement: 1,
          actionAttributionWindows: ["7d_click", "1d_view"],
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Report failed");

      if (data.mode === "async") {
        setAsyncJobId(data.report_run_id);
        pollStatus(data.report_run_id);
      } else {
        setRows(flattenRows(data.rows ?? []));
        setLastUpdated(new Date().toLocaleTimeString());
        setLoading(false);
      }
    } catch (err: any) {
      setError(err.message || "Failed to run report");
      setLoading(false);
    }
  };

  // Flatten Meta's nested action arrays into readable columns
  const flattenRows = (rawRows: Record<string, unknown>[]): Record<string, unknown>[] => {
    return rawRows.map((row) => {
      const flat: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(row)) {
        if (Array.isArray(val)) {
          // Action arrays — extract purchase values
          for (const action of val as Array<{ action_type?: string; value?: string }>) {
            if (action.action_type && action.value !== undefined) {
              flat[`${key}:${action.action_type}`] = action.value;
            }
          }
        } else {
          flat[key] = val;
        }
      }
      return flat;
    });
  };

  const allColumns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const hasConnection = metaConnections.length > 0;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center">
              <Facebook className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Meta Ads</h1>
          </div>
          <p className="text-sm text-gray-500">Campaign and ad set performance from Facebook & Instagram Ads</p>
        </div>
        {rows.length > 0 && (
          <ExportDropdown
            onCsv={() => downloadCsv(rows, "meta_ads_report")}
            onExcel={() => downloadExcel(rows, "meta_ads_report")}
          />
        )}
      </div>

      {/* No connection state */}
      {!hasConnection && (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center mx-auto mb-4">
            <Facebook className="w-6 h-6 text-blue-600" />
          </div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">
            Connect your Meta Ads account
          </h3>
          <p className="text-sm text-gray-500 mb-4 max-w-sm mx-auto">
            Link your Facebook Ads account to start pulling campaign and ad set performance data.
          </p>
          <a
            href="/dashboard"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-500 transition-colors"
          >
            Go to Connections
          </a>
        </div>
      )}

      {hasConnection && (
        <>
          {/* Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Connection selector */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Connection
              </label>
              <select
                value={selectedConnectionId}
                onChange={(e) => setSelectedConnectionId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {metaConnections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Ad Account selector */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Ad Account
              </label>
              <select
                value={selectedAdAccountId}
                onChange={(e) => setSelectedAdAccountId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {adAccounts.length === 0 && (
                  <option value="">No accounts found</option>
                )}
                {adAccounts.map((a: any) => (
                  <option key={a.id} value={a.id.replace("act_", "")}>
                    {a.name || a.id}
                  </option>
                ))}
              </select>
            </div>

            {/* Level */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Level
              </label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {META_LEVEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Date Preset */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Date Range
              </label>
              <select
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {DATE_PRESETS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Metrics + Breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Metrics
              </label>
              <div className="flex flex-wrap gap-2">
                {METRIC_OPTIONS.map((m) => (
                  <button
                    key={m.value}
                    onClick={() =>
                      setSelectedMetrics((prev) =>
                        prev.includes(m.value)
                          ? prev.filter((x) => x !== m.value)
                          : [...prev, m.value]
                      )
                    }
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                      selectedMetrics.includes(m.value)
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-blue-400"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Breakdowns <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {META_BREAKDOWN_OPTIONS.map((b) => (
                  <button
                    key={b.value}
                    onClick={() =>
                      setSelectedBreakdowns((prev) =>
                        prev.includes(b.value)
                          ? prev.filter((x) => x !== b.value)
                          : [...prev, b.value]
                      )
                    }
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                      selectedBreakdowns.includes(b.value)
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-blue-400"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Run button */}
          <div className="flex items-center gap-4">
            <button
              onClick={runReport}
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? (asyncJobId ? `Processing… ${asyncPercent}%` : "Fetching…") : "Run Report"}
            </button>
            {lastUpdated && (
              <span className="text-xs text-gray-400">Last updated: {lastUpdated}</span>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Results table */}
          {rows.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {rows.length.toLocaleString()} rows
                </span>
                <TrendingUp className="w-4 h-4 text-gray-400" />
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm divide-y divide-gray-100 dark:divide-gray-800">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      {allColumns.map((col) => (
                        <th
                          key={col}
                          className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap"
                        >
                          {col.replace(/_/g, " ")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                    {rows.slice(0, 500).map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        {allColumns.map((col) => (
                          <td
                            key={col}
                            className="px-4 py-2.5 text-gray-700 dark:text-gray-300 whitespace-nowrap text-xs"
                          >
                            {String(row[col] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 500 && (
                <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500">
                  Showing first 500 rows. Export to CSV/Excel for full dataset.
                </div>
              )}
            </div>
          )}

          {!loading && rows.length === 0 && !error && (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-10 text-center">
              <p className="text-sm text-gray-400">Select your options above and click Run Report to fetch data.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
