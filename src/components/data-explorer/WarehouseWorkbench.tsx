"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { resolveDataThrough, resolveWarehouseEmptyState } from "@/lib/warehouse-truth";
import Link from "next/link";
import {
  AlertCircle,
  ChevronDown,
  Database,
  Download,
  Layers,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  ArrowUpDown,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace";
import { Input } from "@/components/ui/Input";
import { SecondaryButton } from "@/components/ui";
import { Dropdown } from "@/components/ui/Dropdown";
import { downloadCsv, downloadExcel } from "@/lib/export-utils";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { RefreshWarehouseModal } from "./RefreshWarehouseModal";
import { AnalystPane } from "./AnalystPane";

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
  adId: string;
  adName: string;
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

export const PLATFORM_LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  tiktok_business: "TikTok Ads",
  google_ads: "Google Ads",
  shopee: "Shopee",
  lazada: "Lazada",
  shopify: "Shopify",
};

const PLATFORM_OPTIONS = [
  { value: "", label: "All Platforms", icon: <Layers className="h-4 w-4" /> },
  {
    value: "meta_ads",
    label: "Meta Ads",
    icon: <IntegrationMark src={INTEGRATION_LOGOS.meta} size="sm" />,
  },
  {
    value: "tiktok_business",
    label: "TikTok Ads",
    icon: <IntegrationMark src={INTEGRATION_LOGOS.tiktok} size="sm" />,
  },
  {
    value: "google_ads",
    label: "Google Ads",
    icon: <IntegrationMark src={INTEGRATION_LOGOS.googleAds} size="sm" />,
  },
  {
    value: "shopee",
    label: "Shopee",
    icon: <IntegrationMark src={INTEGRATION_LOGOS.shopee} size="sm" />,
  },
  {
    value: "lazada",
    label: "Lazada",
    icon: <IntegrationMark src={INTEGRATION_LOGOS.lazada} size="sm" />,
  },
];

const PLATFORM_COLORS: Record<string, string> = {
  meta_ads: "border border-line bg-panel text-ink",
  tiktok_ads: "border border-line bg-panel text-ink",
  tiktok_business: "border border-line bg-panel text-ink",
  google_ads: "border border-line bg-panel text-ink",
  shopee: "border border-line bg-panel text-ink",
  lazada: "border border-line bg-panel text-ink",
};

type WarehouseColId =
  | "date"
  | "platform"
  | "account"
  | "campaign"
  | "adset"
  | "ad"
  | "currency"
  | "impressions"
  | "clicks"
  | "spend"
  | "cpc"
  | "ctr"
  | "conversions"
  | "revenue"
  | "roas"
  | "reach";

type ColumnDef = {
  id: WarehouseColId;
  label: string;
  group: "dimension" | "metric";
  defaultOn: boolean;
};

/** Dimensions & metrics available in the warehouse table. */
const WAREHOUSE_COLUMNS: ColumnDef[] = [
  { id: "account", label: "Account", group: "dimension", defaultOn: true },
  { id: "adset", label: "Ad set", group: "dimension", defaultOn: false },
  { id: "ad", label: "Ad", group: "dimension", defaultOn: false },
  { id: "campaign", label: "Campaign", group: "dimension", defaultOn: true },
  { id: "currency", label: "Currency", group: "dimension", defaultOn: false },
  { id: "date", label: "Date", group: "dimension", defaultOn: true },
  { id: "platform", label: "Platform", group: "dimension", defaultOn: true },
  { id: "clicks", label: "Clicks", group: "metric", defaultOn: true },
  { id: "conversions", label: "Conversions", group: "metric", defaultOn: true },
  { id: "cpc", label: "CPC", group: "metric", defaultOn: false },
  { id: "ctr", label: "CTR", group: "metric", defaultOn: false },
  { id: "impressions", label: "Impressions", group: "metric", defaultOn: true },
  { id: "reach", label: "Reach", group: "metric", defaultOn: false },
  { id: "revenue", label: "Revenue", group: "metric", defaultOn: false },
  { id: "roas", label: "ROAS", group: "metric", defaultOn: true },
  { id: "spend", label: "Spend", group: "metric", defaultOn: true },
];

export type ColumnPresetId = "performance" | "traffic" | "ecommerce" | "all";

export const COLUMN_PRESETS: Array<{ id: ColumnPresetId; label: string; description: string; columns: WarehouseColId[] }> = [
  {
    id: "performance",
    label: "Performance",
    description: "Spend, Revenue, ROAS, Conversions & Costs",
    columns: ["date", "platform", "account", "campaign", "spend", "revenue", "roas", "conversions", "cpc", "ctr"],
  },
  {
    id: "traffic",
    label: "Traffic & Engagement",
    description: "Impressions, Clicks, CTR, CPC & Reach",
    columns: ["date", "platform", "account", "campaign", "impressions", "clicks", "ctr", "cpc", "reach", "spend"],
  },
  {
    id: "ecommerce",
    label: "E-Commerce",
    description: "Spend, Attributed Revenue, Conversions & ROAS",
    columns: ["date", "platform", "account", "campaign", "spend", "revenue", "conversions", "roas"],
  },
  {
    id: "all",
    label: "All Columns",
    description: "Full attribution across all 16 dimensions & metrics",
    columns: [
      "date",
      "platform",
      "account",
      "campaign",
      "adset",
      "ad",
      "currency",
      "impressions",
      "clicks",
      "spend",
      "cpc",
      "ctr",
      "conversions",
      "revenue",
      "roas",
      "reach",
    ],
  },
];

function rowSearchBlob(m: MetricRow): string {
  const parts = [
    m.date,
    m.platform,
    m.accountName,
    m.accountId,
    m.campaignName,
    m.campaignId,
    m.adsetName,
    m.adsetId,
    m.adName,
    m.adId,
    m.currency,
    String(m.impressions ?? ""),
    String(m.clicks ?? ""),
    String(m.spend ?? ""),
    String(m.cpc ?? ""),
    String(m.ctr ?? ""),
    String(m.conversions ?? ""),
    String(m.revenue ?? ""),
    String(m.roas ?? ""),
    String(m.reach ?? ""),
  ];
  return parts.join(" ").toLowerCase();
}

