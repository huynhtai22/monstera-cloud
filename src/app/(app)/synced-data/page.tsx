"use client";

import { useState, useEffect, useMemo } from "react";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { PageShell } from "@/components/ui/PageShell";
import { PrimaryButton, SecondaryButton } from "@/components/ui";
import { Input } from "@/components/ui/Input";
import { downloadCsv } from "@/lib/export-utils";
import {
  Database,
  Calendar,
  Filter,
  Download,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  Layers,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface MetricRow {
  id: string;
  platform: string;
  accountId: string;
  accountName: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  cpc: number;
  ctr: number;
  conversions: number;
  revenue: number;
  roas: number;
  currency: string;
  pulledAt: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  tiktok_ads: "TikTok Ads",
  google_ads: "Google Ads",
  shopee: "Shopee",
  lazada: "Lazada",
  shopify: "Shopify",
};

const PLATFORM_COLORS: Record<string, string> = {
  meta_ads: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  tiktok_ads: "bg-gray-900 text-white dark:bg-gray-800",
  google_ads: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  shopee: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  lazada: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  shopify: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
};

export default function SyncedDataPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Calculate default date range (last 30 days)
  useEffect(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    setEndDate(end.toISOString().split("T")[0]);
    setStartDate(start.toISOString().split("T")[0]);
  }, []);

  const queryUrl = useMemo(() => {
    if (!activeWorkspaceId || !startDate || !endDate) return null;
    const params = new URLSearchParams({
      workspaceId: activeWorkspaceId,
      startDate,
      endDate,
    });
    if (selectedPlatform) params.set("platform", selectedPlatform);
    return `/api/metrics/query?${params.toString()}`;
  }, [activeWorkspaceId, startDate, endDate, selectedPlatform]);

  const { data, error, isLoading, mutate } = useSWR(queryUrl, fetcher, {
    refreshInterval: 60000, // Refresh every minute
  });

  const metrics: MetricRow[] = data?.metrics || [];
  const summary = data?.summary;

  // Detect data gaps (days with no data)
  const dataGaps = useMemo(() => {
    if (!metrics.length || !startDate || !endDate) return [];
    
    const dateSet = new Set(metrics.map((m) => m.date.split("T")[0]));
    const gaps: string[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      if (!dateSet.has(dateStr)) {
        gaps.push(dateStr);
      }
    }
    return gaps.slice(-7); // Show last 7 gaps max
  }, [metrics, startDate, endDate]);

  // Totals
  const totals = useMemo(() => {
    return metrics.reduce(
      (acc, m) => ({
        impressions: acc.impressions + (m.impressions || 0),
        clicks: acc.clicks + (m.clicks || 0),
        spend: acc.spend + (m.spend || 0),
        conversions: acc.conversions + (m.conversions || 0),
        revenue: acc.revenue + (m.revenue || 0),
      }),
      { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0 }
    );
  }, [metrics]);

  const handleExport = () => {
    if (!metrics.length) return;
    const rows = metrics.map((m) => ({
      Date: m.date.split("T")[0],
      Platform: PLATFORM_LABELS[m.platform] || m.platform,
      Account: m.accountName || m.accountId,
      Campaign: m.campaignName || m.campaignId,
      "Ad Set": m.adsetName || m.adsetId || "-",
      Impressions: m.impressions,
      Clicks: m.clicks,
      Spend: m.spend.toFixed(2),
      CPC: m.cpc?.toFixed(2) || "-",
      CTR: m.ctr?.toFixed(2) + "%" || "-",
      Conversions: m.conversions,
      Revenue: m.revenue?.toFixed(2) || "-",
      ROAS: m.roas?.toFixed(2) || "-",
    }));
    downloadCsv(rows, "synced-data-export");
  };

  const toggleRow = (id: string) => {
    const newSet = new Set(expandedRows);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedRows(newSet);
  };

  return (
    <PageShell className="w-full">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              Synced Data Explorer
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              View and extract historical data synced from all channels
            </p>
          </div>
        </div>
      </div>

      {/* Data Gaps Warning */}
      {dataGaps.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/50 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 text-amber-500 dark:text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                Data gap detected
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">
                No data found for: {dataGaps.join(", ")}. 
                Campaigns may have stopped or sync failed.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-2 mb-4 text-sm font-medium text-gray-700 dark:text-slate-300">
          <Filter className="h-4 w-4" />
          Filters
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              <Calendar className="inline h-3 w-3 mr-1" />
              Start Date
            </label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-10"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              <Calendar className="inline h-3 w-3 mr-1" />
              End Date
            </label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-10"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
              <Layers className="inline h-3 w-3 mr-1" />
              Platform
            </label>
            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value)}
              className="w-full h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="">All Platforms</option>
              {summary?.platforms?.map((p: string) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p] || p}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <PrimaryButton
              onClick={() => mutate()}
              disabled={isLoading}
              className="h-10 px-4"
            >
              {isLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-2">Refresh</span>
            </PrimaryButton>
            <SecondaryButton
              onClick={handleExport}
              disabled={!metrics.length}
              className="h-10 px-4"
            >
              <Download className="h-4 w-4" />
              <span className="ml-2">Export</span>
            </SecondaryButton>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs text-gray-500 dark:text-slate-400">Records</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            {metrics.length.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs text-gray-500 dark:text-slate-400">Impressions</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            {(totals.impressions / 1000).toFixed(0)}k
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs text-gray-500 dark:text-slate-400">Spend</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            ${totals.spend.toFixed(0)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs text-gray-500 dark:text-slate-400">Conversions</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            {totals.conversions.toFixed(0)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs text-gray-500 dark:text-slate-400">Revenue</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            ${totals.revenue.toFixed(0)}
          </p>
        </div>
      </div>

      {/* Data Table */}
      {isLoading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loading data...
          </div>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800/50 dark:bg-red-950/30">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load data</p>
        </div>
      ) : metrics.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center dark:border-slate-700 dark:bg-slate-800/50">
          <Database className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm text-gray-500 dark:text-slate-400">
            No data found for the selected date range.
          </p>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
            Try adjusting your filters or run a sync first.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400">Platform</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400">Account</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400">Campaign</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400">Spend</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400">Impr.</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400">Clicks</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400">Conv.</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400">ROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {metrics.slice(0, 100).map((m) => (
                  <>
                    <tr
                      key={m.id}
                      className="hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer"
                      onClick={() => toggleRow(m.id)}
                    >
                      <td className="px-4 py-3 text-gray-900 dark:text-white">
                        {m.date.split("T")[0]}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium",
                          PLATFORM_COLORS[m.platform] || "bg-gray-100 text-gray-700"
                        )}>
                          {PLATFORM_LABELS[m.platform] || m.platform}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-slate-300 truncate max-w-[120px]">
                        {m.accountName || m.accountId}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-slate-300 truncate max-w-[150px]">
                        {m.campaignName || m.campaignId}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                        ${m.spend?.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300">
                        {m.impressions?.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300">
                        {m.clicks?.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300">
                        {m.conversions?.toFixed(0)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn(
                          "font-medium",
                          m.roas >= 2 ? "text-emerald-600 dark:text-emerald-400" :
                          m.roas >= 1 ? "text-blue-600 dark:text-blue-400" :
                          "text-red-600 dark:text-red-400"
                        )}>
                          {m.roas?.toFixed(2)}x
                        </span>
                      </td>
                    </tr>
                    {expandedRows.has(m.id) && (
                      <tr className="bg-gray-50 dark:bg-slate-800/30">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="text-xs text-gray-500 dark:text-slate-400 space-y-1">
                            <p><strong>Ad Set:</strong> {m.adsetName || m.adsetId || "-"}</p>
                            <p><strong>CPC:</strong> ${m.cpc?.toFixed(2)} | <strong>CTR:</strong> {(m.ctr * 100)?.toFixed(2)}%</p>
                            <p><strong>Revenue:</strong> ${m.revenue?.toFixed(2)} | <strong>Currency:</strong> {m.currency || "-"}</p>
                            <p><strong>Synced:</strong> {new Date(m.pulledAt).toLocaleString()}</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          {metrics.length > 100 && (
            <div className="px-4 py-3 bg-gray-50 dark:bg-slate-800 text-center text-xs text-gray-500 dark:text-slate-400">
              Showing first 100 of {metrics.length.toLocaleString()} records. Use Export to get all data.
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
