"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { ExportDropdown } from "@/components/ExportDropdown";
import { downloadCsv, downloadExcel } from "@/lib/export-utils";
import { RefreshCw, AlertCircle, TrendingUp, ShoppingCart, BarChart3 } from "lucide-react";
import { GOOGLE_DATE_PERIODS, GOOGLE_REPORT_TYPES } from "@/lib/google-ads";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function GoogleAdsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { data: workspaces } = useSWR("/api/workspaces", fetcher);

  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [reportType, setReportType] = useState("campaign");
  const [datePeriod, setDatePeriod] = useState("LAST_30_DAYS");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Derive Google Ads connections from workspace
  const workspace = Array.isArray(workspaces)
    ? workspaces.find((w: any) => w.id === activeWorkspaceId) ?? workspaces[0]
    : null;

  const googleConnections: Array<{ id: string; name: string; credentials: string }> =
    (workspace?.connections ?? []).filter(
      (c: any) => c.provider === "google_ads" && c.status === "connected"
    );

  // Auto-select first connection and customer
  useEffect(() => {
    if (googleConnections.length && !selectedConnectionId) {
      const first = googleConnections[0];
      setSelectedConnectionId(first.id);
      try {
        const creds = JSON.parse(first.credentials);
        setSelectedCustomerId(creds.customerIds?.[0] ?? "");
      } catch {}
    }
  }, [googleConnections, selectedConnectionId]);

  // Get customer IDs for selected connection
  const selectedConn = googleConnections.find((c) => c.id === selectedConnectionId);
  const customerIds: string[] = selectedConn
    ? (() => {
        try {
          return JSON.parse(selectedConn.credentials).customerIds ?? [];
        } catch { return []; }
      })()
    : [];

  const runReport = async () => {
    if (!selectedConnectionId || !selectedCustomerId) {
      setError("Please select a connection and customer account.");
      return;
    }

    setLoading(true);
    setError(null);
    setRows([]);

    try {
      const res = await fetch("/api/google-ads/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: selectedConnectionId,
          customerId: selectedCustomerId,
          reportType,
          datePeriod,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Report failed");

      setRows((data.rows ?? []) as Record<string, unknown>[]);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err.message || "Failed to run report");
    } finally {
      setLoading(false);
    }
  };

  const allColumns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const hasConnection = googleConnections.length > 0;

  const ReportIcon = reportType === "shopping" ? ShoppingCart : reportType === "adgroup" ? BarChart3 : TrendingUp;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded bg-red-500 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-white">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Google Ads</h1>
          </div>
          <p className="text-sm text-gray-500">
            Campaign, ad group, and Shopping performance from Google Ads
          </p>
        </div>
        {rows.length > 0 && (
          <ExportDropdown
            onCsv={() => downloadCsv(rows, "google_ads_report")}
            onExcel={() => downloadExcel(rows, "google_ads_report")}
          />
        )}
      </div>

      {/* No connection state */}
      {!hasConnection && (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center mx-auto mb-4">
            <TrendingUp className="w-6 h-6 text-red-500" />
          </div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">
            Connect your Google Ads account
          </h3>
          <p className="text-sm text-gray-500 mb-4 max-w-sm mx-auto">
            Link your Google Ads account to start pulling campaign and Shopping performance data.
            Requires a Google Ads Developer Token.
          </p>
          <a
            href="/dashboard"
            className="inline-flex items-center px-4 py-2 bg-red-500 text-white text-sm font-semibold rounded-lg hover:bg-red-400 transition-colors"
          >
            Go to Connections
          </a>
        </div>
      )}

      {hasConnection && (
        <>
          {/* Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Connection */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Connection
              </label>
              <select
                value={selectedConnectionId}
                onChange={(e) => setSelectedConnectionId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
              >
                {googleConnections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Customer ID */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Account (Customer ID)
              </label>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
              >
                {customerIds.length === 0 && (
                  <option value="">No accounts found</option>
                )}
                {customerIds.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </div>

            {/* Report type */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Report Type
              </label>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
              >
                {GOOGLE_REPORT_TYPES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            {/* Date period */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Date Period
              </label>
              <select
                value={datePeriod}
                onChange={(e) => setDatePeriod(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
              >
                {GOOGLE_DATE_PERIODS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Report type info */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <ReportIcon className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
            <p className="text-xs text-gray-500">
              {reportType === "campaign" && "Campaign-level: impressions, clicks, cost, conversions, CTR, search impression share. Cost is automatically converted from micros."}
              {reportType === "adgroup" && "Ad group-level: performance breakdown by ad group within each campaign."}
              {reportType === "shopping" && "Product-level Shopping data: ROAS by product, title, clicks, conversions. Great for identifying top-performing SKUs."}
            </p>
          </div>

          {/* Run button */}
          <div className="flex items-center gap-4">
            <button
              onClick={runReport}
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-500 text-white text-sm font-semibold rounded-lg hover:bg-red-400 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Fetching…" : "Run Report"}
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
                <ReportIcon className="w-4 h-4 text-gray-400" />
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
                            {typeof row[col] === "number"
                              ? Number(row[col]).toLocaleString(undefined, { maximumFractionDigits: 4 })
                              : String(row[col] ?? "—")}
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
              <p className="text-sm text-gray-400">
                Select your report type and date period above, then click Run Report.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