function getSortValue(m: MetricRow, id: WarehouseColId): number | string {
  switch (id) {
    case "date":
      return new Date(m.date).getTime();
    case "platform":
      return (PLATFORM_LABELS[m.platform] || m.platform).toLowerCase();
    case "account":
      return (m.accountName || m.accountId || "").toLowerCase();
    case "campaign":
      return (m.campaignName || m.campaignId || "").toLowerCase();
    case "adset":
      return (m.adsetName || m.adsetId || "").toLowerCase();
    case "ad":
      return (m.adName || m.adId || "").toLowerCase();
    case "currency":
      return (m.currency || "").toLowerCase();
    case "impressions":
      return m.impressions ?? 0;
    case "clicks":
      return m.clicks ?? 0;
    case "spend":
      return m.spend ?? 0;
    case "cpc":
      return m.cpc ?? 0;
    case "ctr": {
      const t = m.ctr;
      if (typeof t !== "number") return 0;
      return t <= 1 ? t * 100 : t;
    }
    case "conversions":
      return m.conversions ?? 0;
    case "revenue":
      return m.revenue ?? 0;
    case "roas":
      return m.roas ?? 0;
    case "reach":
      return m.reach ?? 0;
    default:
      return "";
  }
}

function compareRowsForSort(a: MetricRow, b: MetricRow, id: WarehouseColId, dir: "asc" | "desc"): number {
  const av = getSortValue(a, id);
  const bv = getSortValue(b, id);
  const mul = dir === "asc" ? 1 : -1;
  if (typeof av === "number" && typeof bv === "number") {
    const tie = av - bv;
    return tie === 0 ? a.id.localeCompare(b.id) * mul : tie * mul;
  }
  const cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base", numeric: true });
  return cmp === 0 ? a.id.localeCompare(b.id) * mul : cmp * mul;
}

