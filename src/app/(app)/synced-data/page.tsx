"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { Input } from "@/components/ui/Input";
import { PageShell } from "@/components/ui/PageShell";
import { PrimaryButton, SecondaryButton } from "@/components/ui";
import { Dropdown } from "@/components/ui/Dropdown";
import { downloadCsv } from "@/lib/export-utils";
import Link from "next/link";
import {
  ADS_DIMENSIONS,
  ADS_METRICS,
  ADS_CALCULATED_METRICS,
  ADS_FIELDS_BY_ID,
  getDefaultAdsExplorerSelection,
} from "@/lib/ads-field-registry";
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
  Facebook,
  Globe,
  ShoppingBag,
  Plus,
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
  conversions: number;
  revenue: number;
  currency: string;
  pulledAt: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  tiktok_business: "TikTok Ads",
  google_ads: "Google Ads",
  shopee: "Shopee",
  lazada: "Lazada",
  shopify: "Shopify",
};

const PLATFORM_OPTIONS = [
  { value: "", label: "All Platforms", icon: <Layers className="h-4 w-4" /> },
  { value: "meta_ads", label: "Meta Ads", icon: <Facebook className="h-4 w-4 text-blue-600" /> },
  { value: "tiktok_business", label: "TikTok Ads", icon: <Globe className="h-4 w-4" /> },
  { value: "google_ads", label: "Google Ads", icon: <Globe className="h-4 w-4 text-green-600" /> },
  { value: "shopee", label: "Shopee", icon: <ShoppingBag className="h-4 w-4 text-orange-500" /> },
  { value: "lazada", label: "Lazada", icon: <ShoppingBag className="h-4 w-4 text-blue-500" /> },
  { value: "shopify", label: "Shopify", icon: <ShoppingBag className="h-4 w-4 text-green-600" /> },
];

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

  const defaults = useMemo(() => getDefaultAdsExplorerSelection(), []);
  const [dimensions, setDimensions] = useState<string[]>(defaults.dimensions);
  const [metricsSelection, setMetricsSelection] = useState<string[]>(defaults.metrics);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<"breakdowns" | "metrics">("breakdowns");
  const [fieldSearch, setFieldSearch] = useState("");
  
  // Pagination state
  const [allMetrics, setAllMetrics] = useState<MetricRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Calculate default date range (last 30 days)
  useEffect(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    setEndDate(end.toISOString().split("T")[0]);
    setStartDate(start.toISOString().split("T")[0]);
  }, []);

  // Fetch platforms separately (not tied to date range)
  const platformsUrl = useMemo(() => {
    if (!activeWorkspaceId) return null;
    return `/api/metrics/platforms?workspaceId=${activeWorkspaceId}`;
  }, [activeWorkspaceId]);

  const { data: platformsData } = useSWR(platformsUrl, fetcher);

  // Hardcoded free tier limits for client-side validation (pre-API call)
  // API will enforce actual plan-based limits
  const FREE_TIER_MAX_DAYS = 30;

  // Pre-API date validation (using free tier as conservative default)
  const dateRangeError = useMemo(() => {
    if (!startDate || !endDate) return null;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (days > FREE_TIER_MAX_DAYS) {
      return `Date range too large. Maximum ${FREE_TIER_MAX_DAYS} days (upgrade for more).`;
    }
    if (days < 0) return "Start date must be before end date.";
    return null;
  }, [startDate, endDate]);

  const queryUrl = useMemo(() => {
    if (!activeWorkspaceId || !startDate || !endDate || dateRangeError) return null;
    const params = new URLSearchParams({
      workspaceId: activeWorkspaceId,
      startDate,
      endDate,
    });
    if (selectedPlatform) params.set("platform", selectedPlatform);
    // Aggregated mode with user-selected fields
    params.set("mode", "aggregate");
    params.set("dimensions", dimensions.join(","));
    params.set("metrics", metricsSelection.join(","));
    return `/api/metrics/query?${params.toString()}`;
  }, [activeWorkspaceId, startDate, endDate, selectedPlatform, dateRangeError, dimensions, metricsSelection]);

  const { data, error, isLoading, mutate } = useSWR(queryUrl, fetcher, {
    refreshInterval: 60000,
    onSuccess: (newData) => {
      // Reset pagination on filter change
      setAllMetrics(newData?.metrics || []);
      setCursor(newData?.pagination?.nextCursor || null);
      setHasMore(newData?.pagination?.hasMore || false);
    },
  });

  // Plan limits from API response (shown for transparency)
  const limits = data?.limits;

  // Load more data
  const loadMore = async () => {
    if (!queryUrl || !cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const url = new URL(queryUrl, window.location.origin);
      url.searchParams.set("cursor", cursor);
      const res = await fetch(url.toString());
      const newData = await res.json();
      if (newData.metrics) {
        setAllMetrics((prev) => [...prev, ...newData.metrics]);
        setCursor(newData.pagination?.nextCursor || null);
        setHasMore(newData.pagination?.hasMore || false);
      }
    } catch (e) {
      console.error("Failed to load more:", e);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const metrics = allMetrics;
  const summary = data?.summary;
  
  // Merge platforms from separate fetch and query response
  const availablePlatforms: string[] = platformsData?.platforms || summary?.platforms || [];

  // Detect data gaps (days with no data)
  const dataGaps = useMemo(() => {
    if (!metrics.length || !startDate || !endDate) return [];
    
    const dateSet = new Set(metrics.map((m) => m.date.split("T")[0]));
    const gaps: string[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    
    // Limit gap detection to reasonable range
    if (days > 365) return [];
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      if (!dateSet.has(dateStr)) {
        gaps.push(dateStr);
      }
    }
    return gaps.slice(-7);
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

  const aggregateRows: Array<Record<string, any>> = data?.mode === "aggregate" ? (data?.rows || []) : [];
  const aggregateColumns: string[] = data?.mode === "aggregate" ? (data?.columns || []) : [];

  const handleExport = () => {
    if (data?.mode === "aggregate") {
      if (!aggregateRows.length) return;
      const rows = aggregateRows.map((r) => {
        const out: Record<string, any> = {};
        for (const col of aggregateColumns) {
          if (col.startsWith("metric:")) {
            const id = col.slice("metric:".length);
            out[ADS_FIELDS_BY_ID[id]?.label ?? id] = r[col];
          } else {
            out[ADS_FIELDS_BY_ID[col]?.label ?? col] = r[col];
          }
        }
        return out;
      });
      downloadCsv(rows, "synced-data-aggregate-export");
      return;
    }

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
      Conversions: m.conversions,
      "Conversion Value": m.revenue?.toFixed(2) || "-",
    }));
    downloadCsv(rows, "synced-data-export");
  };

  const onDragStart = useCallback((id: string) => {
    setDraggingId(id);
  }, []);

  const onDropTo = useCallback((target: "dimensions" | "metrics") => {
    if (!draggingId) return;
    const field = ADS_FIELDS_BY_ID[draggingId];
    if (!field) return;

    if (target === "dimensions") {
      if (field.kind !== "dimension") return;
      setDimensions((prev) => (prev.includes(draggingId) ? prev : [...prev, draggingId]));
    } else {
      if (field.kind !== "metric") return;
      setMetricsSelection((prev) => (prev.includes(draggingId) ? prev : [...prev, draggingId]));
    }
  }, [draggingId]);

  const removeFrom = useCallback((target: "dimensions" | "metrics", id: string) => {
    if (target === "dimensions") {
      // Keep dimensions stable: require at least one dimension.
      setDimensions((prev) => (prev.length <= 1 ? prev : prev.filter((x) => x !== id)));
    } else {
      setMetricsSelection((prev) => (prev.length <= 1 ? prev : prev.filter((x) => x !== id)));
    }
  }, []);

  const onReorder = useCallback((target: "dimensions" | "metrics", id: string, overId: string) => {
    if (id === overId) return;
    const setter = target === "dimensions" ? setDimensions : setMetricsSelection;
    setter((prev) => {
      const from = prev.indexOf(id);
      const to = prev.indexOf(overId);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, id);
      return next;
    });
  }, []);

  const filteredDims = useMemo(() => {
    const q = fieldSearch.trim().toLowerCase();
    if (!q) return ADS_DIMENSIONS;
    return ADS_DIMENSIONS.filter((f) => f.label.toLowerCase().includes(q) || f.id.toLowerCase().includes(q));
  }, [fieldSearch]);

  const filteredRawMetrics = useMemo(() => {
    const q = fieldSearch.trim().toLowerCase();
    if (!q) return ADS_METRICS;
    return ADS_METRICS.filter((f) => f.label.toLowerCase().includes(q) || f.id.toLowerCase().includes(q));
  }, [fieldSearch]);

  const filteredCalculatedMetrics = useMemo(() => {
    const q = fieldSearch.trim().toLowerCase();
    if (!q) return ADS_CALCULATED_METRICS;
    return ADS_CALCULATED_METRICS.filter((f) => f.label.toLowerCase().includes(q) || f.id.toLowerCase().includes(q));
  }, [fieldSearch]);

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

      {/* Plan Badge & Limits Info */}
      {limits && (
        <div className="mb-4 flex items-center gap-3">
          <span className={cn(
            "inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium capitalize",
            limits.plan === 'free' ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" :
            limits.plan === 'starter' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" :
            limits.plan === 'professional' ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" :
            "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
          )}>
            {limits.plan} Plan
          </span>
          <span className="text-xs text-gray-500 dark:text-slate-400">
            Max {limits.maxDateRangeDays} days · {limits.maxRowsPerQuery.toLocaleString()} rows/query
          </span>
          {limits.plan === 'free' && (
            <a href="/pricing" className="text-xs text-cyan-600 hover:text-cyan-700 dark:text-cyan-400">
              Upgrade →
            </a>
          )}
        </div>
      )}

      {/* Date Range Error */}
      {dateRangeError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800/50 dark:bg-red-950/30">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 text-red-500 dark:text-red-400" />
            <p className="text-sm font-medium text-red-900 dark:text-red-100">
              {dateRangeError}
            </p>
          </div>
        </div>
      )}

      {/* Data Gaps Warning */}
      {dataGaps.length > 0 && !dateRangeError && (
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
            <Dropdown
              value={selectedPlatform}
              onChange={setSelectedPlatform}
              options={PLATFORM_OPTIONS.filter(opt => opt.value === "" || availablePlatforms.includes(opt.value))}
              placeholder="All Platforms"
            />
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
            {/* DEBUG: Direct sync test for ad platforms */}
            {activeWorkspaceId && (
              <button
                onClick={async () => {
                  try {
                    // Get connections for this workspace
                    const res = await fetch(`/api/workspaces/${activeWorkspaceId}/connections`);
                    const data = await res.json();
                    console.log('All connections:', data);
                    
                    // List all providers found
                    const providers = data.connections?.map((c: any) => `${c.provider} (${c.id})`).join('\n') || 'None';
                    
                    // Try different provider names
                    let metaConn = data.connections?.find((c: any) => c.provider === 'meta_ads' || c.provider === 'meta-ads');
                    
                    if (metaConn) {
                      alert(`Found Meta connection: ${metaConn.id}\nProvider: ${metaConn.provider}\nName: ${metaConn.name}\n\nTriggering direct sync...`);
                      const syncRes = await fetch(`/api/connections/${metaConn.id}/sync`, { method: 'POST' });
                      const syncData = await syncRes.json();
                      alert(`Sync result: ${JSON.stringify(syncData, null, 2)}`);
                      mutate(); // Refresh data explorer
                    } else {
                      alert(`No Meta Ads connection found.\n\nAll connections in workspace:\n${providers}\n\nCheck console for full data.`);
                    }
                  } catch (e: any) {
                    alert('Error: ' + e.message);
                    console.error(e);
                  }
                }}
                className="h-10 px-3 rounded-lg bg-amber-600 text-white text-sm hover:bg-amber-700"
              >
                🐛 Debug Sync
              </button>
            )}
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

      {/* Right sidebar (Meta/Google-like) */}
      <aside className="mb-6 rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 lg:fixed lg:right-6 lg:top-[140px] lg:mb-0 lg:w-[340px]">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-slate-700">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Customize table</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">Breakdowns &amp; metrics</p>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-950/20 dark:text-slate-200"
            >
              {sidebarOpen ? "Hide" : "Show"}
            </button>
          </div>

          {sidebarOpen && (
            <div className="p-4">
              <Input
                value={fieldSearch}
                onChange={(e) => setFieldSearch(e.target.value)}
                placeholder="Search fields…"
                className="h-9"
              />

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setSidebarTab("breakdowns")}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-2 text-xs font-semibold",
                    sidebarTab === "breakdowns"
                      ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
                  )}
                >
                  Breakdowns
                </button>
                <button
                  type="button"
                  onClick={() => setSidebarTab("metrics")}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-2 text-xs font-semibold",
                    sidebarTab === "metrics"
                      ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
                  )}
                >
                  Metrics
                </button>
              </div>

              {/* Selected list (drag to reorder, checkbox to toggle) */}
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium text-gray-500 dark:text-slate-400">
                  {sidebarTab === "breakdowns" ? "Selected breakdowns" : "Selected metrics"}
                </p>
                <div
                  className="rounded-xl border border-gray-200 bg-gray-50 p-2 dark:border-slate-700 dark:bg-slate-950/20"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDropTo(sidebarTab === "breakdowns" ? "dimensions" : "metrics")}
                >
                  {(sidebarTab === "breakdowns" ? dimensions : metricsSelection).map((id) => (
                    <div
                      key={id}
                      draggable
                      onDragStart={() => onDragStart(id)}
                      onDragEnd={() => setDraggingId(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() =>
                        draggingId &&
                        onReorder(sidebarTab === "breakdowns" ? "dimensions" : "metrics", draggingId, id)
                      }
                      className="mb-1 flex items-center justify-between rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                      title="Drag to reorder"
                    >
                      <label className="flex items-center gap-2">
                        <span className="cursor-grab select-none text-gray-400">⋮⋮</span>
                        <input
                          type="checkbox"
                          checked
                          onChange={() =>
                            removeFrom(sidebarTab === "breakdowns" ? "dimensions" : "metrics", id)
                          }
                        />
                        <span className="font-medium text-gray-900 dark:text-white">
                          {ADS_FIELDS_BY_ID[id]?.label ?? id}
                        </span>
                      </label>
                      <span className="text-[10px] text-gray-500">{id}</span>
                    </div>
                  ))}
                  {(sidebarTab === "breakdowns" ? dimensions : metricsSelection).length === 0 && (
                    <p className="px-2 py-3 text-xs text-gray-500 dark:text-slate-400">
                      Drag fields here or tick them below.
                    </p>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
                  {sidebarTab === "breakdowns"
                    ? "Dimensions are stable for join safety. Removing the last one is blocked."
                    : "Removing the last metric is blocked."}
                </p>
              </div>

              <div className="mt-5">
                <p className="mb-2 text-xs font-medium text-gray-500 dark:text-slate-400">
                  {sidebarTab === "breakdowns" ? "Available breakdowns" : "Available metrics"}
                </p>
                <div className="max-h-[340px] overflow-auto rounded-xl border border-gray-200 dark:border-slate-700">
                  <div className="divide-y divide-gray-100 dark:divide-slate-800">
                  {sidebarTab === "breakdowns" ? (
                    filteredDims.map((f) => {
                      const selected = dimensions.includes(f.id);
                      return (
                        <div
                          key={f.id}
                          className="flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-slate-800/40"
                        >
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => {
                                if (selected) removeFrom("dimensions", f.id);
                                else setDimensions((prev) => [...prev, f.id]);
                              }}
                            />
                            <span
                              className={cn(
                                "font-medium",
                                selected ? "text-gray-900 dark:text-white" : "text-gray-700 dark:text-slate-200",
                              )}
                            >
                              {f.label}
                            </span>
                          </label>
                          <button
                            type="button"
                            draggable
                            onDragStart={() => onDragStart(f.id)}
                            onDragEnd={() => setDraggingId(null)}
                            className="cursor-grab rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                            title="Drag into selected list"
                          >
                            Drag
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="divide-y divide-gray-100 dark:divide-slate-800">
                      <div>
                        <p className="px-3 py-2 text-[11px] font-semibold text-gray-500 dark:text-slate-400">
                          Raw metrics (aggregates safely)
                        </p>
                        {filteredRawMetrics.map((f) => {
                          const selected = metricsSelection.includes(f.id);
                          return (
                            <div
                              key={f.id}
                              className="flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-slate-800/40"
                            >
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => {
                                    if (selected) removeFrom("metrics", f.id);
                                    else setMetricsSelection((prev) => [...prev, f.id]);
                                  }}
                                />
                                <span
                                  className={cn(
                                    "font-medium",
                                    selected ? "text-gray-900 dark:text-white" : "text-gray-700 dark:text-slate-200",
                                  )}
                                >
                                  {f.label}
                                </span>
                              </label>
                              <button
                                type="button"
                                draggable
                                onDragStart={() => onDragStart(f.id)}
                                onDragEnd={() => setDraggingId(null)}
                                className="cursor-grab rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                title="Drag into selected list"
                              >
                                Drag
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <div>
                        <p className="px-3 py-2 text-[11px] font-semibold text-gray-500 dark:text-slate-400">
                          Calculated metrics (computed from sums)
                        </p>
                        {filteredCalculatedMetrics.map((f) => {
                          const selected = metricsSelection.includes(f.id);
                          return (
                            <div
                              key={f.id}
                              className="flex items-start justify-between gap-3 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-slate-800/40"
                            >
                              <label className="flex items-start gap-2">
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
                                  checked={selected}
                                  onChange={() => {
                                    if (selected) removeFrom("metrics", f.id);
                                    else setMetricsSelection((prev) => [...prev, f.id]);
                                  }}
                                />
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={cn(
                                        "font-medium",
                                        selected ? "text-gray-900 dark:text-white" : "text-gray-700 dark:text-slate-200",
                                      )}
                                    >
                                      {f.label}
                                    </span>
                                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                                      Calculated
                                    </span>
                                  </div>
                                  {f.formula ? (
                                    <p className="mt-0.5 font-mono text-[10px] text-gray-500 dark:text-slate-400">
                                      {f.formula}
                                    </p>
                                  ) : null}
                                </div>
                              </label>
                              <button
                                type="button"
                                draggable
                                onDragStart={() => onDragStart(f.id)}
                                onDragEnd={() => setDraggingId(null)}
                                className="mt-0.5 cursor-grab rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                title="Drag into selected list"
                              >
                                Drag
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  </div>
                </div>
              </div>
            </div>
          )}
      </aside>

      {/* Main content (pad right on desktop so it doesn't sit under sidebar) */}
      <div className="lg:pr-[360px]">
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
      ) : data?.mode === "aggregate" ? (
        aggregateRows.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center dark:border-slate-700 dark:bg-slate-800/50">
            <Database className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-sm text-gray-500 dark:text-slate-400">No aggregated rows for this selection.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr>
                    {aggregateColumns.map((c) => {
                      const label = c.startsWith("metric:")
                        ? ADS_FIELDS_BY_ID[c.slice("metric:".length)]?.label ?? c
                        : ADS_FIELDS_BY_ID[c]?.label ?? c;
                      const align = c.startsWith("metric:") ? "text-right" : "text-left";
                      return (
                        <th
                          key={c}
                          className={cn(
                            "px-4 py-3 text-xs font-medium text-gray-500 dark:text-slate-400 whitespace-nowrap",
                            align,
                          )}
                        >
                          {label}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {aggregateRows.slice(0, 200).map((r, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                      {aggregateColumns.map((c) => {
                        const v = r[c];
                        const isMetric = c.startsWith("metric:");
                        const text =
                          typeof v === "number"
                            ? isMetric
                              ? Number.isFinite(v)
                                ? v.toLocaleString(undefined, { maximumFractionDigits: 4 })
                                : String(v)
                              : v.toLocaleString?.() ?? String(v)
                            : String(v ?? "");
                        return (
                          <td
                            key={c}
                            className={cn(
                              "px-4 py-3 whitespace-nowrap",
                              isMetric ? "text-right text-gray-900 dark:text-white" : "text-gray-700 dark:text-slate-300",
                            )}
                          >
                            {text}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 bg-gray-50 dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700">
              <span className="text-xs text-gray-500 dark:text-slate-400">
                Showing {Math.min(aggregateRows.length, 200).toLocaleString()} rows (capped for UI)
              </span>
            </div>
          </div>
        )
      ) : metrics.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center dark:border-slate-700 dark:bg-slate-800/50">
          <Database className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm text-gray-500 dark:text-slate-400">
            No data found for the selected date range.
          </p>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1 mb-2">
            Try adjusting your filters or run a sync first.
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-4 max-w-md mx-auto leading-relaxed">
            This view only shows rows already saved in your workspace (<span className="font-medium">CampaignMetric</span>).
            To pull Meta for a date range into storage, open{" "}
            <Link href="/explorer" className="font-medium text-cyan-600 hover:underline">
              Data Explorer
            </Link>{" "}
            → <span className="font-medium">Internal warehouse</span> → Import, or run a sync from{" "}
            <Link href="/sources" className="font-medium text-cyan-600 hover:underline">
              Sources
            </Link>
            .
          </p>

          {/* DEBUG: Check what data exists */}
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={async () => {
                if (!activeWorkspaceId) return;
                try {
                  // Use debug endpoint for detailed info
                  const res = await fetch(`/api/debug/campaign-metrics?workspaceId=${activeWorkspaceId}`);
                  const data = await res.json();
                  
                  if (data.error) {
                    alert(`Error: ${data.error}\n${data.details || ''}`);
                    return;
                  }
                  
                  const platforms = (data.platformCounts || []).map((p: any) => 
                    `${p.platform}: ${p.count} rows`
                  ).join('\n') || 'None';
                  
                  const samples = (data.sampleRows || []).map((m: any) => 
                    `• ${m.platform} | ${m.accountName || m.accountId} | ${m.campaignName || 'N/A'} | $${m.spend} | ${m.date?.split('T')[0]}`
                  ).join('\n') || 'No sample rows';
                  
                  const dateRange = data.dateRange;
                  const dateInfo = dateRange 
                    ? `Earliest: ${dateRange.earliest?.split('T')[0]}\nLatest: ${dateRange.latest?.split('T')[0]}`
                    : 'No date range info';
                  
                  alert(
                    `📊 CampaignMetric Database Report\n` +
                    `Workspace: ${data.workspaceId?.slice(0, 20)}...\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `Total Rows: ${data.totalCount}\n\n` +
                    `By Platform:\n${platforms}\n\n` +
                    `Date Range:\n${dateInfo}\n\n` +
                    `Sample Rows:\n${samples}\n\n` +
                    `Accounts Found:\n${(data.accounts || []).map((a: any) => `• ${a.platform}: ${a.accountName || a.accountId}`).join('\n') || 'None'}`
                  );
                } catch (e: any) {
                  alert('Error checking database: ' + e.message);
                }
              }}
              className="text-xs text-cyan-600 hover:text-cyan-700 underline"
            >
              Check Database (detailed report)
            </button>
            
            <Link
              href="/sources"
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Connect a Data Source
            </Link>
          </div>
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
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-400">Conv. value</th>
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
                        ${m.revenue?.toFixed(2)}
                      </td>
                    </tr>
                    {expandedRows.has(m.id) && (
                      <tr className="bg-gray-50 dark:bg-slate-800/30">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="text-xs text-gray-500 dark:text-slate-400 space-y-1">
                            <p><strong>Ad Set:</strong> {m.adsetName || m.adsetId || "-"}</p>
                            <p><strong>Conversion Value:</strong> ${m.revenue?.toFixed(2)} | <strong>Currency:</strong> {m.currency || "-"}</p>
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
          {/* Pagination */}
          <div className="px-4 py-3 bg-gray-50 dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-slate-400">
                Showing {metrics.length.toLocaleString()} 
                {data?.pagination?.totalApprox && ` of ~${data.pagination.totalApprox.toLocaleString()}`} records
                {hasMore && " (more available)"}
              </span>
              {hasMore && (
                <SecondaryButton
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="h-8 px-3 text-xs"
                >
                  {isLoadingMore ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      Load more
                      <ChevronDown className="ml-1 h-3 w-3" />
                    </>
                  )}
                </SecondaryButton>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </PageShell>
  );
}
