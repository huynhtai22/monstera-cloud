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
  Facebook,
  Globe,
  Layers,
  Plus,
  RefreshCw,
  CloudDownload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace";
import { Input } from "@/components/ui/Input";
import { PrimaryButton, SecondaryButton } from "@/components/ui";
import { Dropdown } from "@/components/ui/Dropdown";
import { downloadCsv } from "@/lib/export-utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const AD_SOURCES = ["meta_ads", "google_ads", "tiktok_business"] as const;

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
  { value: "meta_ads", label: "Meta Ads", icon: <Facebook className="h-4 w-4 text-blue-600" /> },
  { value: "tiktok_business", label: "TikTok Ads", icon: <Globe className="h-4 w-4" /> },
  { value: "google_ads", label: "Google Ads", icon: <Globe className="h-4 w-4 text-green-600" /> },
];

const PLATFORM_COLORS: Record<string, string> = {
  meta_ads: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  tiktok_ads: "bg-gray-900 text-white dark:bg-gray-800",
  tiktok_business: "bg-slate-800 text-white dark:bg-slate-700",
  google_ads: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
};

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
          ? "border-cyan-500 bg-cyan-600 text-white shadow-sm dark:border-cyan-400 dark:bg-cyan-600"
          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
      )}
    >
      {children}
    </button>
  );
}

