"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { ExportDropdown } from "@/components/ExportDropdown";
import { downloadCsv, downloadExcel } from "@/lib/export-utils";
import { RefreshCw, AlertCircle, TrendingUp, ShoppingCart, BarChart3 } from "lucide-react";
import { GOOGLE_DATE_PERIODS, GOOGLE_REPORT_TYPES } from "@/lib/google-ads";
import { IntegrationPageLayout, inputFocus } from "@/components/ui/IntegrationPageLayout";
import { IntegrationSectionCard } from "@/components/ui/IntegrationSectionCard";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const selectClass = cn(
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white",
  inputFocus
);

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

  const workspace = Array.isArray(workspaces)
    ? workspaces.find((w: any) => w.id === activeWorkspaceId) ?? workspaces[0]
    : null;

  const googleConnections: Array<{ id: string; name: string; credentials: string }> =
    (workspace?.connections ?? []).filter(
      (c: any) => c.provider === "google_ads" && c.status === "connected"
    );

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

  const selectedConn = googleConnections.find((c) => c.id === selectedConnectionId);
  const customerIds: string[] = selectedConn
    ? (() => {
        try {
          return JSON.parse(selectedConn.credentials).customerIds ?? [];
        } catch {
          return [];
        }
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

  const primaryLinkClass = cn(
    "inline-flex w-full min-w-[200px] items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold text-white",
    "bg-primary hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-ring/40",
    "transition-colors"
  );

  const resultsHeader = (
    <>
      <span className="text-sm font-semibold text-gray-800 dark:text-white">
        Results
        {lastUpdated && (
          <span className="ml-2 text-xs font-normal text-gray-400">· Updated {lastUpdated}</span>
        )}
      </span>
      {rows.length > 0 && (
        <ExportDropdown
          onCsv={() => downloadCsv(rows, "google_ads_report")}
          onExcel={() => downloadExcel(rows, "google_ads_report")}
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
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Fetching…</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="border-t border-gray-100 dark:border-slate-700/60">
          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/80">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {rows.length.toLocaleString()} rows
            </span>
            <ReportIcon className="h-4 w-4 text-gray-400" />
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
            <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800">
              Showing first 500 rows. Export to CSV/Excel for full dataset.
            </div>
          )}
        </div>
      )}

      {!loading && rows.length === 0 && !error && hasConnection && (
        <div className="flex min-h-[280px] flex-col items-center justify-center px-6 py-16 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Select your report type and date period, then click <strong>Run Report</strong>.
          </p>
        </div>
      )}

      {!hasConnection && (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 dark:border-slate-600 dark:bg-slate-800">
            <TrendingUp className="h-6 w-6 text-gray-600 dark:text-gray-400" />
          </div>
          <h3 className="mb-2 text-base font-semibold text-gray-900 dark:text-white">Connect your Google Ads account</h3>
          <p className="mb-6 max-w-sm text-sm text-gray-500 dark:text-gray-400">
            Link your Google Ads account to start pulling campaign and Shopping performance data. Requires a Google Ads Developer Token.
          </p>
          <Link href="/console" className={primaryLinkClass}>
            Go to Connections
          </Link>
        </div>
      )}
    </>
  );

  const leftColumn = hasConnection ? (
    <>
      <IntegrationSectionCard title="Connection">
        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Connection</label>
        <select
          value={selectedConnectionId}
          onChange={(e) => setSelectedConnectionId(e.target.value)}
          className={cn(selectClass, "mb-4")}
        >
          {googleConnections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Account (Customer ID)</label>
        <select value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)} className={selectClass}>
          {customerIds.length === 0 && <option value="">No accounts found</option>}
          {customerIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </IntegrationSectionCard>

      <IntegrationSectionCard title="Report type">
        <select value={reportType} onChange={(e) => setReportType(e.target.value)} className={selectClass}>
          {GOOGLE_REPORT_TYPES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800/80">
          <ReportIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {reportType === "campaign" &&
              "Campaign-level: impressions, clicks, cost, conversions, CTR, search impression share. Cost is automatically converted from micros."}
            {reportType === "adgroup" && "Ad group-level: performance breakdown by ad group within each campaign."}
            {reportType === "shopping" &&
              "Product-level Shopping data: ROAS by product, title, clicks, conversions. Great for identifying top-performing SKUs."}
          </p>
        </div>
      </IntegrationSectionCard>

      <IntegrationSectionCard title="Date period">
        <select value={datePeriod} onChange={(e) => setDatePeriod(e.target.value)} className={selectClass}>
          {GOOGLE_DATE_PERIODS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </IntegrationSectionCard>
    </>
  ) : (
    <IntegrationSectionCard title="Connection">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Add a Google Ads connection from Data Sources to run reports.
      </p>
    </IntegrationSectionCard>
  );

  return (
    <IntegrationPageLayout
      title="Google Ads"
      description="Campaign, ad group, and Shopping performance from Google Ads."
      icon={<Image src="/logos/google-ads.svg" alt="Google Ads" width={22} height={22} />}
      primaryAction={
        hasConnection ? (
          <PrimaryButton className="w-full py-3" onClick={runReport} disabled={loading} loading={loading}>
            {loading ? "Fetching…" : "Run Report"}
          </PrimaryButton>
        ) : null
      }
      leftColumn={leftColumn}
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
