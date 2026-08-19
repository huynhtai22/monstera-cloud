"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  AlertCircle,
  Calendar,
  ChevronDown,
  Database,
  Download,
  Filter,
  Layers,
  Plus,
  RefreshCw,
  CloudDownload,
  Search,
  SlidersHorizontal,
  ArrowUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace";
import { Input } from "@/components/ui/Input";
import { PrimaryButton, SecondaryButton } from "@/components/ui";
import { Dropdown } from "@/components/ui/Dropdown";
import { downloadCsv } from "@/lib/export-utils";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import {
  ADS_DIMENSIONS,
  ADS_METRICS,
  ADS_CALCULATED_METRICS,
  ADS_FIELDS_BY_ID,
  getDefaultAdsExplorerSelection,
} from "@/lib/ads-field-registry";
import { describeImportJob, type ImportJobStatusView } from "@/lib/ingestion/import-job-status";
import { RunsView } from "@/components/runs/RunsView";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const AD_SOURCES = ["meta_ads", "google_ads", "tiktok_business", "shopee"] as const;

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

/** Dimensions & metrics available in the warehouse table (alphabetical labels within each group in the picker). */
const WAREHOUSE_COLUMNS: ColumnDef[] = [
  { id: "account", label: "Account", group: "dimension", defaultOn: true },
  { id: "adset", label: "Ad set", group: "dimension", defaultOn: false },
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
    // VND is typically shown without decimals; Intl handles this well but we cap to avoid noisy cents.
    const fmt = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: c,
      maximumFractionDigits: c.toUpperCase() === "VND" ? 0 : 2,
    });
    return fmt.format(n);
  } catch {
    // Unknown currency code
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${c}`;
  }
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
): React.ReactNode {
  const alignRight = col.group === "metric";
  const wrap = (node: React.ReactNode) => (
    <td
      className={cn(
        "px-4 py-3 text-gray-900 dark:text-white",
        alignRight ? "text-right tabular-nums" : "max-w-[180px] truncate",
      )}
    >
      {node}
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
            PLATFORM_COLORS[m.platform] || "bg-gray-100 text-gray-700 dark:bg-[#16181c]",
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
              ? "text-emerald-600 dark:text-emerald-400"
              : (m.roas ?? 0) >= 1
                ? "text-blue-600"
                : "text-red-600",
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

type ConnRow = { id: string; name: string; provider: string; type: string };

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
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-line bg-primary text-primary-foreground"
          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-[#2f3336] dark:bg-[#16181c] dark:text-slate-300",
      )}
    >
      {children}
    </button>
  );
}

/** Unified warehouse view: batch import + metrics explorer (replaces `/synced-data`). */
export function WarehouseWorkbench() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const defaults = useMemo(() => getDefaultAdsExplorerSelection(), []);
  const [viewMode, setViewMode] = useState<"raw" | "aggregate">("raw");

  // Aggregate builder (right sidebar)
  const [dimensions, setDimensions] = useState<string[]>(defaults.dimensions);
  const [metricsSelection, setMetricsSelection] = useState<string[]>(defaults.metrics);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<"breakdowns" | "metrics">("breakdowns");
  const [fieldSearch, setFieldSearch] = useState("");

  const [connections, setConnections] = useState<ConnRow[]>([]);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  /** Single-dropdown platform filter for metrics (still uses metrics `platform` param). */
  const [selectedPlatform, setSelectedPlatform] = useState("");
  /** Multi-select accounts for metrics grid (empty = no extra filter). */
  const [accountFilterIds, setAccountFilterIds] = useState<string[]>([]);

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [allMetrics, setAllMetrics] = useState<MetricRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  /** Batch import selection */
  const [selectedConnIds, setSelectedConnIds] = useState<Set<string>>(new Set());
  const [metaAcctPick, setMetaAcctPick] = useState<Record<string, Set<string>>>({});
  const [metaAccountsByConn, setMetaAccountsByConn] = useState<Record<string, { id: string; name: string }[]>>({});
  const [batchImporting, setBatchImporting] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<ImportJobStatusView | null>(null);

  /** Warehouse table: which columns show, sort, quick row filter (client-side, loaded rows only). */
  const [visibleColIds, setVisibleColIds] = useState<WarehouseColId[]>(() =>
    WAREHOUSE_COLUMNS.filter((c) => c.defaultOn).map((c) => c.id),
  );
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
    if (!activeWorkspaceId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/connections`);
      if (!res.ok || cancelled) return;
      const raw = await res.json();
      const list: ConnRow[] = Array.isArray(raw) ? raw : (raw.connections ?? []) || [];
      const filtered = list.filter(
        (c) => AD_SOURCES.includes(c.provider as (typeof AD_SOURCES)[number]) && c.type === "source",
      );
      setConnections(filtered);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  const fetchMetaAccounts = useCallback(async (connId: string) => {
    try {
      const res = await fetch(`/api/data-explorer/meta-accounts?connectionId=${encodeURIComponent(connId)}`);
      if (!res.ok) return;
      const data = await res.json();
      const accounts = (data.accounts ?? []) as { id: string; name: string }[];
      setMetaAccountsByConn((prev) => ({ ...prev, [connId]: accounts }));
    } catch {
      /* ignore */
    }
  }, []);

  const platformsUrl = useMemo(() => {
    if (!activeWorkspaceId) return null;
    return `/api/metrics/platforms?workspaceId=${activeWorkspaceId}`;
  }, [activeWorkspaceId]);

  const accountsFilterUrl = useMemo(() => {
    if (!activeWorkspaceId) return null;
    return `/api/metrics/accounts?workspaceId=${activeWorkspaceId}`;
  }, [activeWorkspaceId]);

  const { data: platformsData } = useSWR(platformsUrl, fetcher);
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

  const aggregateQueryUrl = useMemo(() => {
    if (!activeWorkspaceId || !startDate || !endDate || dateRangeError) return null;
    const params = new URLSearchParams({
      workspaceId: activeWorkspaceId,
      startDate,
      endDate,
      mode: "aggregate",
      dimensions: dimensions.join(","),
      metrics: metricsSelection.join(","),
    });
    if (selectedPlatform) params.set("platform", selectedPlatform);
    if (accountFilterIds.length === 1) params.set("accountId", accountFilterIds[0]);
    else if (accountFilterIds.length > 1) params.set("accountIds", accountFilterIds.join(","));
    return `/api/metrics/query?${params.toString()}`;
  }, [activeWorkspaceId, startDate, endDate, selectedPlatform, accountFilterIds, dateRangeError, dimensions, metricsSelection]);

  const { data, error, isLoading, mutate } = useSWR(queryUrl, fetcher, {
    refreshInterval: 60000,
    onSuccess: (newData) => {
      setAllMetrics(newData?.metrics || []);
      setCursor(newData?.pagination?.nextCursor || null);
      setHasMore(newData?.pagination?.hasMore || false);
    },
  });

  const {
    data: aggregateData,
    error: aggregateError,
    isLoading: aggregateLoading,
    mutate: mutateAggregate,
  } = useSWR(viewMode === "aggregate" ? aggregateQueryUrl : null, fetcher, {
    refreshInterval: 60000,
  });

  const limits = data?.limits;
  const aggLimits = aggregateData?.limits ?? limits;

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

  const aggregateRows: Array<Record<string, any>> =
    aggregateData?.mode === "aggregate" ? (aggregateData?.rows || []) : [];
  const aggregateColumns: string[] =
    aggregateData?.mode === "aggregate" ? (aggregateData?.columns || []) : [];

  const visibleColSet = useMemo(() => new Set(visibleColIds), [visibleColIds]);
  const visibleColumnsOrdered = useMemo(
    () => WAREHOUSE_COLUMNS.filter((c) => visibleColSet.has(c.id)),
    [visibleColSet],
  );

  const sortOptionsAlpha = useMemo(
    () => [...WAREHOUSE_COLUMNS].sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );

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

  const availablePlatforms: string[] =
    platformsData?.platforms || summary?.platforms || [];

  const warehousedAccounts: Array<{ accountId: string; platform: string; accountName?: string }> =
    useMemo(() => accountsDimensions?.accounts ?? [], [accountsDimensions]);

  /** When a platform is selected, only list chips for that platform so Meta + Google cannot be combined by mistake. */
  const accountsForChipPicker = useMemo(() => {
    if (!selectedPlatform) return warehousedAccounts;
    return warehousedAccounts.filter((a) => a.platform === selectedPlatform);
  }, [warehousedAccounts, selectedPlatform]);

  /** Drop account IDs that do not exist for the selected platform (avoids impossible queries like Google Ads + Meta account). */
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

  const toggleConnImport = (conn: ConnRow) => {
    const next = new Set(selectedConnIds);
    const was = next.has(conn.id);
    if (was) {
      next.delete(conn.id);
      setMetaAcctPick((p) => {
        const cp = { ...p };
        delete cp[conn.id];
        return cp;
      });
    } else {
      next.add(conn.id);
      if (conn.provider === "meta_ads") void fetchMetaAccounts(conn.id);
    }
    setSelectedConnIds(next);
    setBatchError(null);
    setBatchMessage(null);
  };

  const toggleMetaAcct = (connId: string, acctId: string) => {
    setMetaAcctPick((prev) => {
      const base = new Set(prev[connId] ?? []);
      if (base.has(acctId)) base.delete(acctId);
      else base.add(acctId);
      return { ...prev, [connId]: base };
    });
  };

  const buildBatchPayload = (): { connectionId: string; adAccountId?: string }[] => {
    const items: { connectionId: string; adAccountId?: string }[] = [];
    for (const cid of selectedConnIds) {
      const c = connections.find((x) => x.id === cid);
      if (!c) continue;
      if (c.provider !== "meta_ads") {
        items.push({ connectionId: cid });
        continue;
      }
      const picks = metaAcctPick[cid];
      const loaded = metaAccountsByConn[cid] ?? [];
      if (!loaded.length || picks == null || picks.size === 0) {
        items.push({ connectionId: cid });
        continue;
      }
      const wantAll = picks.size === loaded.length && loaded.every((a) => picks.has(a.id));
      if (wantAll) items.push({ connectionId: cid });
      else for (const id of picks) items.push({ connectionId: cid, adAccountId: id });
    }
    return items;
  };

  const applyJobPayload = useCallback(
    (jobData: {
      status?: string;
      completedItems?: number;
      totalItems?: number;
      approximateRows?: number;
      retryCount?: number;
      maxRetries?: number;
      heartbeatAt?: string | null;
      errorMsg?: string | null;
      error?: string;
      results?: Array<{ ok?: boolean; provider?: string; error?: string }>;
    }) => {
      const status = jobData.status ?? "queued";
      const view = describeImportJob({
        status,
        completedItems: jobData.completedItems,
        totalItems: jobData.totalItems,
        approximateRows: jobData.approximateRows,
        retryCount: jobData.retryCount,
        maxRetries: jobData.maxRetries,
        heartbeatAt: jobData.heartbeatAt,
        errorMsg: jobData.errorMsg ?? jobData.error,
      });
      setJobStatus(view);
      if (status === "completed") {
        const errors = jobData.results?.filter((r) => !r.ok && r.error).map((r) => `${r.provider}: ${r.error}`) ?? [];
        if (errors.length > 0) {
          setBatchError(`Some imports failed:\n${errors.join("\n")}`);
          setBatchMessage(null);
        } else {
          setBatchError(null);
          setBatchMessage(view.detail);
        }
        setBatchImporting(false);
        return "done";
      }
      if (status === "failed") {
        setBatchError(view.detail);
        setBatchMessage(null);
        setBatchImporting(false);
        return "done";
      }
      if (status === "queued") {
        setBatchImporting(false);
        setBatchMessage(null);
      } else {
        setBatchMessage(null);
      }
      return "poll";
    },
    [],
  );

  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const poll = async () => {
      attempts += 1;
      try {
        const jobRes = await fetch(`/api/data-explorer/warehouse/jobs/${encodeURIComponent(activeJobId)}`);
        if (!cancelled && jobRes.ok) {
          const jobData = await jobRes.json();
          const next = applyJobPayload(jobData);
          if (next === "done") {
            await mutate();
            return;
          }
        }
      } catch {
        /* keep polling */
      }
      if (cancelled) return;
      const delay = attempts < 40 ? 2000 : 10000;
      if (attempts >= 70) {
        setJobStatus({
          tone: "queued",
          title: "Still queued",
          detail:
            "This job is still waiting for a worker. The next run is within about 15 minutes. You can leave this page.",
        });
        setBatchImporting(false);
        return;
      }
      timer = setTimeout(poll, delay);
    };

    timer = setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeJobId, applyJobPayload, mutate]);

  const runBatchImport = async () => {
    if (!activeWorkspaceId || !startDate || !endDate || dateRangeError) {
      setBatchError("Set a valid date range first.");
      return;
    }
    const items = buildBatchPayload();
    if (!items.length) {
      setBatchError("Select at least one connection to refresh.");
      return;
    }

    setBatchImporting(true);
    setBatchError(null);
    setBatchMessage(null);
    setJobStatus(null);
    setActiveJobId(null);
    let queuedJobId: string | null = null;
    try {
      const res = await fetch("/api/data-explorer/warehouse/import-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          since: startDate,
          until: endDate,
          items,
          async: true,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBatchError(payload.error || `Import batch failed (${res.status})`);
        setBatchImporting(false);
        return;
      }

      if (payload.async && payload.jobId) {
        queuedJobId = payload.jobId;
        setActiveJobId(payload.jobId);
        applyJobPayload({
          status: payload.status || "queued",
          totalItems: payload.totalJobs ?? items.length,
          retryCount: 0,
          maxRetries: 3,
        });
        return;
      }

      const errors = payload.results?.filter((r: { ok?: boolean; error?: string }) => !r.ok && r.error).map((r: { provider?: string; error?: string }) => `${r.provider}: ${r.error}`);
      if (errors && errors.length > 0) {
        setBatchError(`Some imports failed:\n${errors.join("\n")}`);
      } else {
        setBatchMessage(payload.message ?? "Import batch finished.");
      }
      await mutate();
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : "Batch import failed");
    } finally {
      if (!queuedJobId) setBatchImporting(false);
    }
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

  const onDragStart = useCallback((id: string) => {
    setDraggingId(id);
  }, []);

  const onDropTo = useCallback(
    (target: "dimensions" | "metrics") => {
      if (!draggingId) return;
      const field: any = ADS_FIELDS_BY_ID[draggingId];
      if (!field) return;
      if (target === "dimensions") {
        if (field.kind !== "dimension") return;
        setDimensions((prev) => (prev.includes(draggingId) ? prev : [...prev, draggingId]));
      } else {
        if (field.kind !== "metric") return;
        setMetricsSelection((prev) => (prev.includes(draggingId) ? prev : [...prev, draggingId]));
      }
    },
    [draggingId],
  );

  const removeFrom = useCallback((target: "dimensions" | "metrics", id: string) => {
    if (target === "dimensions") {
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

  const moneyKpiNode = useCallback(
    (kind: "spend" | "revenue") => {
      const entries = [...moneyTotals.entries()].filter(([c]) => c !== "—");
      if (entries.length === 0) return <span>—</span>;
      if (entries.length === 1) {
        const [cur, vals] = entries[0]!;
        return <span>{formatMoney(vals[kind], cur)}</span>;
      }
      // Multi-currency: show a compact list (top 2) + count.
      const sorted = entries.sort((a, b) => (b[1][kind] ?? 0) - (a[1][kind] ?? 0));
      const top = sorted.slice(0, 2);
      const rest = sorted.length - top.length;
      return (
        <span className="inline-flex flex-col leading-tight">
          <span className="font-semibold">Mixed</span>
          <span className="text-[11px] text-gray-500 dark:text-slate-400">
            {top.map(([cur, vals]) => `${cur} ${Math.round(vals[kind]).toLocaleString()}`).join(" · ")}
            {rest > 0 ? ` · +${rest}` : ""}
          </span>
        </span>
      );
    },
    [moneyTotals],
  );

  const ctrLabel = (m: MetricRow) => {
    if (typeof m.ctr !== "number") return "-";
    const pct = m.ctr <= 1 ? m.ctr * 100 : m.ctr;
    return `${pct.toFixed(2)}%`;
  };

  const handleExport = () => {
    if (!processedRows.length) return;
    const cols = visibleColumnsOrdered.length ? visibleColumnsOrdered : WAREHOUSE_COLUMNS;
    const rows = processedRows.map((m) => {
      const o: Record<string, string | number> = {};
      for (const c of cols) {
        o[c.label] = formatExportCell(m, c.id, ctrLabel);
      }
      return o;
    });
    downloadCsv(rows, "warehouse-export");
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
      return [...prev, id].sort(
        (a, b) =>
          WAREHOUSE_COLUMNS.findIndex((c) => c.id === a) - WAREHOUSE_COLUMNS.findIndex((c) => c.id === b),
      );
    });
  };

  const resetWarehouseColumns = () => {
    setVisibleColIds(WAREHOUSE_COLUMNS.filter((c) => c.defaultOn).map((c) => c.id));
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

  const metricPanelCls =
    "rounded-lg border border-line bg-panel p-5";

  return (
    <div className="flex flex-col gap-6">
      <section className={cn(metricPanelCls, "order-2")}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Refresh warehouse from sources
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-mute">
              Pull campaign or marketplace metrics into the warehouse for the date range below. Meta, Google Ads, TikTok Ads, and Shopee
              respect this range. Queued jobs are picked up within about 15 minutes if this request cannot finish in the background.
            </p>
          </div>
          <PrimaryButton
            type="button"
            onClick={runBatchImport}
            disabled={
              batchImporting || !activeWorkspaceId || !connections.length || selectedConnIds.size === 0 || dateRangeError != null
            }
            loading={batchImporting}
            className="rounded-md px-5 py-2.5 font-semibold"
          >
            <CloudDownload className="mr-2 inline h-4 w-4" />
            Run selected imports
          </PrimaryButton>
        </div>

        {/* Date Range & Quick Presets for Ingestion */}
        <div className="mb-4 rounded-md border border-line bg-canvas p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-ink-mute" strokeWidth={1.5} />
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute">
                Sync date range
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setStartDate("2026-05-01");
                  setEndDate("2026-05-03");
                }}
                className="rounded-md border border-line bg-panel px-2.5 py-1 text-xs font-medium text-ink hover:bg-white/[0.04]"
              >
                May 1–3, 2026 (Live Meta test)
              </button>
              <button
                type="button"
                onClick={() => {
                  const end = new Date();
                  const start = new Date();
                  start.setDate(start.getDate() - 30);
                  setStartDate(start.toISOString().split("T")[0]);
                  setEndDate(end.toISOString().split("T")[0]);
                }}
                className="rounded-md border border-line bg-panel px-2.5 py-1 text-xs font-medium text-ink-mute hover:bg-white/[0.04] hover:text-ink"
              >
                Last 30 Days
              </button>
              <button
                type="button"
                onClick={() => {
                  const end = new Date();
                  const start = new Date();
                  start.setDate(start.getDate() - 90);
                  setStartDate(start.toISOString().split("T")[0]);
                  setEndDate(end.toISOString().split("T")[0]);
                }}
                className="rounded-md border border-line bg-panel px-2.5 py-1 text-xs font-medium text-ink-mute hover:bg-white/[0.04] hover:text-ink"
              >
                Last 90 Days
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-mute">Since (Start Date)</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 w-full text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-mute">Until (End Date)</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9 w-full text-xs"
              />
            </div>
          </div>
          {dateRangeError && (
            <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{dateRangeError}</p>
          )}
        </div>

        {!activeWorkspaceId ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">Pick a workspace in the sidebar.</p>
        ) : connections.length === 0 ? (
          <div className="rounded-md border border-dashed border-line bg-canvas p-4 text-sm">
            <p className="text-ink">No ad platform sources linked yet.</p>
            <Link
              href="/sources"
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-ink hover:underline"
            >
              <Plus className="h-4 w-4" /> Connect Meta, Google Ads, or TikTok
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {connections.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-line bg-canvas p-4"
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-cyan-600"
                    checked={selectedConnIds.has(c.id)}
                    onChange={() => toggleConnImport(c)}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-ink">{c.name}</span>
                    <span className="ml-2 text-xs text-ink-mute">
                      {PLATFORM_LABELS[c.provider] || c.provider}
                    </span>
                    {selectedConnIds.has(c.id) && c.provider === "meta_ads" && (
                      <div className="mt-3 border-l-2 border-line pl-3">
                        <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute">
                          Meta ad accounts (optional subset)
                        </p>
                        <p className="mb-2 text-xs text-ink-mute">
                          Leave unchecked to sync all linked accounts on this connection.
                        </p>
                        <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                          {(metaAccountsByConn[c.id] ?? []).map((a) => (
                            <label key={a.id} className="flex cursor-pointer items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={metaAcctPick[c.id]?.has(a.id) ?? false}
                                onChange={() => toggleMetaAcct(c.id, a.id)}
                                className="rounded border-gray-300 text-cyan-600"
                              />
                              <span className="truncate text-ink">{a.name || a.id}</span>
                            </label>
                          ))}
                          {selectedConnIds.has(c.id) && !(metaAccountsByConn[c.id]?.length) && (
                            <span className="text-xs text-gray-400">Loading accounts…</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}

        {jobStatus && jobStatus.tone !== "completed" && jobStatus.tone !== "failed" && (
          <div
            className={cn(
              "mt-4 rounded-lg border p-3 text-sm",
              jobStatus.tone === "running"
                ? "border-line bg-canvas text-ink"
                : "border-amber-500/30 bg-amber-950/20 text-amber-200",
            )}
          >
            <p className="font-medium">{jobStatus.title}</p>
            <p className="mt-1 whitespace-pre-line">{jobStatus.detail}</p>
          </div>
        )}
        {batchError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {batchError}
          </div>
        )}
        {batchMessage && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
            {batchMessage}
          </div>
        )}
      </section>

      <div className="order-3">
        <RunsView workspaceId={activeWorkspaceId} title="Recent warehouse runs" />
      </div>

      <section className={cn(metricPanelCls, "order-1")}>
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-canvas text-ink">
            <Database className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">Warehouse metrics</h2>
            <p className="text-sm text-ink-mute">Query stored CampaignMetric rows for this workspace.</p>
          </div>
        </div>

        {aggLimits && (
          <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
            <span
              className={cn(
                "inline-flex items-center rounded-lg px-2.5 py-1 font-medium capitalize",
                aggLimits.plan === "free"
                  ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  : aggLimits.plan === "starter"
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    : aggLimits.plan === "professional"
                      ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
              )}
            >
              {aggLimits.plan} plan
            </span>
            <span className="text-ink-mute">
              {aggLimits.maxRowsPerQuery.toLocaleString()} rows / query (rewind is unrestricted)
            </span>
          </div>
        )}

        {dateRangeError && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800/50 dark:bg-red-950/30">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 text-red-500" />
              <p className="text-sm font-medium text-red-900 dark:text-red-100">{dateRangeError}</p>
            </div>
          </div>
        )}

        {dataGaps.length > 0 && !dateRangeError && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/50 dark:bg-amber-950/30">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 text-amber-500" />
              <p className="text-sm text-amber-900 dark:text-amber-100">
                Sparse days (sample): {dataGaps.join(", ")} — run an import above or verify live campaigns.
              </p>
            </div>
          </div>
        )}

        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-ink">
          <Filter className="h-4 w-4" strokeWidth={1.5} />
          Filters
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className="md:col-span-2">
            <label className="mb-1.5 flex items-center text-xs font-medium text-ink-mute">
              <Calendar className="mr-1 h-3 w-3" strokeWidth={1.5} />
              Start
            </label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-10" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1.5 flex items-center text-xs font-medium text-ink-mute">
              <Calendar className="mr-1 h-3 w-3" strokeWidth={1.5} />
              End
            </label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-10" />
          </div>
          <div className="md:col-span-3">
            <label className="mb-1.5 flex text-xs font-medium text-ink-mute">
              <Layers className="mr-1 inline h-3 w-3" strokeWidth={1.5} />
              Platform
            </label>
            <Dropdown
              value={selectedPlatform}
              onChange={setSelectedPlatform}
              options={PLATFORM_OPTIONS.map((opt) => {
                if (!opt.value) return opt;
                const hasData = availablePlatforms.includes(opt.value);
                return hasData
                  ? opt
                  : {
                      ...opt,
                      description: "No stored rows yet — run import above",
                    };
              })}
              placeholder="All platforms"
            />
          </div>
          <div className="flex items-end gap-2 md:col-span-5">
            <Dropdown
              value={viewMode}
              onChange={(v) => setViewMode(v as "raw" | "aggregate")}
              options={[
                { value: "raw", label: "Raw rows" },
                { value: "aggregate", label: "Aggregate (normalized)" },
              ]}
              className="min-w-[180px]"
            />
            <PrimaryButton type="button" onClick={() => mutate()} disabled={isLoading} className="h-10 px-4">
              {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Refresh</span>
            </PrimaryButton>
            <SecondaryButton type="button" onClick={handleExport} disabled={!processedRows.length} className="h-10 px-4">
              <Download className="h-4 w-4" />
              <span className="ml-2">Export</span>
            </SecondaryButton>
          </div>
        </div>

        {viewMode === "aggregate" && (
          <>
            <aside className="mb-6 rounded-lg border border-line bg-panel lg:fixed lg:right-6 lg:top-[140px] lg:mb-0 lg:w-[340px]">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink">Customize table</p>
                  <p className="text-xs text-ink-mute">Breakdowns &amp; metrics</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSidebarOpen((v) => !v)}
                  className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-xs font-medium text-ink-mute hover:text-ink"
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
                          ? "bg-primary text-primary-foreground"
                          : "border border-line bg-canvas text-ink-mute hover:text-ink",
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
                          ? "bg-primary text-primary-foreground"
                          : "border border-line bg-canvas text-ink-mute hover:text-ink",
                      )}
                    >
                      Metrics
                    </button>
                  </div>

                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium text-gray-500 dark:text-slate-400">
                      {sidebarTab === "breakdowns" ? "Selected breakdowns" : "Selected metrics"}
                    </p>
                    <div
                      className="rounded-xl border border-gray-200 bg-gray-50 p-2 dark:border-[#2f3336] dark:bg-[#000000]/20"
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
                          className="mb-1 flex items-center justify-between rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-[#2f3336] dark:bg-[#000000]"
                          title="Drag to reorder"
                        >
                          <label className="flex items-center gap-2">
                            <span className="cursor-grab select-none text-gray-400">⋮⋮</span>
                            <input
                              type="checkbox"
                              checked
                              onChange={() => removeFrom(sidebarTab === "breakdowns" ? "dimensions" : "metrics", id)}
                            />
                            <span className="font-medium text-gray-900 dark:text-white">
                              {(ADS_FIELDS_BY_ID as any)[id]?.label ?? id}
                            </span>
                          </label>
                          <span className="text-[10px] text-gray-500">{id}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5">
                    <p className="mb-2 text-xs font-medium text-gray-500 dark:text-slate-400">
                      {sidebarTab === "breakdowns" ? "Available breakdowns" : "Available metrics"}
                    </p>
                    <div className="max-h-[340px] overflow-auto rounded-xl border border-gray-200 dark:border-[#2f3336]">
                      {sidebarTab === "breakdowns" ? (
                        <div className="divide-y divide-gray-100 dark:divide-slate-800">
                          {filteredDims.map((f) => {
                            const selected = dimensions.includes(f.id);
                            return (
                              <div
                                key={f.id}
                                className="flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-[#16181c]/40"
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
                                  <span className="font-medium">{f.label}</span>
                                </label>
                                <button
                                  type="button"
                                  draggable
                                  onDragStart={() => onDragStart(f.id)}
                                  onDragEnd={() => setDraggingId(null)}
                                  className="cursor-grab rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-[#2f3336] dark:bg-[#000000] dark:text-slate-200"
                                >
                                  Drag
                                </button>
                              </div>
                            );
                          })}
                        </div>
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
                                  className="flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-[#16181c]/40"
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
                                    <span className="font-medium">{f.label}</span>
                                  </label>
                                  <button
                                    type="button"
                                    draggable
                                    onDragStart={() => onDragStart(f.id)}
                                    onDragEnd={() => setDraggingId(null)}
                                    className="cursor-grab rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-[#2f3336] dark:bg-[#000000] dark:text-slate-200"
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
                            {filteredCalculatedMetrics.map((f: any) => {
                              const selected = metricsSelection.includes(f.id);
                              return (
                                <div
                                  key={f.id}
                                  className="flex items-start justify-between gap-3 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-[#16181c]/40"
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
                                        <span className="font-medium">{f.label}</span>
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
                                    className="mt-0.5 cursor-grab rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-[#2f3336] dark:bg-[#000000] dark:text-slate-200"
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
              )}
            </aside>

            <div className="lg:pr-[360px]" />
          </>
        )}

        {warehousedAccounts.length > 0 && (
          <div className="mb-6">
            <p className="mb-2 text-xs font-medium text-gray-500 dark:text-slate-400">
              Narrow by stored ad account <span className="font-normal">(optional)</span>
            </p>
            {selectedPlatform ? (
              <p className="mb-2 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
                Platform filter is <span className="font-semibold">{PLATFORM_LABELS[selectedPlatform] ?? selectedPlatform}</span>
                . Only accounts with rows for that platform are listed; unrelated account chips are cleared automatically.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {accountsForChipPicker.map((a) => (
                <ToggleChip
                  key={`${a.platform}-${a.accountId}`}
                  active={accountFilterIds.includes(a.accountId)}
                  onToggle={() => toggleAccountFilter(a.accountId)}
                >
                  <span className="opacity-80">{PLATFORM_LABELS[a.platform] ?? a.platform} · </span>
                  {a.accountName || a.accountId}
                </ToggleChip>
              ))}
              {selectedPlatform && accountsForChipPicker.length === 0 && !accountsDimensionsLoading ? (
                <span className="text-xs text-amber-800 dark:text-amber-200">
                  No stored accounts for this platform yet — run an import above or choose “All platforms”.
                </span>
              ) : null}
              {accountFilterIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAccountFilterIds([])}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-600 hover:border-gray-300 dark:border-[#2f3336] dark:bg-[#000000]/40 dark:text-slate-300 dark:hover:border-slate-600"
                  title="Clear ad account filters"
                >
                  Clear account filters
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mb-4 rounded-xl border border-gray-200/80 bg-gradient-to-br from-white/90 to-slate-50/40 p-4 dark:border-[#2f3336] dark:from-slate-900/60 dark:to-slate-950/40">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-500">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Result table — columns & row layout
          </div>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-slate-400">
                Search in loaded rows
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  type="search"
                  value={rowSearch}
                  onChange={(e) => setRowSearch(e.target.value)}
                  placeholder="Filter by any visible text in loaded rows…"
                  className="h-10 border-gray-200 bg-white pl-10 dark:border-[#2f3336] dark:bg-[#000000]"
                />
              </div>
            </div>
            <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-auto lg:min-w-[280px] lg:grid-cols-2">
              <Dropdown
                label="Sort by (A–Z list)"
                value={sortColumn}
                onChange={(v) => {
                  const id = v as WarehouseColId;
                  setSortColumn(id);
                  const g = WAREHOUSE_COLUMNS.find((c) => c.id === id)?.group;
                  setSortDir(g === "metric" ? "desc" : "asc");
                }}
                options={sortOptionsAlpha.map((c) => ({ value: c.id, label: c.label }))}
                placeholder="Column"
                className="min-w-[140px]"
              />
              <Dropdown
                label="Order"
                value={sortDir}
                onChange={(v) => setSortDir(v as "asc" | "desc")}
                options={[
                  { value: "asc", label: "Ascending (A→Z, low→high)" },
                  { value: "desc", label: "Descending (Z→A, high→low)" },
                ]}
                className="min-w-[140px]"
              />
            </div>
          </div>

          <details className="group mt-4 rounded-lg border border-gray-200/90 bg-white/70 dark:border-[#2f3336] dark:bg-[#000000]/40">
            <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-gray-800 marker:hidden dark:text-slate-200 [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4 text-ink-mute" strokeWidth={1.5} />
                Columns — dimensions & metrics (alphabetical)
                <ChevronDown className="ml-1 h-4 w-4 transition-transform [.group[open]_&]:rotate-180" />
              </span>
            </summary>
            <div className="grid gap-4 border-t border-gray-100 px-3 pb-3 pt-2 sm:grid-cols-2 dark:border-[#2f3336]">
              <div>
                <p className="mb-2 text-xs font-semibold text-gray-600 dark:text-slate-400">Dimensions</p>
                <ul className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                  {[...WAREHOUSE_COLUMNS]
                    .filter((c) => c.group === "dimension")
                    .sort((a, b) => a.label.localeCompare(b.label))
                    .map((c) => (
                      <li key={c.id}>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            className="rounded border-gray-300 text-cyan-600"
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
                <p className="mb-2 text-xs font-semibold text-gray-600 dark:text-slate-400">Metrics</p>
                <ul className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                  {[...WAREHOUSE_COLUMNS]
                    .filter((c) => c.group === "metric")
                    .sort((a, b) => a.label.localeCompare(b.label))
                    .map((c) => (
                      <li key={c.id}>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            className="rounded border-gray-300 text-cyan-600"
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
            <div className="border-t border-gray-100 px-3 py-2 dark:border-[#2f3336]">
              <button
                type="button"
                onClick={resetWarehouseColumns}
                className="text-xs font-medium text-ink hover:underline"
              >
                Reset columns to default
              </button>
            </div>
          </details>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          {([
            [
              rowSearch.trim() ? "Rows (after search)" : "Rows (loaded)",
              `${processedRows.length.toLocaleString()}${
                metrics.length !== processedRows.length ? ` / ${metrics.length.toLocaleString()} loaded` : ""
              }`,
            ],
            ["Impressions", `${(totals.impressions / 1000).toFixed(1)}k`],
            ["Spend", moneyKpiNode("spend")],
            ["Conv.", totals.conversions.toFixed(0)],
            ["Revenue", moneyKpiNode("revenue")],
          ] as Array<[string, React.ReactNode]>).map(([k, v]) => (
            <div
              key={k}
              className="rounded-lg border border-line bg-panel p-4"
            >
              <p className="text-xs text-gray-500 dark:text-slate-400">{k}</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{v}</p>
            </div>
          ))}
        </div>

        {viewMode === "aggregate" ? (
          aggregateLoading ? (
            <div className="flex justify-center rounded-xl border border-gray-200/80 py-16 dark:border-[#2f3336]">
              <RefreshCw className="h-8 w-8 animate-spin text-ink-mute" />
            </div>
          ) : aggregateError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900">
              <p className="text-sm text-red-700 dark:text-red-300">Failed to load aggregate metrics.</p>
            </div>
          ) : aggregateRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/60 py-14 text-center dark:border-[#2f3336] dark:bg-[#000000]/30">
              <Database className="mx-auto mb-3 h-8 w-8 text-gray-400" />
              <p className="text-sm text-gray-600 dark:text-slate-400">No aggregated rows for this selection.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white/60 dark:border-[#2f3336] dark:bg-[#000000]/40 lg:pr-[360px]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50/90 dark:bg-[#000000]/70">
                    <tr>
                      {aggregateColumns.map((c) => {
                        const label = c.startsWith("metric:")
                          ? (ADS_FIELDS_BY_ID as any)[c.slice("metric:".length)]?.label ?? c
                          : (ADS_FIELDS_BY_ID as any)[c]?.label ?? c;
                        const align = c.startsWith("metric:") ? "text-right" : "text-left";
                        return (
                          <th
                            key={c}
                            className={cn(
                              "px-4 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 whitespace-nowrap",
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
                      <tr key={idx} className="hover:bg-white/[0.03]">
                        {aggregateColumns.map((c) => {
                          const v = r[c];
                          const isMetric = c.startsWith("metric:");
                          const text =
                            typeof v === "number"
                              ? v.toLocaleString(undefined, { maximumFractionDigits: 6 })
                              : String(v ?? "");
                          return (
                            <td
                              key={c}
                              className={cn(
                                "px-4 py-3 whitespace-nowrap",
                                isMetric ? "text-right tabular-nums text-gray-900 dark:text-white" : "text-gray-700 dark:text-slate-300",
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
              <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-4 py-3 text-xs text-gray-500 dark:border-[#2f3336] dark:text-slate-500">
                Showing {Math.min(aggregateRows.length, 200).toLocaleString()} rows (capped)
                <button
                  type="button"
                  onClick={() => void mutateAggregate()}
                  className="font-medium text-ink hover:underline"
                >
                  Refresh
                </button>
              </div>
            </div>
          )
        ) : isLoading ? (
          <div className="flex justify-center rounded-xl border border-gray-200/80 py-16 dark:border-[#2f3336]">
            <RefreshCw className="h-8 w-8 animate-spin text-ink-mute" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900">
            <p className="text-sm text-red-700 dark:text-red-300">Failed to load warehouse metrics.</p>
          </div>
        ) : metrics.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/60 py-14 text-center dark:border-[#2f3336] dark:bg-[#000000]/30">
            <Database className="mx-auto mb-3 h-8 w-8 text-gray-400" />
            <p className="text-sm text-gray-600 dark:text-slate-400">No rows for this filter.</p>
            <p className="mx-auto mt-2 max-w-md text-xs text-gray-500 dark:text-slate-500">
              Run imports above or widen the date range. This view shows metrics already persisted in CampaignMetric.
            </p>
            <Link
              href="/sources"
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-ink hover:underline"
            >
              <Plus className="h-4 w-4" /> Add a source
            </Link>
          </div>
        ) : processedRows.length === 0 ? (
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-4 py-8 text-center dark:border-amber-900/40 dark:bg-amber-950/20">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">No loaded rows match your search.</p>
            <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/90">
              {metrics.length.toLocaleString()} row{metrics.length === 1 ? "" : "s"} hidden — clear or change the search box.
            </p>
            <SecondaryButton type="button" className="mt-4 h-9 px-4 text-xs" onClick={() => setRowSearch("")}>
              Clear search
            </SecondaryButton>
          </div>
        ) : visibleColumnsOrdered.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-600 dark:border-[#2f3336] dark:bg-[#000000]/50 dark:text-slate-300">
            Select at least one column in <strong>Columns — dimensions &amp; metrics</strong> above.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white/60 dark:border-[#2f3336] dark:bg-[#000000]/40">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50/90 dark:bg-[#000000]/70">
                  <tr>
                    {visibleColumnsOrdered.map((col) => {
                      const active = sortColumn === col.id;
                      return (
                        <th
                          key={col.id}
                          className={cn(
                            "select-none px-4 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400",
                            col.group === "metric" ? "text-right" : "text-left",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => onSortHeaderClick(col.id)}
                            className={cn(
                              "inline-flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-gray-200/80 dark:hover:bg-[#16181c]/80",
                              col.group === "metric" ? "justify-end text-right" : "justify-start",
                            )}
                          >
                            {col.label}
                            {active ? (
                              <span className="font-mono text-[10px] text-ink-mute">
                                {sortDir === "asc" ? "↑" : "↓"}
                              </span>
                            ) : (
                              <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" aria-hidden />
                            )}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {tableDisplayRows.map((m) => (
                    <React.Fragment key={m.id}>
                      <tr
                        className="cursor-pointer hover:bg-white/[0.03]"
                        onClick={() => toggleRow(m.id)}
                      >
                        {visibleColumnsOrdered.map((col) => (
                          <React.Fragment key={col.id}>{renderWarehouseTableCell(m, col, ctrLabel)}</React.Fragment>
                        ))}
                      </tr>
                      {expandedRows.has(m.id) && (
                        <tr className="bg-gray-50/70 dark:bg-[#000000]/50">
                          <td
                            colSpan={Math.max(visibleColumnsOrdered.length, 1)}
                            className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400"
                          >
                            <strong>Ad set:</strong> {m.adsetName || m.adsetId || "-"} · <strong>CPC:</strong> $
                            {m.cpc?.toFixed(2)} ·<strong> CTR:</strong> {ctrLabel(m)}
                            ·<strong> Revenue:</strong> ${m.revenue?.toFixed(2)} ·<strong> Synced:</strong>{" "}
                            {new Date(m.pulledAt).toLocaleString()}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 px-4 py-3 dark:border-[#2f3336]">
              <span className="text-xs text-gray-500 dark:text-slate-500">
                Showing {tableDisplayRows.length.toLocaleString()}
                {processedRows.length > tableDisplayRows.length
                  ? ` of ${processedRows.length.toLocaleString()} matching rows`
                  : processedRows.length > 0
                    ? ` row${processedRows.length === 1 ? "" : "s"}`
                    : ""}
                {metrics.length > processedRows.length && rowSearch.trim() ? ` (${metrics.length.toLocaleString()} loaded)` : ""}
                {data?.pagination?.totalApprox != null && ` · ~${data.pagination.totalApprox.toLocaleString()} in range (approx.)`}
                {hasMore ? " · more available (load)" : ""}
              </span>
              {hasMore && (
                <SecondaryButton type="button" onClick={loadMore} disabled={isLoadingMore} className="h-8 px-3 text-xs">
                  {isLoadingMore ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      Load more <ChevronDown className="ml-1 inline h-3 w-3" />
                    </>
                  )}
                </SecondaryButton>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
