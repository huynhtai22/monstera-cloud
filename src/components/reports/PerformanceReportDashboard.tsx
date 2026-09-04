"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  DollarSign,
  TrendingUp,
  Target,
  ShoppingCart,
  MousePointer,
  Download,
  Copy,
  Check,
  Flame,
  ArrowUpRight,
  Search,
  Building2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCurrencyValue, generateClientBriefMarkdown } from "@/lib/client-export";
import { downloadCsv } from "@/lib/export-utils";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import type { PerformanceReportData, DailyTrendPoint } from "@/lib/performance-reports";
import type { MarketingAnomaly } from "@/lib/marketing-anomalies";

interface PerformanceReportDashboardProps {
  workspaceId: string;
  clients: Array<{ id: string; name: string }>;
  selectedClientId: string;
  onClientChange: (clientId: string) => void;
}

const DATE_PRESETS = [
  { label: "Last 7 Days", days: 7 },
  { label: "Last 14 Days", days: 14 },
  { label: "Last 30 Days", days: 30 },
  { label: "Today", days: 1 },
];

function getProviderLogo(platform: string): string | null {
  if (platform === "meta_ads") return INTEGRATION_LOGOS.meta;
  if (platform === "google_ads") return INTEGRATION_LOGOS.googleAds;
  if (platform === "tiktok_business") return INTEGRATION_LOGOS.tiktok;
  if (platform === "shopee") return INTEGRATION_LOGOS.shopee;
  if (platform === "lazada") return INTEGRATION_LOGOS.lazada;
  if (platform === "shopify") return INTEGRATION_LOGOS.shopify;
  if (platform === "amazon") return INTEGRATION_LOGOS.amazon;
  return null;
}