function formatMoney(amount: number, currency: string | null | undefined): string {
  const c = (currency || "").trim();
  const n = Number(amount || 0);
  if (!c) return n.toLocaleString();
  try {
    const fmt = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: c,
      maximumFractionDigits: c.toUpperCase() === "VND" ? 0 : 2,
    });
    return fmt.format(n);
  } catch {
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${c}`;
  }
}

function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPresetRange(preset: "7d" | "14d" | "30d" | "mtd" | "last_month"): { start: string; end: string } {
  const today = new Date();
  const end = formatLocalDate(today);

  if (preset === "7d") {
    const s = new Date(today);
    s.setDate(s.getDate() - 6);
    return { start: formatLocalDate(s), end };
  }
  if (preset === "14d") {
    const s = new Date(today);
    s.setDate(s.getDate() - 13);
    return { start: formatLocalDate(s), end };
  }
  if (preset === "30d") {
    const s = new Date(today);
    s.setDate(s.getDate() - 29);
    return { start: formatLocalDate(s), end };
  }
  if (preset === "mtd") {
    const s = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: formatLocalDate(s), end };
  }
  if (preset === "last_month") {
    const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const e = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: formatLocalDate(s), end: formatLocalDate(e) };
  }
  return { start: "", end: "" };
}

function formatExportCell(m: MetricRow, id: WarehouseColId, ctrFmt: (row: MetricRow) => string): string | number {
  switch (id) {
    case "date":
      return m.date.split("T")[0];
    case "platform":
      return PLATFORM_LABELS[m.platform] || m.platform;
    case "account":
      return m.accountName || m.accountId;
    case "campaign":
      return m.campaignName || m.campaignId;
    case "adset":
      return m.adsetName || m.adsetId || "-";
    case "ad":
      return m.adName || m.adId || "-";
    case "currency":
      return m.currency || "-";
    case "impressions":
      return m.impressions ?? 0;
    case "clicks":
      return m.clicks ?? 0;
    case "spend":
      return Number((m.spend ?? 0).toFixed(2));
    case "cpc":
      return m.cpc != null ? Number(m.cpc.toFixed(4)) : "-";
    case "ctr":
      return ctrFmt(m);
    case "conversions":
      return m.conversions ?? 0;
    case "revenue":
      return Number((m.revenue ?? 0).toFixed(2));
    case "roas":
      return m.roas != null ? Number(m.roas.toFixed(2)) : "-";
    case "reach":
      return m.reach ?? 0;
    default:
      return "";
  }
}

function renderWarehouseTableCell(
  m: MetricRow,
  col: ColumnDef,
  ctrFmt: (row: MetricRow) => string,
  stickyInfo?: { isSticky: boolean; left: number; isLastSticky: boolean },
  maxVals?: { maxSpend: number; maxRevenue: number; maxImpressions: number; maxClicks: number; maxConversions: number },
): React.ReactNode {
  const alignRight = col.group === "metric";

  let microBarPct: number | null = null;
  let microBarColor = "bg-white/[0.04]";

  if (col.id === "spend" && maxVals?.maxSpend && (m.spend ?? 0) > 0) {
    microBarPct = Math.round(((m.spend ?? 0) / maxVals.maxSpend) * 100);
    microBarColor = "bg-blue-500/15";
  } else if (col.id === "revenue" && maxVals?.maxRevenue && (m.revenue ?? 0) > 0) {
    microBarPct = Math.round(((m.revenue ?? 0) / maxVals.maxRevenue) * 100);
    microBarColor = "bg-emerald-500/15";
  } else if (col.id === "impressions" && maxVals?.maxImpressions && (m.impressions ?? 0) > 0) {
    microBarPct = Math.round(((m.impressions ?? 0) / maxVals.maxImpressions) * 100);
    microBarColor = "bg-white/[0.05]";
  } else if (col.id === "clicks" && maxVals?.maxClicks && (m.clicks ?? 0) > 0) {
    microBarPct = Math.round(((m.clicks ?? 0) / maxVals.maxClicks) * 100);
    microBarColor = "bg-purple-500/15";
  } else if (col.id === "conversions" && maxVals?.maxConversions && (m.conversions ?? 0) > 0) {
    microBarPct = Math.round(((m.conversions ?? 0) / maxVals.maxConversions) * 100);
    microBarColor = "bg-emerald-500/15";
  }

  const wrap = (node: React.ReactNode) => (
    <td
      style={stickyInfo?.isSticky ? { left: `${stickyInfo.left}px`, position: "sticky", zIndex: 10 } : undefined}
      className={cn(
        "relative px-4 py-3 text-ink transition-colors",
        alignRight ? "text-right tabular-nums" : "max-w-[180px] truncate",
        stickyInfo?.isSticky && "bg-panel z-10",
        stickyInfo?.isLastSticky && "border-r border-line shadow-[3px_0_6px_-2px_rgba(0,0,0,0.6)]",
      )}
    >
      {microBarPct !== null && (
        <div
          className={cn("absolute inset-y-1.5 right-1 rounded pointer-events-none transition-all duration-300", microBarColor)}
          style={{ width: `${Math.min(microBarPct, 100)}%` }}
        />
      )}
      <span className="relative z-10">{node}</span>
    </td>
  );

  switch (col.id) {
    case "date":
      return wrap(m.date.split("T")[0]);
    case "platform":
      return wrap(
        <span
          className={cn(
            "inline-flex rounded-lg px-2 py-0.5 text-xs font-medium",
            PLATFORM_COLORS[m.platform] || "border border-line bg-panel text-ink",
          )}
        >
          {PLATFORM_LABELS[m.platform] || m.platform}
        </span>,
      );
    case "account":
      return wrap(m.accountName || m.accountId);
    case "campaign":
      return wrap(m.campaignName || m.campaignId);
    case "adset":
      return wrap(m.adsetName || m.adsetId || "—");
    case "ad":
      return wrap(m.adName || m.adId || "—");
    case "currency":
      return wrap(m.currency || "—");
    case "impressions":
      return wrap(m.impressions?.toLocaleString() ?? "0");
    case "clicks":
      return wrap(m.clicks?.toLocaleString() ?? "0");
    case "spend":
      return wrap(formatMoney(m.spend ?? 0, m.currency));
    case "cpc":
      return wrap(m.cpc != null ? formatMoney(m.cpc, m.currency) : "—");
    case "ctr":
      return wrap(ctrFmt(m));
    case "conversions":
      return wrap(m.conversions?.toFixed(0) ?? "0");
    case "revenue":
      return wrap(formatMoney(m.revenue ?? 0, m.currency));
    case "roas":
      return wrap(
        <span
          className={cn(
            "font-medium",
            (m.roas ?? 0) >= 2
              ? "text-emerald-400"
              : (m.roas ?? 0) >= 1
                ? "text-blue-400"
                : "text-red-400",
          )}
        >
          {m.roas != null ? `${m.roas.toFixed(2)}x` : "—"}
        </span>,
      );
    case "reach":
      return wrap(m.reach?.toLocaleString() ?? "0");
    default:
      return wrap("—");
  }
}

function ToggleChip({
  active,
  onToggle,
  children,
}: {
  active: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-white/20 bg-white/[0.08] text-ink"
          : "border-line bg-canvas text-ink-mute hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

export function WarehouseWorkbench() {
  const { activeWorkspaceId } = useWorkspaceStore();

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState("");
  const [accountFilterIds, setAccountFilterIds] = useState<string[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [isRefreshOpen, setIsRefreshOpen] = useState(false);

  const [allMetrics, setAllMetrics] = useState<MetricRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  /** Warehouse table: which columns show, sort, quick row filter. */
  const [visibleColIds, setVisibleColIds] = useState<WarehouseColId[]>(() =>
    WAREHOUSE_COLUMNS.filter((c) => c.defaultOn).map((c) => c.id),
  );
  const [columnWidths, setColumnWidths] = useState<Partial<Record<WarehouseColId, number>>>({});
  const [draggedColumn, setDraggedColumn] = useState<WarehouseColId | null>(null);
  const [sortColumn, setSortColumn] = useState<WarehouseColId>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [rowSearch, setRowSearch] = useState("");

  useEffect(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    setEndDate(end.toISOString().split("T")[0]);
    setStartDate(start.toISOString().split("T")[0]);
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("monstera:warehouse-columns");
      if (!saved) return;
      const value = JSON.parse(saved) as { order?: WarehouseColId[]; widths?: Partial<Record<WarehouseColId, number>> };
      if (value.order?.length) {
        const valid = value.order.filter((id) => WAREHOUSE_COLUMNS.some((col) => col.id === id));
        if (valid.length) setVisibleColIds(valid);
      }
      if (value.widths) setColumnWidths(value.widths);
    } catch { /* use defaults */ }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("monstera:warehouse-columns", JSON.stringify({ order: visibleColIds, widths: columnWidths }));
  }, [visibleColIds, columnWidths]);

  const platformsUrl = useMemo(() => {
    if (!activeWorkspaceId) return null;
    return `/api/metrics/platforms?workspaceId=${activeWorkspaceId}`;
  }, [activeWorkspaceId]);

  const accountsFilterUrl = useMemo(() => {
    if (!activeWorkspaceId) return null;
    return `/api/metrics/accounts?workspaceId=${activeWorkspaceId}`;
  }, [activeWorkspaceId]);

  const { data: platformsData } = useSWR(platformsUrl, fetcher);
  const catalogUrl = useMemo(
    () => activeWorkspaceId ? `/api/data-explorer/shopee-catalog?workspaceId=${activeWorkspaceId}` : null,
    [activeWorkspaceId],
  );
  const { data: shopeeCatalog, isLoading: shopeeCatalogLoading } = useSWR(catalogUrl, fetcher);
  const {
    data: accountsDimensions,
    isLoading: accountsDimensionsLoading,
  } = useSWR(accountsFilterUrl, fetcher);

  const dateRangeError = useMemo(() => {
    if (!startDate || !endDate) return null;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
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
    if (accountFilterIds.length === 1) params.set("accountId", accountFilterIds[0]);
    else if (accountFilterIds.length > 1) params.set("accountIds", accountFilterIds.join(","));
    return `/api/metrics/query?${params.toString()}`;
  }, [activeWorkspaceId, startDate, endDate, selectedPlatform, accountFilterIds, dateRangeError]);

  const { data, error, isLoading, mutate } = useSWR(queryUrl, fetcher, {
    refreshInterval: 60000,
    onSuccess: (newData) => {
      setAllMetrics(newData?.metrics || []);
      setCursor(newData?.pagination?.nextCursor || null);
      setHasMore(newData?.pagination?.hasMore || false);
    },
  });

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
      console.error(e);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const metrics = allMetrics;
  const summary = data?.summary;

  const visibleColumnsOrdered = useMemo(
    () => visibleColIds.map((id) => WAREHOUSE_COLUMNS.find((c) => c.id === id)).filter(Boolean) as ColumnDef[],
    [visibleColIds],
  );
  const visibleColSet = useMemo(() => new Set(visibleColIds), [visibleColIds]);

  const activePresetId = useMemo<ColumnPresetId | "custom">(() => {
    const currentSet = new Set(visibleColIds);
    for (const preset of COLUMN_PRESETS) {
      if (preset.columns.length === visibleColIds.length && preset.columns.every((c) => currentSet.has(c))) {
        return preset.id;
      }
    }
    return "custom";
  }, [visibleColIds]);

  const activePresetLabel = useMemo(() => {
    if (activePresetId === "custom") {
      return `Custom (${visibleColIds.length})`;
    }
    return COLUMN_PRESETS.find((p) => p.id === activePresetId)?.label || "Presets";
  }, [activePresetId, visibleColIds.length]);

  const applyColumnPreset = (presetId: ColumnPresetId) => {
    const p = COLUMN_PRESETS.find((preset) => preset.id === presetId);
    if (p) {
      setVisibleColIds([...p.columns]);
    }
  };

  const stickyOffsets = useMemo(() => {
    const offsets: Record<number, { isSticky: boolean; left: number; isLastSticky: boolean }> = {};
    let accumulatedLeft = 0;
    const freezeCount = Math.min(2, visibleColumnsOrdered.length);
    for (let i = 0; i < visibleColumnsOrdered.length; i++) {
      const col = visibleColumnsOrdered[i];
      const width = columnWidths[col.id] ?? (col.group === "metric" ? 112 : 160);
      if (i < freezeCount) {
        offsets[i] = {
          isSticky: true,
          left: accumulatedLeft,
          isLastSticky: i === freezeCount - 1,
        };
        accumulatedLeft += width;
      } else {
        offsets[i] = {
          isSticky: false,
          left: 0,
          isLastSticky: false,
        };
      }
    }
    return offsets;
  }, [visibleColumnsOrdered, columnWidths]);

  const processedRows = useMemo(() => {
    let rows = metrics;
    const q = rowSearch.trim().toLowerCase();
    if (q) rows = rows.filter((m) => rowSearchBlob(m).includes(q));
    if (sortColumn) {
      rows = [...rows].sort((a, b) => compareRowsForSort(a, b, sortColumn, sortDir));
    }
    return rows;
  }, [metrics, rowSearch, sortColumn, sortDir]);

  const tableDisplayRows = useMemo(() => processedRows.slice(0, 100), [processedRows]);

  const metricMaxValues = useMemo(() => {
    let maxSpend = 0;
    let maxRevenue = 0;
    let maxImpressions = 0;
    let maxClicks = 0;
    let maxConversions = 0;
    for (const m of tableDisplayRows) {
      if ((m.spend ?? 0) > maxSpend) maxSpend = m.spend ?? 0;
      if ((m.revenue ?? 0) > maxRevenue) maxRevenue = m.revenue ?? 0;
      if ((m.impressions ?? 0) > maxImpressions) maxImpressions = m.impressions ?? 0;
      if ((m.clicks ?? 0) > maxClicks) maxClicks = m.clicks ?? 0;
      if ((m.conversions ?? 0) > maxConversions) maxConversions = m.conversions ?? 0;
    }
    return { maxSpend, maxRevenue, maxImpressions, maxClicks, maxConversions };
  }, [tableDisplayRows]);

  const availablePlatforms: string[] =
    platformsData?.platforms || summary?.platforms || [];

  const warehousedAccounts: Array<{ accountId: string; platform: string; accountName?: string }> =
    useMemo(() => accountsDimensions?.accounts ?? [], [accountsDimensions]);

  const accountsForChipPicker = useMemo(() => {
    if (!selectedPlatform) return warehousedAccounts;
    return warehousedAccounts.filter((a) => a.platform === selectedPlatform);
  }, [warehousedAccounts, selectedPlatform]);

  const selectedPlatformLabel = selectedPlatform
    ? (PLATFORM_LABELS[selectedPlatform] || selectedPlatform)
    : null;

  const clearTableView = () => {
    setRowSearch("");
    setSelectedPlatform("");
    setAccountFilterIds([]);
  };

  useEffect(() => {
    if (!selectedPlatform) return;
    if (accountsDimensionsLoading) return;
    const allowed = new Set(
      warehousedAccounts.filter((a) => a.platform === selectedPlatform).map((a) => a.accountId),
    );
    setAccountFilterIds((prev) => {
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [selectedPlatform, warehousedAccounts, accountsDimensionsLoading]);

  const toggleAccountFilter = (id: string) => {
    setAccountFilterIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const dataGaps = useMemo(() => {
    if (!metrics.length || !startDate || !endDate) return [];
    const dateSet = new Set(metrics.map((m) => m.date.split("T")[0]));
    const gaps: string[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (days > 365) return [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      if (!dateSet.has(dateStr)) gaps.push(dateStr);
    }
    return gaps.slice(-7);
  }, [metrics, startDate, endDate]);

  const totals = useMemo(() => {
    return processedRows.reduce(
      (acc, m) => ({
        impressions: acc.impressions + (m.impressions || 0),
        clicks: acc.clicks + (m.clicks || 0),
        conversions: acc.conversions + (m.conversions || 0),
      }),
      { impressions: 0, clicks: 0, conversions: 0 },
    );
  }, [processedRows]);

  const moneyTotals = useMemo(() => {
    const byCurrency = new Map<string, { spend: number; revenue: number }>();
    for (const m of processedRows) {
      const c = (m.currency || "—").trim() || "—";
      const cur = byCurrency.get(c) ?? { spend: 0, revenue: 0 };
      cur.spend += Number(m.spend ?? 0) || 0;
      cur.revenue += Number(m.revenue ?? 0) || 0;
      byCurrency.set(c, cur);
    }
    return byCurrency;
  }, [processedRows]);

  const moneyKpiNode = useCallback(
    (kind: "spend" | "revenue") => {
      const entries = [...moneyTotals.entries()].filter(([c]) => c !== "—");
      if (entries.length === 0) return <span>—</span>;
      if (entries.length === 1) {
        const [cur, vals] = entries[0]!;
        return <span>{formatMoney(vals[kind], cur)}</span>;
      }
      const sorted = entries.sort((a, b) => (b[1][kind] ?? 0) - (a[1][kind] ?? 0));
      const top = sorted.slice(0, 2);
      const rest = sorted.length - top.length;
      return (
        <span className="inline-flex flex-col leading-tight">
          <span className="font-semibold">Mixed</span>
          <span className="text-[11px] text-ink-mute">
            {top.map(([cur, vals]) => `${cur} ${Math.round(vals[kind]).toLocaleString()}`).join(" · ")}
            {rest > 0 ? ` · +${rest}` : ""}
          </span>
        </span>
      );
    },
    [moneyTotals],
  );

  const roasKpiNode = useMemo(() => {
    const totalSpend = processedRows.reduce((s, m) => s + (m.spend ?? 0), 0);
    const totalRev = processedRows.reduce((s, m) => s + (m.revenue ?? 0), 0);
    if (!totalSpend) return <span className="text-ink-mute">—</span>;
    const val = totalRev / totalSpend;
    return (
      <span
        className={cn(
          "font-semibold",
          val >= 2 ? "text-emerald-400" : val >= 1 ? "text-blue-400" : "text-red-400"
        )}
      >
        {val.toFixed(2)}x
      </span>
    );
  }, [processedRows]);

  const ctrLabel = (m: MetricRow) => {
    if (typeof m.ctr !== "number") return "-";
    const pct = m.ctr <= 1 ? m.ctr * 100 : m.ctr;
    return `${pct.toFixed(2)}%`;
  };

  const handleExport = (format: "csv" | "excel" = "csv") => {
    if (!processedRows.length) return;
    const cols = visibleColumnsOrdered.length ? visibleColumnsOrdered : WAREHOUSE_COLUMNS;
    const rows = processedRows.map((m) => {
      const o: Record<string, string | number> = {};
      for (const c of cols) {
        o[c.label] = formatExportCell(m, c.id, ctrLabel);
      }
      return o;
    });
    if (format === "excel") downloadExcel(rows, "warehouse-export");
    else downloadCsv(rows, "warehouse-export");
  };

  const toggleRow = (id: string) => {
    const next = new Set(expandedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedRows(next);
  };

  const toggleWarehouseColumn = (id: WarehouseColId) => {
    setVisibleColIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev;
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  };

  const resetWarehouseColumns = () => {
    setVisibleColIds(WAREHOUSE_COLUMNS.filter((c) => c.defaultOn).map((c) => c.id));
    setColumnWidths({});
  };

  const reorderColumn = (from: WarehouseColId, to: WarehouseColId) => {
    if (from === to) return;
    setVisibleColIds((current) => {
      const next = [...current];
      const fromIndex = next.indexOf(from);
      const toIndex = next.indexOf(to);
      if (fromIndex < 0 || toIndex < 0) return current;
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, from);
      return next;
    });
  };

  const startResize = (id: WarehouseColId, startX: number) => {
    const startWidth = columnWidths[id] ?? (WAREHOUSE_COLUMNS.find((c) => c.id === id)?.group === "metric" ? 112 : 160);
    const onMove = (event: MouseEvent) => setColumnWidths((current) => ({ ...current, [id]: Math.max(88, Math.min(420, startWidth + event.clientX - startX)) }));
    const onEnd = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
  };

  const onSortHeaderClick = (id: WarehouseColId) => {
    if (sortColumn === id) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(id);
      const g = WAREHOUSE_COLUMNS.find((c) => c.id === id)?.group;
      setSortDir(g === "metric" ? "desc" : "asc");
    }
  };

  const formatDateDisplay = (dStr: string) => {
    if (!dStr) return "";
    try {
      const d = new Date(dStr);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch {
      return dStr;
    }
  };

  const freshnessSummary = useMemo(() => {
    const parts: string[] = [];
    if (availablePlatforms.length > 0) {
      parts.push(`${availablePlatforms.length} source${availablePlatforms.length === 1 ? "" : "s"}`);
    }
    if (warehousedAccounts.length > 0) {
      parts.push(`${warehousedAccounts.length} account${warehousedAccounts.length === 1 ? "" : "s"}`);
    }
    // Truthfulness: "Data through" is the latest ACTUAL warehouse data date
    // (workspace-wide MAX(metric date)), never the selected range end.
    const dataThrough = resolveDataThrough(summary?.dateRange?.latest ?? null);
    if (dataThrough) {
      parts.push(`Data through ${formatDateDisplay(dataThrough)}`);
    } else if (endDate) {
      parts.push("No warehouse data yet");
    }
    return parts.length > 0 ? parts.join(" · ") : "Ready";
  }, [availablePlatforms.length, warehousedAccounts.length, endDate, summary?.dateRange?.latest]);

  const shopeeCampaigns = (shopeeCatalog?.campaigns ?? []) as Array<any>;
  const shopeeProducts = (shopeeCatalog?.products ?? []) as Array<any>;
  const showShopeeCatalog = selectedPlatform === "shopee" || shopeeCampaigns.length > 0 || shopeeProducts.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* ─── 1. HEADER ─── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Warehouse</h1>
          <p className="mt-1 text-sm text-ink-mute">
            Unified performance data across connected sources.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-mute">
            <span>{freshnessSummary}</span>
            {dataGaps.length > 0 && !dateRangeError && (
              <span
                className="inline-flex items-center gap-1 font-medium text-amber-400"
                title={`Sparse data days: ${dataGaps.join(", ")}`}
              >
                <AlertCircle className="h-3 w-3" />
                Data gaps detected
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsRefreshOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-white px-3.5 py-2 text-xs font-semibold text-neutral-900 shadow-xs transition-colors hover:bg-neutral-100"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh warehouse
        </button>
      </div>

      <Suspense fallback={null}>
        <AnalystPane />
      </Suspense>

      {/* ─── 2. FILTERS ─── */}
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-3.5">
        {/* Quick Date Presets */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute mr-1">
              Date Presets:
            </span>
            {[
              { id: "7d", label: "Last 7D" },
              { id: "14d", label: "Last 14D" },
              { id: "30d", label: "Last 30D" },
              { id: "mtd", label: "This Month" },
              { id: "last_month", label: "Last Month" },
            ].map((p) => {
              const range = getPresetRange(p.id as any);
              const isActive = startDate === range.start && endDate === range.end;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setStartDate(range.start);
                    setEndDate(range.end);
                  }}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                    isActive
                      ? "bg-white text-black font-semibold shadow-xs"
                      : "border border-line/80 bg-canvas text-ink-mute hover:text-ink hover:bg-white/[0.04]"
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {(startDate || endDate || selectedPlatform || accountFilterIds.length > 0) && (
            <button
              type="button"
              onClick={() => {
                const def = getPresetRange("30d");
                setStartDate(def.start);
                setEndDate(def.end);
                setSelectedPlatform("");
                setAccountFilterIds([]);
              }}
              className="text-xs text-ink-mute hover:text-ink transition-colors cursor-pointer"
            >
              Reset filters
            </button>
          )}
        </div>

        {/* Inputs row */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-ink-mute">From</label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8.5 w-36 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-ink-mute">To</label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8.5 w-36 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-ink-mute">Platform</label>
            <Dropdown
              value={selectedPlatform}
              onChange={setSelectedPlatform}
              options={PLATFORM_OPTIONS.map((opt) => {
                if (!opt.value) return opt;
                const hasData = availablePlatforms.includes(opt.value);
                return hasData ? opt : { ...opt, description: "No data yet" };
              })}
              placeholder="All platforms"
              className="w-[220px] min-w-[220px] max-w-full"
            />
          </div>
        {warehousedAccounts.length > 0 && (
          <div className="flex min-w-[200px] flex-1 flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-mute">Account</span>
              {accountFilterIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAccountFilterIds([])}
                  className="text-[11px] text-ink-mute hover:text-ink"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex max-h-16 flex-wrap gap-1.5 overflow-y-auto">
              {accountsForChipPicker.slice(0, 6).map((a) => (
                <ToggleChip
                  key={`${a.platform}-${a.accountId}`}
                  active={accountFilterIds.includes(a.accountId)}
                  onToggle={() => toggleAccountFilter(a.accountId)}
                >
                  {a.accountName || a.accountId}
                </ToggleChip>
              ))}
              {accountsForChipPicker.length > 6 && (
                <span className="self-center text-xs text-ink-mute">
                  +{accountsForChipPicker.length - 6} more
                </span>
              )}
            </div>
          </div>
        )}
        </div>
      </div>

      {dateRangeError && (
        <div className="flex items-start gap-2 rounded-md border border-red-900/50 bg-red-950/30 px-3.5 py-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-xs text-red-300">{dateRangeError}</p>
        </div>
      )}

      {/* ─── 3. SUMMARY METRICS ─── */}
      {metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
          {([
            ["Spend", moneyKpiNode("spend")],
            ["Impressions", `${(totals.impressions / 1000).toFixed(1)}K`],
            ["Clicks", totals.clicks.toLocaleString()],
            ["Conversions", totals.conversions.toFixed(0)],
            ["Revenue", moneyKpiNode("revenue")],
            ["ROAS", roasKpiNode],
          ] as Array<[string, React.ReactNode]>).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-line bg-panel px-4 py-3">
              <p className="text-xs font-medium text-ink-mute">{k}</p>
              <p className="mt-1 text-base font-semibold text-ink">{v}</p>
            </div>
          ))}
        </div>
      )}

      {/* Catalog identities are warehouse records, not zero-valued metrics. */}
      {showShopeeCatalog && (
        <section className="overflow-hidden rounded-lg border border-line bg-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">Shopee catalog</h2>
              <p className="mt-0.5 text-xs text-ink-mute">Campaign and product identities stored separately from performance metrics.</p>
            </div>
            {shopeeCatalog?.lastRun ? <span className="text-xs text-ink-mute">Last catalog call: {shopeeCatalog.lastRun.status} · {new Date(shopeeCatalog.lastRun.startedAt).toLocaleString()}</span> : null}
          </div>
          {selectedPlatform === "shopee" && metrics.length === 0 ? (
            <div className="border-b border-line bg-amber-950/20 px-4 py-2.5 text-xs text-amber-100">
              No Shopee Ads performance was returned for the selected range. This is valid for a sandbox with zero activity and is different from catalog synchronization.
            </div>
          ) : null}
          <div className="grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
            <div className="p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-mute">Campaigns ({shopeeCampaigns.length})</h3>
              {shopeeCampaigns.length === 0 ? <p className="text-xs text-ink-mute">No campaign identities synchronized yet. Apply the catalog migration, then refresh the Shopee source.</p> : (
                <div className="space-y-2">
                  {shopeeCampaigns.slice(0, 8).map((campaign: any) => (
                    <div key={campaign.id} className="rounded-md border border-line bg-canvas px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">Campaign {campaign.externalCampaignId}</span><span className="text-amber-300">Shopee {campaign.environment === "sandbox" ? "Sandbox" : "Production"}</span></div>
                      <p className="mt-1 text-ink-mute">{campaign.adType} · shop {campaign.shopId} · {campaign.region} · {campaign.campaignStatus || "status unavailable"}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-mute">Products ({shopeeProducts.length})</h3>
              {shopeeProducts.length === 0 ? <p className="text-xs text-ink-mute">No product identities synchronized yet. Apply the catalog migration, then refresh the Shopee source.</p> : (
                <div className="space-y-2">
                  {shopeeProducts.slice(0, 8).map((product: any) => (
                    <div key={product.id} className="rounded-md border border-line bg-canvas px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">Item {product.externalItemId}</span><span className="text-amber-300">Shopee {product.environment === "sandbox" ? "Sandbox" : "Production"}</span></div>
                      <p className="mt-1 truncate text-ink-mute">{product.itemName || "Unnamed product"} · {product.itemStatus || "status unavailable"} · shop {product.shopId}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ─── 4. WAREHOUSE DATA TABLE ─── */}
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        {/* Table toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Warehouse data</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute" />
              <input
                type="search"
                value={rowSearch}
                onChange={(e) => setRowSearch(e.target.value)}
                placeholder="Search warehouse data…"
                className="h-8 w-44 rounded-md border border-line bg-canvas pl-8 pr-3 text-xs text-ink placeholder:text-ink-mute/60 focus:border-white/20 focus:outline-none"
              />
            </div>
            {/* View Preset Switcher */}
            <details className="group relative">
              <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 text-xs font-medium text-ink-mute hover:text-ink [&::-webkit-details-marker]:hidden">
                <Sparkles className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.5} />
                <span>{activePresetLabel}</span>
                <ChevronDown className="h-3 w-3" />
              </summary>
              <div className="absolute right-0 top-[calc(100%+4px)] z-30 w-56 rounded-md border border-line bg-panel p-1.5 shadow-xl">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
                  View Presets
                </div>
                {COLUMN_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyColumnPreset(preset.id)}
                    className={cn(
                      "w-full rounded px-2 py-1.5 text-left text-xs transition-colors flex flex-col cursor-pointer",
                      activePresetId === preset.id
                        ? "bg-white/[0.08] text-white font-medium"
                        : "text-ink hover:bg-white/[0.04]"
                    )}
                  >
                    <span className="font-medium">{preset.label}</span>
                    <span className="text-[10px] text-ink-mute">{preset.description}</span>
                  </button>
                ))}
              </div>
            </details>
            <details className="group relative">
              <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 text-xs font-medium text-ink-mute hover:text-ink [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
                Columns
              </summary>
              <div className="absolute right-0 top-[calc(100%+4px)] z-30 w-64 rounded-lg border border-line bg-panel p-4 shadow-xl">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Dimensions</p>
                    <ul className="space-y-1.5">
                      {WAREHOUSE_COLUMNS.filter((c) => c.group === "dimension").sort((a, b) => a.label.localeCompare(b.label)).map((c) => (
                        <li key={c.id}>
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
                            <input
                              type="checkbox"
                              className="rounded border-line accent-white"
                              checked={visibleColSet.has(c.id)}
                              onChange={() => toggleWarehouseColumn(c.id)}
                            />
                            {c.label}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-mute">Metrics</p>
                    <ul className="space-y-1.5">
                      {WAREHOUSE_COLUMNS.filter((c) => c.group === "metric").sort((a, b) => a.label.localeCompare(b.label)).map((c) => (
                        <li key={c.id}>
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
                            <input
                              type="checkbox"
                              className="rounded border-line accent-white"
                              checked={visibleColSet.has(c.id)}
                              onChange={() => toggleWarehouseColumn(c.id)}
                            />
                            {c.label}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="mt-3 border-t border-line pt-2">
                  <button
                    type="button"
                    onClick={resetWarehouseColumns}
                    className="text-xs font-medium text-ink-mute hover:text-ink"
                  >
                    Reset to default
                  </button>
                </div>
              </div>
            </details>
            <details className="group relative">
              <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 text-xs font-medium text-ink-mute hover:text-ink [&::-webkit-details-marker]:hidden">
                <Download className="h-3.5 w-3.5" strokeWidth={1.5} /> Export <ChevronDown className="h-3 w-3" />
              </summary>
              <div className="absolute right-0 top-[calc(100%+4px)] z-30 w-36 rounded-md border border-line bg-panel p-1 shadow-xl">
                <button type="button" onClick={() => handleExport("csv")} disabled={!processedRows.length} className="w-full rounded px-2.5 py-2 text-left text-xs text-ink hover:bg-white/[0.05] disabled:opacity-50">CSV</button>
                <button type="button" onClick={() => handleExport("excel")} disabled={!processedRows.length} className="w-full rounded px-2.5 py-2 text-left text-xs text-ink hover:bg-white/[0.05] disabled:opacity-50">Excel (.xlsx)</button>
              </div>
            </details>
          </div>
        </div>

        {/* Table state renders */}
        {isLoading ? (
          <div className="px-4 py-6" role="status" aria-live="polite" aria-busy="true">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 shrink-0 motion-safe:animate-spin motion-reduce:animate-none text-ink-mute" strokeWidth={1.5} />
              <div>
                <p className="text-sm font-medium text-ink">Loading warehouse data</p>
                <p className="mt-0.5 text-xs text-ink-mute">Applying your date, platform, and account filters.</p>
              </div>
            </div>
            <div className="mt-5 space-y-2 motion-safe:animate-pulse motion-reduce:animate-none" aria-hidden="true">
              {["96%", "88%", "92%", "80%", "90%"].map((width) => (
                <div key={width} className="flex gap-4 rounded-md border border-line/70 px-3 py-3">
                  <div className="h-3 w-28 rounded bg-white/[0.06]" />
                  <div className="h-3 flex-1 rounded bg-white/[0.06]" style={{ maxWidth: width }} />
                  <div className="h-3 w-16 rounded bg-white/[0.06]" />
                  <div className="h-3 w-20 rounded bg-white/[0.06]" />
                </div>
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-900/50 bg-red-950/30 px-3.5 py-3 text-xs text-red-300" role="alert">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                <span>Warehouse data could not load. Your saved data has not been changed.</span>
              </div>
              <button
                type="button"
                onClick={() => void mutate()}
                className="rounded-md border border-red-400/30 bg-red-950/50 px-2.5 py-1.5 font-medium text-red-100 transition-colors hover:bg-red-900/40"
              >
                Try again
              </button>
            </div>
          </div>
        ) : metrics.length === 0 && resolveWarehouseEmptyState(metrics.length, summary?.dateRange?.latest ?? null) === "no-data" ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Database className="mb-3 h-8 w-8 text-ink-mute" strokeWidth={1.5} />
            <p className="text-sm font-medium text-ink">No warehouse data yet</p>
            <p className="mt-1 max-w-xs text-xs text-ink-mute">
              Connect a source and run your first warehouse refresh.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Link
                href="/sources"
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-3 py-2 text-xs font-medium text-ink hover:bg-white/[0.04]"
              >
                <Plus className="h-3.5 w-3.5" /> Add a source
              </Link>
              <button
                type="button"
                onClick={() => setIsRefreshOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-xs font-semibold text-neutral-900 hover:bg-neutral-100"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Run refresh
              </button>
            </div>
          </div>
        ) : processedRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Database className="mb-3 h-7 w-7 text-ink-mute" strokeWidth={1.5} />
            <p className="text-sm font-medium text-ink">
              {selectedPlatformLabel ? `No ${selectedPlatformLabel} rows in this view` : "No data matches this view"}
            </p>
            <p className="mt-1 max-w-md text-xs text-ink-mute">
              {selectedPlatformLabel
                ? "Try another platform or account, widen the date range, or reset the table view."
                : "Try widening the date range, changing an account filter, or resetting the table view."}
            </p>
            <button
              type="button"
              onClick={clearTableView}
              className="mt-4 rounded-md border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-ink hover:bg-white/[0.04]"
            >
              Reset table view
            </button>
          </div>
        ) : visibleColumnsOrdered.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-ink-mute">
            Select at least one column using the Columns control above.
          </div>
        ) : (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <colgroup>
                  {visibleColumnsOrdered.map((col) => (
                    <col key={col.id} style={{ width: columnWidths[col.id] ?? (col.group === "metric" ? 112 : 160) }} />
                  ))}
                </colgroup>
                <thead className="bg-canvas/80">
                  <tr>
                    {visibleColumnsOrdered.map((col, index) => {
                      const active = sortColumn === col.id;
                      const sticky = stickyOffsets[index];
                      return (
                        <th
                          key={col.id}
                          draggable
                          onDragStart={() => setDraggedColumn(col.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => {
                            if (draggedColumn) reorderColumn(draggedColumn, col.id);
                            setDraggedColumn(null);
                          }}
                          onDragEnd={() => setDraggedColumn(null)}
                          style={sticky?.isSticky ? { left: `${sticky.left}px`, position: "sticky", zIndex: 20 } : undefined}
                          className={cn(
                            "relative select-none px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-mute transition-colors",
                            col.group === "metric" ? "text-right" : "text-left",
                            sticky?.isSticky && "bg-canvas z-20",
                            sticky?.isLastSticky && "border-r border-line shadow-[3px_0_6px_-2px_rgba(0,0,0,0.6)]"
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => onSortHeaderClick(col.id)}
                            className={cn(
                              "inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-white/[0.04]",
                              col.group === "metric" ? "w-full justify-end" : "",
                            )}
                          >
                            {col.label}
                            {active ? (
                              <span className="font-mono text-[10px] text-ink-mute">
                                {sortDir === "asc" ? "↑" : "↓"}
                              </span>
                            ) : (
                              <ArrowUpDown className="h-3 w-3 shrink-0 opacity-30" aria-hidden />
                            )}
                          </button>
                          <span
                            role="separator"
                            aria-label={`Resize ${col.label} column`}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              startResize(col.id, event.clientX);
                            }}
                            className="absolute inset-y-1 right-0 w-2 cursor-col-resize touch-none before:absolute before:inset-y-1 before:left-1/2 before:w-px before:bg-transparent hover:before:bg-white/40"
                          />
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {tableDisplayRows.map((m) => (
                    <React.Fragment key={m.id}>
                      <tr
                        className="cursor-pointer hover:bg-white/[0.02]"
                        onClick={() => toggleRow(m.id)}
                      >
                        {visibleColumnsOrdered.map((col, index) => (
                          <React.Fragment key={col.id}>
                            {renderWarehouseTableCell(m, col, ctrLabel, stickyOffsets[index], metricMaxValues)}
                          </React.Fragment>
                        ))}
                      </tr>
                      {expandedRows.has(m.id) && (
                        <tr className="bg-canvas/40">
                          <td
                            colSpan={Math.max(visibleColumnsOrdered.length, 1)}
                            className="px-4 py-3 text-xs text-ink-mute"
                          >
                            <strong className="text-ink">Ad set:</strong> {m.adsetName || m.adsetId || "—"} ·{" "}
                            <strong className="text-ink">CPC:</strong> {m.cpc != null ? formatMoney(m.cpc, m.currency) : "—"} ·{" "}
                            <strong className="text-ink">CTR:</strong> {ctrLabel(m)} ·{" "}
                            <strong className="text-ink">Synced:</strong> {new Date(m.pulledAt).toLocaleString()}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Table footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas/40 px-4 py-3">
              <span className="text-xs text-ink-mute">
                Showing {tableDisplayRows.length.toLocaleString()}
                {processedRows.length > tableDisplayRows.length
                  ? ` of ${processedRows.length.toLocaleString()} rows`
                  : ` row${processedRows.length === 1 ? "" : "s"}`}
                {data?.pagination?.totalApprox != null && ` · ~${data.pagination.totalApprox.toLocaleString()} in range`}
              </span>
              <div className="flex items-center gap-3">
                {hasMore && (
                  <SecondaryButton
                    type="button"
                    onClick={loadMore}
                    disabled={isLoadingMore}
                    className="h-7 px-2.5 text-xs"
                  >
                    {isLoadingMore ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      <>
                        Load more <ChevronDown className="ml-1 inline h-3 w-3" />
                      </>
                    )}
                  </SecondaryButton>
                )}
                <Link
                  href="/reports"
                  className="text-xs font-medium text-ink-mute transition-colors hover:text-ink"
                >
                  View sync activity →
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── 5. REFRESH WAREHOUSE MODAL ─── */}
      <RefreshWarehouseModal
        isOpen={isRefreshOpen}
        onClose={() => setIsRefreshOpen(false)}
        workspaceId={activeWorkspaceId}
        onRefreshStarted={() => {
          void mutate();
        }}
      />
    </div>
  );
}