/** Unified warehouse view: batch import + metrics explorer (replaces `/synced-data`). */
export function WarehouseWorkbench() {
  const { activeWorkspaceId } = useWorkspaceStore();

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
  const { data: accountsDimensions } = useSWR(accountsFilterUrl, fetcher);

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

  const limits = data?.limits;

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

  const availablePlatforms: string[] =
    platformsData?.platforms || summary?.platforms || [];

  const warehousedAccounts: Array<{ accountId: string; platform: string; accountName?: string }> =
    accountsDimensions?.accounts ?? [];

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
    try {
      const res = await fetch("/api/data-explorer/warehouse/import-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          since: startDate,
          until: endDate,
          items,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBatchError(payload.error || `Import batch failed (${res.status})`);
        return;
      }
      setBatchMessage(payload.message ?? "Import batch finished.");
      await mutate();
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : "Batch import failed");
    } finally {
      setBatchImporting(false);
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
    return metrics.reduce(
      (acc, m) => ({
        impressions: acc.impressions + (m.impressions || 0),
        clicks: acc.clicks + (m.clicks || 0),
        spend: acc.spend + (m.spend || 0),
        conversions: acc.conversions + (m.conversions || 0),
        revenue: acc.revenue + (m.revenue || 0),
      }),
      { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0 },
    );
  }, [metrics]);

  const ctrLabel = (m: MetricRow) => {
    if (typeof m.ctr !== "number") return "-";
    const pct = m.ctr <= 1 ? m.ctr * 100 : m.ctr;
    return `${pct.toFixed(2)}%`;
  };

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
      CPC: m.cpc?.toFixed(2) ?? "-",
      CTR: ctrLabel(m),
      Conversions: m.conversions,
      Revenue: m.revenue?.toFixed(2) ?? "-",
      ROAS: m.roas?.toFixed(2) ?? "-",
    }));
    downloadCsv(rows, "warehouse-export");
  };

  const toggleRow = (id: string) => {
    const next = new Set(expandedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedRows(next);
  };

  const metricPanelCls =
    "rounded-2xl border border-white/60 bg-white/75 p-5 shadow-[0_24px_80px_-32px_rgba(8,145,178,0.35)] backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-950/65";

  return (
    <div className="flex flex-col gap-8">
      <section className={cn(metricPanelCls, "border-cyan-200/50 dark:border-cyan-900/40")}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
              Refresh warehouse from sources
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-slate-400">
              Pull recent campaign metrics into the internal warehouse for the date range below. Meta uses your chosen range per account;
              Google Ads and TikTok use each provider&apos;s default sync window (then appear here once synced).
            </p>
          </div>
          <PrimaryButton
            type="button"
            onClick={runBatchImport}
            disabled={
              batchImporting || !activeWorkspaceId || !connections.length || selectedConnIds.size === 0 || dateRangeError != null
            }
            loading={batchImporting}
            className="rounded-xl px-5 py-2.5 font-semibold shadow-md shadow-cyan-500/20"
          >
            <CloudDownload className="mr-2 inline h-4 w-4" />
            Run selected imports
          </PrimaryButton>
        </div>

        {!activeWorkspaceId ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">Pick a workspace in the sidebar.</p>
        ) : connections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/80 p-4 text-sm dark:border-slate-600 dark:bg-slate-900/40">
            <p className="text-gray-700 dark:text-slate-300">No ad platform sources linked yet.</p>
            <Link
              href="/sources"
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-cyan-600 hover:underline dark:text-cyan-400"
            >
              <Plus className="h-4 w-4" /> Connect Meta, Google Ads, or TikTok
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {connections.map((c) => (
              <li
                key={c.id}
                className="rounded-xl border border-gray-200/80 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-900/40"
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-cyan-600"
                    checked={selectedConnIds.has(c.id)}
                    onChange={() => toggleConnImport(c)}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-gray-900 dark:text-white">{c.name}</span>
                    <span className="ml-2 text-xs text-gray-500 dark:text-slate-500">
                      {PLATFORM_LABELS[c.provider] || c.provider}
                    </span>
                    {selectedConnIds.has(c.id) && c.provider === "meta_ads" && (
                      <div className="mt-3 border-l-2 border-cyan-400/70 pl-3">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
                          Meta ad accounts (optional subset)
                        </p>
                        <p className="mb-2 text-xs text-gray-500 dark:text-slate-500">
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
                              <span className="truncate text-gray-700 dark:text-slate-300">{a.name || a.id}</span>
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

      <section className={metricPanelCls}>
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/15 to-slate-500/10 text-cyan-700 dark:text-cyan-300">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">Warehouse metrics</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400">Query stored CampaignMetric rows for this workspace.</p>
          </div>
        </div>

        {limits && (
          <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
            <span
              className={cn(
                "inline-flex items-center rounded-lg px-2.5 py-1 font-medium capitalize",
                limits.plan === "free"
                  ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  : limits.plan === "starter"
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    : limits.plan === "professional"
                      ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
              )}
            >
              {limits.plan} plan
            </span>
            <span className="text-gray-500 dark:text-slate-500">
              Max {limits.maxDateRangeDays} days · {limits.maxRowsPerQuery.toLocaleString()} rows / query
            </span>
            {limits.plan === "free" && (
              <a href="/pricing" className="text-cyan-600 hover:underline dark:text-cyan-400">
                Upgrade →
              </a>
            )}
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

        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-slate-300">
          <Filter className="h-4 w-4" />
          Filters
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className="md:col-span-2">
            <label className="mb-1.5 flex items-center text-xs font-medium text-gray-500 dark:text-slate-400">
              <Calendar className="mr-1 h-3 w-3" />
              Start
            </label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-10" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1.5 flex items-center text-xs font-medium text-gray-500 dark:text-slate-400">
              <Calendar className="mr-1 h-3 w-3" />
              End
            </label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-10" />
          </div>
          <div className="md:col-span-3">
            <label className="mb-1.5 flex text-xs font-medium text-gray-500 dark:text-slate-400">
              <Layers className="mr-1 inline h-3 w-3" />
              Platform
            </label>
            <Dropdown
              value={selectedPlatform}
              onChange={setSelectedPlatform}
              options={PLATFORM_OPTIONS.filter((opt) => opt.value === "" || availablePlatforms.includes(opt.value))}
              placeholder="All platforms"
            />
          </div>
          <div className="flex items-end gap-2 md:col-span-5">
            <PrimaryButton type="button" onClick={() => mutate()} disabled={isLoading} className="h-10 px-4">
              {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Refresh</span>
            </PrimaryButton>
            <SecondaryButton type="button" onClick={handleExport} disabled={!metrics.length} className="h-10 px-4">
              <Download className="h-4 w-4" />
              <span className="ml-2">Export</span>
            </SecondaryButton>
          </div>
        </div>

        {warehousedAccounts.length > 0 && (
          <div className="mb-6">
            <p className="mb-2 text-xs font-medium text-gray-500 dark:text-slate-400">
              Narrow by stored ad account <span className="font-normal">(optional)</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {warehousedAccounts.slice(0, 40).map((a) => (
                <ToggleChip
                  key={`${a.platform}-${a.accountId}`}
                  active={accountFilterIds.includes(a.accountId)}
                  onToggle={() => toggleAccountFilter(a.accountId)}
                >
                  <span className="opacity-80">{PLATFORM_LABELS[a.platform] ?? a.platform} · </span>
                  {a.accountName || a.accountId}
                </ToggleChip>
              ))}
            </div>
          </div>
        )}

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ["Records loaded", metrics.length.toLocaleString()],
            ["Impressions", `${(totals.impressions / 1000).toFixed(1)}k`],
            ["Spend", `$${totals.spend.toFixed(0)}`],
            ["Conv.", totals.conversions.toFixed(0)],
            ["Revenue", `$${totals.revenue.toFixed(0)}`],
          ].map(([k, v]) => (
            <div
              key={k}
              className="rounded-xl border border-cyan-500/15 bg-gradient-to-br from-white to-cyan-50/40 p-4 dark:border-cyan-500/20 dark:from-slate-900 dark:to-slate-900/70"
            >
              <p className="text-xs text-gray-500 dark:text-slate-400">{k}</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{v}</p>
            </div>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center rounded-xl border border-gray-200/80 py-16 dark:border-slate-700">
            <RefreshCw className="h-8 w-8 animate-spin text-cyan-500" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900">
            <p className="text-sm text-red-700 dark:text-red-300">Failed to load warehouse metrics.</p>
          </div>
        ) : metrics.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/60 py-14 text-center dark:border-slate-600 dark:bg-slate-900/30">
            <Database className="mx-auto mb-3 h-8 w-8 text-gray-400" />
            <p className="text-sm text-gray-600 dark:text-slate-400">No rows for this filter.</p>
            <p className="mx-auto mt-2 max-w-md text-xs text-gray-500 dark:text-slate-500">
              Run imports above or widen the date range. This view shows metrics already persisted in CampaignMetric.
            </p>
            <Link
              href="/sources"
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-cyan-600 hover:underline dark:text-cyan-400"
            >
              <Plus className="h-4 w-4" /> Add a source
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white/60 dark:border-slate-700 dark:bg-slate-950/40">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50/90 dark:bg-slate-900/70">
                  <tr>
                    {["Date", "Platform", "Account", "Campaign", "Spend", "Impr.", "Clicks", "Conv.", "ROAS"].map((h) => (
                      <th
                        key={h}
                        className={cn(
                          "px-4 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400",
                          ["Spend", "Impr.", "Clicks", "Conv.", "ROAS"].includes(h) ? "text-right" : "text-left",
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {metrics.slice(0, 100).map((m) => (
                    <React.Fragment key={m.id}>
                      <tr
                        className="cursor-pointer hover:bg-cyan-50/40 dark:hover:bg-slate-800/60"
                        onClick={() => toggleRow(m.id)}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-gray-900 dark:text-white">{m.date.split("T")[0]}</td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "inline-flex rounded-lg px-2 py-0.5 text-xs font-medium",
                              PLATFORM_COLORS[m.platform] || "bg-gray-100 text-gray-700 dark:bg-slate-800",
                            )}
                          >
                            {PLATFORM_LABELS[m.platform] || m.platform}
                          </span>
                        </td>
                        <td className="max-w-[120px] truncate px-4 py-3 text-gray-700 dark:text-slate-300">{m.accountName || m.accountId}</td>
                        <td className="max-w-[150px] truncate px-4 py-3 text-gray-700 dark:text-slate-300">{m.campaignName || m.campaignId}</td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">${m.spend?.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300">{m.impressions?.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300">{m.clicks?.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300">{m.conversions?.toFixed(0)}</td>
                        <td className="px-4 py-3 text-right">
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
                          </span>
                        </td>
                      </tr>
                      {expandedRows.has(m.id) && (
                        <tr className="bg-gray-50/70 dark:bg-slate-900/50">
                          <td colSpan={9} className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
                            <strong>Ad set:</strong> {m.adsetName || m.adsetId || "-"} · <strong>CPC:</strong> ${m.cpc?.toFixed(2)} ·
                            <strong> CTR:</strong> {ctrLabel(m)}
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
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-slate-800">
              <span className="text-xs text-gray-500 dark:text-slate-500">
                Showing {metrics.length.toLocaleString()}
                {data?.pagination?.totalApprox != null && ` of ~${data.pagination.totalApprox.toLocaleString()} approx.`}
                {hasMore ? " · more available" : ""}
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