export function PerformanceReportDashboard({
  workspaceId,
  clients,
  selectedClientId,
  onClientChange,
}: PerformanceReportDashboardProps) {
  const [presetDays, setPresetDays] = useState<number>(7);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [hoveredDay, setHoveredDay] = useState<DailyTrendPoint | null>(null);
  const [copiedBrief, setCopiedBrief] = useState(false);

  // Compute dates based on preset
  const { startDateStr, endDateStr } = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - (presetDays - 1) * 24 * 60 * 60 * 1000);
    return {
      startDateStr: start.toISOString().split("T")[0],
      endDateStr: end.toISOString().split("T")[0],
    };
  }, [presetDays]);

  const endpoint = useMemo(() => {
    if (!workspaceId) return null;
    const params = new URLSearchParams();
    params.set("workspaceId", workspaceId);
    params.set("startDate", startDateStr);
    params.set("endDate", endDateStr);
    if (selectedClientId) params.set("clientId", selectedClientId);
    return `/api/reports/performance?${params.toString()}`;
  }, [workspaceId, startDateStr, endDateStr, selectedClientId]);

  const { data, error, isLoading, isValidating, mutate } = useSWR<{
    report: PerformanceReportData;
    client?: { id: string; name: string } | null;
    anomalies: MarketingAnomaly[];
    dateRange: { startDate: string; endDate: string };
    latestDataDate: string | null;
  }>(endpoint, async (url: string) => {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Failed to load report");
    return body;
  });

  const report = data?.report;
  const overall = report?.overall;
  const currency = report?.primaryCurrency || "USD";
  const topCampaigns = report?.topCampaigns;

  // Filtered campaigns
  const filteredCampaigns = useMemo(() => {
    if (!topCampaigns) return [];
    if (!campaignSearch.trim()) return topCampaigns;
    const q = campaignSearch.toLowerCase();
    return topCampaigns.filter(
      (c) =>
        c.campaignName.toLowerCase().includes(q) ||
        c.platform.toLowerCase().includes(q) ||
        (c.accountName && c.accountName.toLowerCase().includes(q))
    );
  }, [topCampaigns, campaignSearch]);

  // Copy Executive Brief to Clipboard
  const handleCopyBrief = () => {
    if (!overall || !report) return;
    const briefText = generateClientBriefMarkdown({
      overall,
      platformRollups: report.platformBreakdown,
      campaignRollups: report.topCampaigns,
      dateRange: { start: startDateStr, end: endDateStr },
      dataThrough: data?.latestDataDate,
      clientName: data?.client?.name,
      totalRecordsLoaded: report.totalRecords,
    });

    navigator.clipboard.writeText(briefText);
    setCopiedBrief(true);
    toast.success("Executive brief copied to clipboard!");
    setTimeout(() => setCopiedBrief(false), 2500);
  };

  // Download CSV Export
  const handleDownloadCsv = () => {
    if (!report?.topCampaigns || report.topCampaigns.length === 0) {
      toast.error("No campaign data to export");
      return;
    }

    const rows = report.topCampaigns.map((c) => ({
      Platform: c.platform,
      Account: c.accountName || "",
      Campaign: c.campaignName,
      Spend: c.spend.toFixed(2),
      Conversions: c.conversions,
      CPA: c.cpa.toFixed(2),
      Revenue: c.revenue.toFixed(2),
      ROAS: c.roas.toFixed(2),
      Currency: c.currency,
    }));

    downloadCsv(rows, `performance-report-${selectedClientId || "all"}-${startDateStr}-${endDateStr}`);
    toast.success("CSV export downloaded");
  };

  return (
    <div className="space-y-6">
      {/* ─── FILTERS & HEADER BAR ─── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-line bg-panel p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* Brand Filter */}
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-ink-mute" />
            <select
              value={selectedClientId}
              onChange={(e) => onClientChange(e.target.value)}
              className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-ink focus:border-white focus:outline-none"
            >
              <option value="">All Brands ({clients.length})</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range Preset Selector */}
          <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5 text-xs font-medium">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => setPresetDays(p.days)}
                className={cn(
                  "rounded-md px-2.5 py-1 transition-colors cursor-pointer",
                  presetDays === p.days
                    ? "bg-white/[0.12] text-ink font-semibold shadow-xs"
                    : "text-ink-mute hover:text-ink"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => mutate()}
            disabled={isValidating}
            className="rounded-lg border border-line bg-canvas p-2 text-ink-mute hover:text-ink hover:bg-white/[0.04] transition-colors"
            title="Refresh Data"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isValidating && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={handleCopyBrief}
            disabled={!report || report.totalRecords === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-ink hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            {copiedBrief ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedBrief ? "Copied" : "Copy Brief"}
          </button>
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={!report?.topCampaigns || report.topCampaigns.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white hover:bg-neutral-200 px-3 py-1.5 text-xs font-semibold text-black transition-colors shadow-xs cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* ─── MARKETING ANOMALIES ALERT BANNER ─── */}
      {data?.anomalies && data.anomalies.length > 0 ? (
        <div className="rounded-xl border border-rose-900/50 bg-rose-950/25 p-4 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-rose-300 font-semibold">
              <Flame className="h-4 w-4 text-rose-400 shrink-0" />
              <span>
                Marketing Watchdog: {data.anomalies.length} active spend or efficiency {data.anomalies.length === 1 ? "anomaly" : "anomalies"} detected
              </span>
            </div>
            <Link
              href="/clients"
              className="text-rose-400 hover:text-rose-300 underline font-medium flex items-center gap-1 shrink-0"
            >
              Review in Watchdog <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <p className="mt-1 text-rose-200/80 text-[11px] truncate">
            {data.anomalies[0].message}
          </p>
        </div>
      ) : null}

      {/* ─── LOADING STATE ─── */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl border border-line bg-panel p-4 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-6 text-center text-sm text-red-300">
          Failed to load marketing report: {error.message}
        </div>
      ) : !report || report.totalRecords === 0 || !overall ? (
        <div className="rounded-xl border border-line bg-panel p-12 text-center">
          <DollarSign className="mx-auto h-8 w-8 text-ink-mute mb-2 opacity-50" />
          <h3 className="text-sm font-semibold text-ink">No ad metrics recorded in this window</h3>
          <p className="mt-1 text-xs text-ink-mute max-w-sm mx-auto">
            No campaign spend or conversions found between {startDateStr} and {endDateStr}. Ensure ad connections are active or select a wider date range.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setPresetDays(30)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white text-black hover:bg-neutral-200 transition"
            >
              View Last 30 Days
            </button>
            <Link
              href="/sources"
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-line bg-canvas text-ink hover:bg-white/[0.04] transition"
            >
              Check Connections
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* ─── 1. PRIMARY KPI SUMMARY CARDS ─── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Total Ad Spend */}
            <div className="rounded-xl border border-line bg-panel p-4 shadow-xs">
              <span className="text-[11px] font-medium text-ink-mute flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5" /> Total Spend
              </span>
              <p className="mt-2 text-xl font-bold tracking-tight text-ink truncate">
                {overall.isMixedCurrency ? "Multi-currency" : formatCurrencyValue(overall.totalSpend, currency)}
              </p>
              <span className="text-[10px] text-ink-mute block mt-0.5 truncate" title={overall.isMixedCurrency && overall.currencyBreakdowns ? overall.currencyBreakdowns.map((b) => formatCurrencyValue(b.spend, b.currency)).join(" + ") : "Across all ad channels"}>
                {overall.isMixedCurrency && overall.currencyBreakdowns
                  ? overall.currencyBreakdowns.map((b) => formatCurrencyValue(b.spend, b.currency)).join(" + ")
                  : "Across all ad channels"}
              </span>
            </div>

            {/* Total Revenue */}
            <div className="rounded-xl border border-line bg-panel p-4 shadow-xs">
              <span className="text-[11px] font-medium text-ink-mute flex items-center gap-1">
                <ShoppingCart className="h-3.5 w-3.5" /> Total Revenue
              </span>
              <p className="mt-2 text-xl font-bold tracking-tight text-emerald-400 truncate">
                {overall.isMixedCurrency ? "Multi-currency" : formatCurrencyValue(overall.totalRevenue, currency)}
              </p>
              <span className="text-[10px] text-ink-mute block mt-0.5 truncate" title={overall.isMixedCurrency && overall.currencyBreakdowns ? overall.currencyBreakdowns.map((b) => formatCurrencyValue(b.revenue, b.currency)).join(" + ") : "Attributed sales volume"}>
                {overall.isMixedCurrency && overall.currencyBreakdowns
                  ? overall.currencyBreakdowns.map((b) => formatCurrencyValue(b.revenue, b.currency)).join(" + ")
                  : "Attributed sales volume"}
              </span>
            </div>

            {/* Blended ROAS */}
            <div className="rounded-xl border border-line bg-panel p-4 shadow-xs">
              <span className="text-[11px] font-medium text-ink-mute flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5" /> Blended ROAS
              </span>
              <div className="mt-2 flex items-baseline gap-1.5">
                <p
                  className={cn(
                    "text-xl font-bold tracking-tight truncate",
                    overall.blendedRoas >= 3.0
                      ? "text-emerald-400"
                      : overall.blendedRoas >= 2.0
                      ? "text-amber-300"
                      : "text-ink"
                  )}
                >
                  {overall.blendedRoas.toFixed(2)}x
                </p>
              </div>
              <span className="text-[10px] text-ink-mute block mt-0.5">
                {overall.blendedRoas >= 3.0 ? "High efficiency" : "Return on ad spend"}
              </span>
            </div>

            {/* Blended CPA */}
            <div className="rounded-xl border border-line bg-panel p-4 shadow-xs">
              <span className="text-[11px] font-medium text-ink-mute flex items-center gap-1">
                <Target className="h-3.5 w-3.5" /> Blended CPA
              </span>
              <p className="mt-2 text-xl font-bold tracking-tight text-ink truncate">
                {formatCurrencyValue(overall.blendedCpa, currency)}
              </p>
              <span className="text-[10px] text-ink-mute block mt-0.5">Per conversion / sale</span>
            </div>

            {/* Conversions */}
            <div className="rounded-xl border border-line bg-panel p-4 shadow-xs">
              <span className="text-[11px] font-medium text-ink-mute flex items-center gap-1">
                <ShoppingCart className="h-3.5 w-3.5" /> Conversions
              </span>
              <p className="mt-2 text-xl font-bold tracking-tight text-ink truncate">
                {overall.totalConversions.toLocaleString()}
              </p>
              <span className="text-[10px] text-ink-mute block mt-0.5">Total orders & leads</span>
            </div>

            {/* Clicks & CTR */}
            <div className="rounded-xl border border-line bg-panel p-4 shadow-xs">
              <span className="text-[11px] font-medium text-ink-mute flex items-center gap-1">
                <MousePointer className="h-3.5 w-3.5" /> CTR / Traffic
              </span>
              <p className="mt-2 text-xl font-bold tracking-tight text-ink truncate">
                {overall.blendedCtr.toFixed(2)}%
              </p>
              <span className="text-[10px] text-ink-mute block mt-0.5">
                {overall.totalClicks.toLocaleString()} clicks ({overall.totalImpressions.toLocaleString()} views)
              </span>
            </div>
          </div>

          {/* ─── 2. DAILY TREND BAR & AREA VISUALIZATION ─── */}
          {report?.dailyTrends && report.dailyTrends.length > 0 ? (
            <div className="rounded-xl border border-line bg-panel p-5 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-ink">Daily Performance Trends</h3>
                  <p className="text-xs text-ink-mute">
                    Daily ad spend (white bars) vs. attributed revenue (emerald bars)
                  </p>
                </div>
                {hoveredDay ? (
                  <div className="text-xs font-mono bg-canvas border border-line px-3 py-1 rounded-lg">
                    <span className="text-ink font-semibold">{hoveredDay.date}</span>:{" "}
                    Spend <span className="text-white">{formatCurrencyValue(hoveredDay.spend, currency)}</span> ·{" "}
                    Rev <span className="text-emerald-400">{formatCurrencyValue(hoveredDay.revenue, currency)}</span> ·{" "}
                    ROAS <span className="text-indigo-300">{hoveredDay.roas.toFixed(2)}x</span>
                  </div>
                ) : (
                  <span className="text-[11px] text-ink-mute">Hover over any day to inspect</span>
                )}
              </div>

              {/* Responsive SVG Chart */}
              {(() => {
                const maxVal = Math.max(
                  ...report.dailyTrends.map((d) => Math.max(d.spend, d.revenue)),
                  1
                );
                return (
                  <div className="flex items-end gap-2 h-44 w-full pt-4 pb-2 border-b border-line/60">
                    {report.dailyTrends.map((d) => {
                      const spendHeightPct = Math.max(Math.round((d.spend / maxVal) * 100), 4);
                      const revHeightPct = Math.max(Math.round((d.revenue / maxVal) * 100), 4);
                      const isHovered = hoveredDay?.date === d.date;

                      return (
                        <div
                          key={d.date}
                          onMouseEnter={() => setHoveredDay(d)}
                          onMouseLeave={() => setHoveredDay(null)}
                          className="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer"
                        >
                          <div className="w-full flex items-end justify-center gap-0.5 h-full">
                            {/* Spend Bar */}
                            <div
                              style={{ height: `${spendHeightPct}%` }}
                              className={cn(
                                "w-1/2 max-w-[14px] rounded-t-sm transition-all",
                                isHovered ? "bg-white" : "bg-neutral-500 group-hover:bg-neutral-300"
                              )}
                            />
                            {/* Revenue Bar */}
                            <div
                              style={{ height: `${revHeightPct}%` }}
                              className={cn(
                                "w-1/2 max-w-[14px] rounded-t-sm transition-all",
                                isHovered ? "bg-emerald-300" : "bg-emerald-500/80 group-hover:bg-emerald-400"
                              )}
                            />
                          </div>
                          <span className="text-[9px] text-ink-mute mt-1.5 font-mono truncate w-full text-center">
                            {d.date.slice(5)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          ) : null}

          {/* ─── 3. CHANNEL BREAKDOWN CARDS ─── */}
          {report?.platformBreakdown && report.platformBreakdown.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-ink">Channel Performance &amp; Share</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {report.platformBreakdown.map((p) => {
                  const logo = getProviderLogo(p.platform);
                  return (
                    <div
                      key={p.platform}
                      className="rounded-xl border border-line bg-panel p-4 shadow-xs space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {logo ? <IntegrationMark src={logo} size="sm" /> : null}
                          <span className="font-semibold text-xs text-ink">{p.platformLabel}</span>
                        </div>
                        <span className="rounded-full bg-canvas border border-line px-2 py-0.5 font-mono text-[10px] text-ink-mute">
                          {p.shareOfSpend.toFixed(0)}% spend
                        </span>
                      </div>

                      {/* Share Progress Bar */}
                      <div className="h-1.5 w-full rounded-full bg-canvas border border-line overflow-hidden">
                        <div
                          style={{ width: `${p.shareOfSpend}%` }}
                          className="h-full rounded-full bg-white transition-all"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                        <div>
                          <span className="text-[10px] text-ink-mute block">Spend</span>
                          <span className="font-semibold text-ink">
                            {formatCurrencyValue(p.spend, currency)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-ink-mute block">Revenue</span>
                          <span className="font-semibold text-emerald-400">
                            {formatCurrencyValue(p.revenue, currency)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-ink-mute block">ROAS</span>
                          <span className="font-semibold text-ink">{p.roas.toFixed(2)}x</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-ink-mute block">CPA</span>
                          <span className="font-semibold text-ink">
                            {formatCurrencyValue(p.cpa, currency)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* ─── 4. TOP CAMPAIGNS LEADERBOARD ─── */}
          <div className="rounded-xl border border-line bg-panel shadow-xs overflow-hidden">
            <div className="p-4 border-b border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-canvas/50">
              <div>
                <h3 className="text-sm font-semibold text-ink">Campaign Leaderboard</h3>
                <p className="text-xs text-ink-mute">
                  Top performing campaigns ranked by ad spend and return
                </p>
              </div>

              {/* Search Bar */}
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ink-mute" />
                <input
                  type="text"
                  value={campaignSearch}
                  onChange={(e) => setCampaignSearch(e.target.value)}
                  placeholder="Filter campaigns..."
                  className="w-full rounded-lg border border-line bg-canvas pl-8 pr-3 py-1.5 text-xs text-ink placeholder:text-ink-mute focus:border-white focus:outline-none"
                />
              </div>
            </div>

            {filteredCampaigns.length === 0 ? (
              <div className="py-8 text-center text-xs text-ink-mute">
                No campaigns match your search query.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-canvas/40 text-[11px] font-semibold text-ink-mute uppercase tracking-wider">
                      <th className="py-3 px-4">Campaign</th>
                      <th className="py-3 px-4">Channel</th>
                      <th className="py-3 px-4 text-right">Spend</th>
                      <th className="py-3 px-4 text-right">Conversions</th>
                      <th className="py-3 px-4 text-right">CPA</th>
                      <th className="py-3 px-4 text-right">Revenue</th>
                      <th className="py-3 px-4 text-right">ROAS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {filteredCampaigns.map((c, idx) => {
                      const logo = getProviderLogo(c.platform);
                      return (
                        <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-3 px-4 max-w-[240px]">
                            <p className="font-semibold text-ink truncate">{c.campaignName}</p>
                            {c.accountName ? (
                              <p className="text-[10px] text-ink-mute truncate font-mono">
                                {c.accountName}
                              </p>
                            ) : null}
                          </td>
                          <td className="py-3 px-4">
                            <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2 py-0.5 text-[10px] font-medium text-ink">
                              {logo ? <IntegrationMark src={logo} size="sm" /> : null}
                              {c.platformLabel}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-medium text-ink">
                            {formatCurrencyValue(c.spend, c.currency)}
                          </td>
                          <td className="py-3 px-4 text-right text-ink-mute font-mono">
                            {c.conversions.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-right text-ink font-medium">
                            {formatCurrencyValue(c.cpa, c.currency)}
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-emerald-400">
                            {formatCurrencyValue(c.revenue, c.currency)}
                          </td>
                          <td className="py-3 px-4 text-right font-semibold">
                            <span
                              className={cn(
                                "px-1.5 py-0.5 rounded text-[11px]",
                                c.roas >= 3.0
                                  ? "bg-emerald-950/60 text-emerald-300 border border-emerald-800/40"
                                  : c.roas >= 2.0
                                  ? "bg-amber-950/60 text-amber-300 border border-amber-800/40"
                                  : "bg-canvas text-ink-mute border border-line"
                              )}
                            >
                              {c.roas.toFixed(2)}x
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
