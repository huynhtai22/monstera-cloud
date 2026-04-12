"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { ExportDropdown } from "@/components/ExportDropdown";
import { downloadCsv, downloadExcel } from "@/lib/export-utils";
import { RefreshCw, AlertCircle, Facebook, TrendingUp } from "lucide-react";
import { META_BREAKDOWN_OPTIONS, META_LEVEL_OPTIONS } from "@/lib/meta-ads";
import { IntegrationPageLayout, inputFocus } from "@/components/ui/IntegrationPageLayout";
import { IntegrationSectionCard } from "@/components/ui/IntegrationSectionCard";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { cn } from "@/lib/utils";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";

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

const selectClass = cn(
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white",
  inputFocus
);

const chip = (on: boolean) =>
  cn(
    "rounded border px-2.5 py-1 text-xs font-medium transition-colors",
    on
      ? "border-primary bg-primary text-white"
      : "border-gray-200 bg-white text-gray-600 hover:border-primary-ring/50 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-300"
  );

export default function MetaAdsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { data: workspaces } = useSWR("/api/workspaces", fetcher);

  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [selectedAdAccountId, setSelectedAdAccountId] = useState<string>("");
  const [level, setLevel] = useState("campaign");
  const [datePreset, setDatePreset] = useState("last_30d");
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([
    "spend", "impressions", "clicks", "ctr", "cpm", "purchase_roas",
  ]);
  const [selectedBreakdowns, setSelectedBreakdowns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [asyncJobId, setAsyncJobId] = useState<string | null>(null);
  const [asyncPercent, setAsyncPercent] = useState(0);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const workspace = Array.isArray(workspaces)
    ? workspaces.find((w: any) => w.id === activeWorkspaceId) ?? workspaces[0]
    : null;

  const metaConnections: Array<{ id: string; name: string; credentials: string }> =
    (workspace?.connections ?? []).filter(
      (c: any) => c.provider === "meta_ads" && c.status === "connected"
    );

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

  const selectedConn = metaConnections.find((c) => c.id === selectedConnectionId);
  const adAccounts: Array<{ id: string; name: string }> = selectedConn
    ? (() => {
        try {
          const creds = JSON.parse(selectedConn.credentials);
          return creds.adAccounts ?? (creds.adAccountIds ?? []).map((id: string) => ({ id, name: id }));
        } catch {
          return [];
        }
      })()
    : [];

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

  const flattenRows = (rawRows: Record<string, unknown>[]): Record<string, unknown>[] => {
    return rawRows.map((row) => {
      const flat: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(row)) {
        if (Array.isArray(val)) {
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

  const primaryLinkClass = cn(
    "inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold text-white",
    "bg-primary hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-ring/40",
    "transition-colors"
  );

  const resultsHeader = (
    <>
      <span className="text-sm font-semibold text-gray-800 dark:text-white">
        Results
        {lastUpdated && (
          <span className="ml-2 text-xs font-normal text-gray-400">
            · Updated {lastUpdated}
          </span>
        )}
      </span>
      {rows.length > 0 && (
        <ExportDropdown
          onCsv={() => downloadCsv(rows, "meta_ads_report")}
          onExcel={() => downloadExcel(rows, "meta_ads_report")}
        />
      )}
    </>
  );

  const resultsBody = (
    <>
      {error && (
        <div className="m-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <RefreshCw className="mb-3 h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
            {asyncJobId ? `Processing… ${asyncPercent}%` : "Fetching…"}
          </p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="border-t border-gray-100 dark:border-slate-700/60">
          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/80">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {rows.length.toLocaleString()} rows
            </span>
            <TrendingUp className="h-4 w-4 text-gray-400" />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  {allColumns.map((col) => (
                    <th
                      key={col}
                      className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
                    >
                      {col.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {rows.slice(0, 500).map((row, i) => (
                  <tr key={i} className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    {allColumns.map((col) => (
                      <td key={col} className="whitespace-nowrap px-4 py-2.5 text-xs text-gray-700 dark:text-gray-300">
                        {String(row[col] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 500 && (
            <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800">
              Showing first 500 rows. Export to CSV/Excel for full dataset.
            </div>
          )}
        </div>
      )}

      {!loading && rows.length === 0 && !error && hasConnection && (
        <div className="flex min-h-[280px] flex-col items-center justify-center px-6 py-16 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Select your options and click <strong>Run Report</strong> to fetch data.
          </p>
        </div>
      )}

      {!hasConnection && (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 dark:border-slate-600 dark:bg-slate-800">
            <Facebook className="h-6 w-6 text-gray-600 dark:text-gray-400" />
          </div>
          <h3 className="mb-2 text-base font-semibold text-gray-900 dark:text-white">
            Connect your Meta Ads account
          </h3>
          <p className="mb-6 max-w-sm text-sm text-gray-500 dark:text-gray-400">
            Link your Facebook Ads account to start pulling campaign and ad set performance data.
          </p>
          <Link href="/console" className={cn(primaryLinkClass, "w-auto min-w-[200px]")}>
            Go to Connections
          </Link>
        </div>
      )}
    </>
  );

  const leftColumn = hasConnection ? (
    <>
      <IntegrationSectionCard title="Connection">
        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Meta connection
        </label>
        <select
          value={selectedConnectionId}
          onChange={(e) => setSelectedConnectionId(e.target.value)}
          className={cn(selectClass, "mb-4")}
        >
          {metaConnections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Ad account
        </label>
        <select
          value={selectedAdAccountId}
          onChange={(e) => setSelectedAdAccountId(e.target.value)}
          className={selectClass}
        >
          {adAccounts.length === 0 && <option value="">No accounts found</option>}
          {adAccounts.map((a: any) => (
            <option key={a.id} value={a.id.replace("act_", "")}>
              {a.name || a.id}
            </option>
          ))}
        </select>
      </IntegrationSectionCard>

      <IntegrationSectionCard title="Data level">
        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Report level
        </label>
        <select value={level} onChange={(e) => setLevel(e.target.value)} className={selectClass}>
          {META_LEVEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </IntegrationSectionCard>

      <IntegrationSectionCard title="Date range">
        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Preset
        </label>
        <select value={datePreset} onChange={(e) => setDatePreset(e.target.value)} className={selectClass}>
          {DATE_PRESETS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </IntegrationSectionCard>

      <IntegrationSectionCard title="Metrics">
        <div className="flex flex-wrap gap-2">
          {METRIC_OPTIONS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() =>
                setSelectedMetrics((prev) =>
                  prev.includes(m.value) ? prev.filter((x) => x !== m.value) : [...prev, m.value]
                )
              }
              className={chip(selectedMetrics.includes(m.value))}
            >
              {m.label}
            </button>
          ))}
        </div>
      </IntegrationSectionCard>

      <IntegrationSectionCard title="Breakdowns (optional)">
        <div className="flex flex-wrap gap-2">
          {META_BREAKDOWN_OPTIONS.map((b) => (
            <button
              key={b.value}
              type="button"
              onClick={() =>
                setSelectedBreakdowns((prev) =>
                  prev.includes(b.value) ? prev.filter((x) => x !== b.value) : [...prev, b.value]
                )
              }
              className={chip(selectedBreakdowns.includes(b.value))}
            >
              {b.label}
            </button>
          ))}
        </div>
      </IntegrationSectionCard>
    </>
  ) : (
    <IntegrationSectionCard title="Connection">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Add a Meta Ads connection from Data Sources to run reports.
      </p>
    </IntegrationSectionCard>
  );

  return (
    <IntegrationPageLayout
      title="Meta Ads"
      description="Campaign and ad set performance from Facebook and Instagram Ads."
      icon={
        <img src={INTEGRATION_LOGOS.meta} alt="Meta" width={22} height={22} />
      }
      leftColumn={leftColumn}
      primaryAction={
        hasConnection ? (
          <PrimaryButton
            className="w-full py-3"
            onClick={runReport}
            disabled={loading}
            loading={loading}
          >
            {loading
              ? asyncJobId
                ? `Processing… ${asyncPercent}%`
                : "Fetching…"
              : "Run Report"}
          </PrimaryButton>
        ) : null
      }
      resultsHeader={
        hasConnection ? (
          resultsHeader
        ) : (
          <span className="text-sm font-semibold text-gray-800 dark:text-white">Get started</span>
        )
      }
      results={resultsBody}
    />
  );
}
