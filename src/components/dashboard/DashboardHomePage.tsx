"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  Database,
  Layers,
  RefreshCw,
  Share2,
  Zap,
} from "lucide-react";
import { useResolvedWorkspaceId } from "@/hooks/use-resolved-workspace-id";
import { PageShell } from "@/components/ui/PageShell";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";
import { FixConnectionModal } from "@/components/FixConnectionModal";
import { SetupWizard } from "./SetupWizard";
import type { DashboardOverviewDTO } from "@/lib/dashboard-overview";
import { cn } from "@/lib/utils";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to fetch dashboard data");
  return data;
};

function formatCompactNumber(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatCurrency(n: number, currency?: string | null): string {
  if (!Number.isFinite(n) || n === 0) return currency ? `0 ${currency}` : "$0";
  const c = (currency ?? "USD").trim().toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: c,
      maximumFractionDigits: c === "VND" ? 0 : 2,
      notation: n >= 1_000_000 ? "compact" : "standard",
    }).format(n);
  } catch {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M ${c}`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k ${c}`;
    return `${Math.round(n).toLocaleString()} ${c}`;
  }
}

function DashboardSkeleton() {
  return (
    <PageShell>
      <section aria-busy="true" aria-label="Loading dashboard" className="space-y-6">
        <p className="sr-only" role="status">Loading your workspace dashboard</p>
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div className="space-y-2">
            <div className="h-5 w-28 rounded bg-panel motion-safe:animate-pulse motion-reduce:animate-none" />
            <div className="h-3 w-56 rounded bg-panel/80 motion-safe:animate-pulse motion-reduce:animate-none" />
          </div>
          <div className="h-8 w-24 rounded-md bg-panel motion-safe:animate-pulse motion-reduce:animate-none" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-line bg-panel p-3.5">
              <div className="h-3 w-16 rounded bg-canvas motion-safe:animate-pulse motion-reduce:animate-none" />
              <div className="mt-3 h-5 w-24 rounded bg-canvas motion-safe:animate-pulse motion-reduce:animate-none" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-7">
            <div className="h-56 rounded-lg border border-line bg-panel motion-safe:animate-pulse motion-reduce:animate-none" />
            <div className="h-40 rounded-lg border border-line bg-panel motion-safe:animate-pulse motion-reduce:animate-none" />
          </div>
          <div className="space-y-6 lg:col-span-5">
            <div className="h-44 rounded-lg border border-line bg-panel motion-safe:animate-pulse motion-reduce:animate-none" />
            <div className="h-52 rounded-lg border border-line bg-panel motion-safe:animate-pulse motion-reduce:animate-none" />
          </div>
        </div>
      </section>
    </PageShell>
  );
}

export function DashboardHomePage() {
  const { workspaceId, isLoading: workspaceLoading } = useResolvedWorkspaceId();
  const [expandedRawErrorId, setExpandedRawErrorId] = useState<string | null>(null);
  const [fixTarget, setFixTarget] = useState<{
    id: string;
    name: string;
    provider: string;
    catalogId: string;
    status: string;
    errorMsg?: string;
    lastSync?: string;
  } | null>(null);

  const {
    data: overview,
    error,
    isLoading: dataLoading,
    mutate,
  } = useSWR<DashboardOverviewDTO>(
    workspaceId ? `/api/dashboard/summary?workspaceId=${workspaceId}` : null,
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: true }
  );

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await mutate();
    } finally {
      setIsRefreshing(false);
    }
  }, [mutate]);

  React.useEffect(() => {
    if (!workspaceId) return;
    try {
      setWizardDismissed(
        localStorage.getItem(`monstera_setup_wizard_dismissed_${workspaceId}`) === "1",
      );
    } catch {
      /* storage blocked — wizard stays visible */
    }
  }, [workspaceId]);

  const handleWizardDismiss = useCallback(() => {
    setWizardDismissed(true);
    if (!workspaceId) return;
    try {
      localStorage.setItem(`monstera_setup_wizard_dismissed_${workspaceId}`, "1");
    } catch {
      /* ignore */
    }
  }, [workspaceId]);

  const isLoading = workspaceLoading || (dataLoading && !overview);

  // ── Loading Skeleton ────────────────────────────────────────────────────────
  if (isLoading) {
    return <DashboardSkeleton />;
  }

  // ── Error State ─────────────────────────────────────────────────────────────
  if (error && !overview) {
    return (
      <PageShell>
        <div className="rounded-lg border border-line bg-panel p-6 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-amber-400" />
          <h3 className="mt-2 text-sm font-semibold text-ink">Dashboard temporarily unavailable</h3>
          <p className="mt-1 text-xs text-ink-mute">
            Your connected sources and warehouse data are safe. We couldn't load the operational summary.
          </p>
          <button
            type="button"
            onClick={() => mutate()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      </PageShell>
    );
  }

  const {
    summaryCards,
    needsAttention = [],
    sourcesList = [],
    warehouseSnapshot,
    destinationsList = [],
    recentActivity = [],
  } = overview || ({} as Partial<DashboardOverviewDTO>);

  return (
    <PageShell>
      <div className="space-y-6">
        {/* ── 1. Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 border-b border-line pb-5 mb-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-ink">Dashboard</h1>
            <p className="mt-0.5 text-xs text-ink-mute">
              Operational overview for this workspace
              {summaryCards?.sources?.total ? (
                <>
                  {" · "}
                  <span className="text-ink font-medium">
                    {summaryCards.sources.total} {summaryCards.sources.total === 1 ? "source" : "sources"}
                  </span>
                  {" · "}
                  <span className="text-ink font-medium">
                    {summaryCards.sources.accountsTotal ?? 0} accounts
                  </span>
                  {warehouseSnapshot?.dataThroughDate && (
                    <>
                      {" · "}
                      <span>Data through {warehouseSnapshot.dataThroughDate}</span>
                    </>
                  )}
                </>
              ) : null}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs font-medium text-ink-mute transition-colors duration-150 hover:bg-white/[0.04] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3 transition-transform duration-150", isRefreshing && "animate-spin text-ink")} />
              <span>{isRefreshing ? "Refreshing..." : "Refresh"}</span>
            </button>
            <Link
              href="/sources"
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              <span>+ Add Source</span>
            </Link>
          </div>
        </div>

        {/* ── 1b. Onboarding setup wizard ───────────────────────────────────── */}
        {!wizardDismissed && (
          <SetupWizard
            hasSource={(summaryCards?.sources?.total ?? 0) > 0}
            hasSuccessfulSync={(sourcesList ?? []).some((s) => s.lastSyncAt)}
            onDismiss={handleWizardDismiss}
          />
        )}

        {/* ── 2. Top Summary Cards (4 Clean Operational Pillars) ──────────────── */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {/* Sources Card */}
          <div className="rounded-lg border border-line bg-panel p-3.5 transition-colors duration-150 hover:border-white/20">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">Sources</span>
              <Layers className="h-3.5 w-3.5 text-ink-mute" />
            </div>
            <p className="mt-1.5 text-base font-semibold tabular-nums text-ink">
              {summaryCards?.sources?.total ?? 0} connected
            </p>
            <p className="mt-0.5 text-[11px] text-ink-mute truncate">
              {summaryCards?.sources?.subtext ?? "None connected"}
            </p>
          </div>

          {/* Warehouse Card */}
          <div className="rounded-lg border border-line bg-panel p-3.5 transition-colors duration-150 hover:border-white/20">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">Warehouse</span>
              <Database className="h-3.5 w-3.5 text-ink-mute" />
            </div>
            <p className="mt-1.5 text-base font-semibold tabular-nums text-ink flex items-center gap-1.5">
              {summaryCards?.warehouse?.status === "fresh" ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span className="text-emerald-400">Fresh</span>
                </>
              ) : summaryCards?.warehouse?.status === "refreshing" ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
                  <span className="text-sky-400">Syncing</span>
                </>
              ) : summaryCards?.warehouse?.status === "stale" ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  <span className="text-amber-400">Stale</span>
                </>
              ) : summaryCards?.warehouse?.status === "failed" ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                  <span className="text-red-400">Failed</span>
                </>
              ) : (
                <span className="text-ink-mute">—</span>
              )}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-mute truncate">
              {summaryCards?.warehouse?.dataThroughDate ? `Data through ${summaryCards.warehouse.dataThroughDate}` : "No data synced"}
            </p>
          </div>

          {/* Syncs Card */}
          <div className="rounded-lg border border-line bg-panel p-3.5 transition-colors duration-150 hover:border-white/20">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">Syncs</span>
              <Zap className="h-3.5 w-3.5 text-ink-mute" />
            </div>
            <p className="mt-1.5 text-base font-semibold tabular-nums text-ink">
              {summaryCards?.syncs?.successful7d ?? 0} successful
            </p>
            <p className="mt-0.5 text-[11px] text-ink-mute truncate">
              {summaryCards?.syncs?.failed7d && summaryCards.syncs.failed7d > 0 ? (
                <span className="text-amber-400 font-medium">{summaryCards.syncs.failed7d} failed · 7d</span>
              ) : (
                "0 failed · 7d"
              )}
            </p>
          </div>

          {/* Destinations Card */}
          <div className="rounded-lg border border-line bg-panel p-3.5 transition-colors duration-150 hover:border-white/20">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">Destinations</span>
              <Share2 className="h-3.5 w-3.5 text-ink-mute" />
            </div>
            <p className="mt-1.5 text-base font-semibold tabular-nums text-ink">
              {summaryCards?.destinations?.activeCount ?? 0} active
            </p>
            <p className="mt-0.5 text-[11px] text-ink-mute truncate">
              Sheets · Looker · API
            </p>
          </div>
        </div>

        {/* ── 3. Needs Attention (Single Dedicated Section Directly Below Summary) ── */}
        {needsAttention && needsAttention.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-mute flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Needs attention ({needsAttention.length})
              </h2>
            </div>
            <div className="space-y-1.5">
              {needsAttention.map((issue) => (
                <div
                  key={issue.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-lg border border-line bg-panel px-3.5 py-2.5 transition-colors duration-150 hover:border-white/20"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                      <h3 className="text-xs font-medium text-ink truncate">{issue.title}</h3>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-mute leading-relaxed pl-3.5">
                      {issue.explanation}
                      <span className="text-neutral-500">
                        {" · "}
                        {new Date(issue.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </p>

                    {/* Standardized inline View details expander */}
                    {issue.rawDetails && (
                      <div className="mt-1 pl-3.5">
                        <button
                          type="button"
                          onClick={() => setExpandedRawErrorId((prev) => (prev === issue.id ? null : issue.id))}
                          aria-expanded={expandedRawErrorId === issue.id}
                          className="inline-flex items-center gap-1 text-[11px] text-ink-mute hover:text-ink transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded"
                        >
                          <ChevronDown
                            className={cn(
                              "h-3 w-3 transition-transform duration-150",
                              expandedRawErrorId === issue.id && "rotate-180"
                            )}
                          />
                          <span>{expandedRawErrorId === issue.id ? "Hide technical details" : "View details"}</span>
                        </button>
                        {expandedRawErrorId === issue.id && (
                          <pre className="mt-1.5 max-h-32 overflow-x-auto rounded border border-line bg-canvas p-2 font-mono text-[10px] text-ink-mute whitespace-pre-wrap">
                            {issue.rawDetails}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {issue.actionType === "reconnect" && issue.connectionId ? (
                      <button
                        type="button"
                        onClick={() => {
                          const src = sourcesList.find((s) => s.id === issue.connectionId);
                          setFixTarget({
                            id: issue.connectionId!,
                            name: src?.name || "Source",
                            provider: issue.provider || "meta_ads",
                            catalogId: issue.provider || "meta_ads",
                            status: "error",
                            errorMsg: issue.rawDetails || issue.explanation,
                          });
                        }}
                        className="rounded-md border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/[0.06] hover:text-white transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                      >
                        {issue.actionLabel}
                      </button>
                    ) : (
                      <Link
                        href={issue.href || "/sources"}
                        className="rounded-md border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-ink hover:bg-white/[0.06] hover:text-white transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                      >
                        {issue.actionLabel}
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 4. Main Operational Layout (Sources, Warehouse, Destinations, Activity) ── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Column (7 cols): Sources & Warehouse */}
          <div className="space-y-6 lg:col-span-7">
            {/* Connected Sources */}
            <div className="rounded-lg border border-line bg-panel p-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-mute">
                  Connected sources
                </h2>
                <Link
                  href="/sources"
                  className="text-xs font-medium text-ink-mute hover:text-ink transition-colors duration-150 inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded"
                >
                  Manage sources <ArrowRight className="h-3 w-3" />
                </Link>
              </div>

              {sourcesList.length > 0 ? (
                <div className="divide-y divide-line">
                  {sourcesList.map((source) => (
                    <div key={source.id} className="flex items-center justify-between py-2.5 first:pt-2.5 last:pb-0">
                      <div className="flex items-center gap-3 min-w-0">
                        <IntegrationMark
                          src={logoPathForConnectionProvider(source.provider)}
                          alt={source.name}
                          size="md"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-ink truncate">{source.name}</p>
                          <p className="text-[11px] text-ink-mute">
                            {source.accountCount} {source.accountCount === 1 ? "account" : "accounts"}
                            {source.lastSyncAt ? ` · Last sync ${new Date(source.lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : " · Awaiting sync"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {source.state === "error" ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-400 font-medium">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                            Needs attention
                          </span>
                        ) : source.state === "fresh" ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            Healthy
                          </span>
                        ) : source.state === "syncing" ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-sky-400 font-medium">
                            <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
                            Syncing
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-mute">
                            <span className="h-1.5 w-1.5 rounded-full bg-neutral-600" />
                            Pending
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center">
                  <p className="text-xs text-ink-mute">No ad or marketplace sources connected yet.</p>
                  <Link
                    href="/sources"
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-canvas border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/[0.04] transition-colors duration-150"
                  >
                    + Connect a source
                  </Link>
                </div>
              )}
            </div>

            {/* Warehouse State */}
            <div className="rounded-lg border border-line bg-panel p-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-mute">
                    Warehouse state
                  </h2>
                  <span className="text-ink-mute">·</span>
                  <span className="text-[11px] text-ink-mute">
                    {warehouseSnapshot?.lastRefreshAt ? `Refreshed ${warehouseSnapshot.lastRefreshAt}` : "Awaiting first sync"}
                  </span>
                </div>
                <Link
                  href="/explorer"
                  className="text-xs font-medium text-ink-mute hover:text-ink transition-colors duration-150 inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded"
                >
                  Open warehouse <ArrowRight className="h-3 w-3" />
                </Link>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded border border-line bg-canvas p-2.5">
                  <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-mute">7d Spend</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                    {warehouseSnapshot?.metrics7d?.byCurrency?.length
                      ? warehouseSnapshot.metrics7d.mixedCurrency
                        ? warehouseSnapshot.metrics7d.byCurrency
                            .slice(0, 2)
                            .map((b) => formatCurrency(b.spend, b.currency))
                            .join(" · ")
                        : formatCurrency(warehouseSnapshot.metrics7d.byCurrency[0]?.spend ?? 0, warehouseSnapshot.metrics7d.byCurrency[0]?.currency)
                      : "$0"}
                  </p>
                </div>
                <div className="rounded border border-line bg-canvas p-2.5">
                  <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-mute">7d Impressions</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                    {warehouseSnapshot?.metrics7d?.impressions ? formatCompactNumber(warehouseSnapshot.metrics7d.impressions) : "0"}
                  </p>
                </div>
                <div className="rounded border border-line bg-canvas p-2.5">
                  <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-mute">7d Conversions</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                    {warehouseSnapshot?.metrics7d?.conversions ? formatCompactNumber(warehouseSnapshot.metrics7d.conversions) : "0"}
                  </p>
                </div>
                <div className="rounded border border-line bg-canvas p-2.5">
                  <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-mute">7d ROAS</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                    {warehouseSnapshot?.metrics7d?.mixedCurrency
                      ? <span className="text-ink-mute text-[11px]">Multi-currency</span>
                      : warehouseSnapshot?.metrics7d?.byCurrency?.[0]?.roas
                        ? `${warehouseSnapshot.metrics7d.byCurrency[0].roas.toFixed(2)}×`
                        : "—"}
                  </p>
                </div>
              </div>

              <div className="mt-2.5 flex items-center justify-end text-[10px] font-mono text-neutral-500">
                <span>Total rows: {summaryCards?.warehouse?.totalRows?.toLocaleString() ?? 0}</span>
              </div>
            </div>
          </div>

          {/* Right Column (5 cols): Destinations & Activity */}
          <div className="space-y-6 lg:col-span-5">
            {/* Destinations */}
            <div className="rounded-lg border border-line bg-panel p-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-mute">
                  Destinations
                </h2>
                <Link
                  href="/exports"
                  className="text-xs font-medium text-ink-mute hover:text-ink transition-colors duration-150 inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded"
                >
                  Manage <ArrowRight className="h-3 w-3" />
                </Link>
              </div>

              <div className="divide-y divide-line">
                {destinationsList.map((dest) => (
                  <Link
                    key={dest.id}
                    href={dest.href}
                    className="flex items-center justify-between py-2.5 first:pt-2 last:pb-1 group hover:text-white transition-colors duration-150"
                  >
                    <div>
                      <p className="text-xs font-medium text-ink group-hover:text-white transition-colors duration-150">{dest.name}</p>
                      <p className="text-[10px] text-ink-mute">{dest.subtext}</p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400">
                      <span className="h-1 w-1 rounded-full bg-emerald-400" />
                      {dest.status}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Recent Activity */}
            <div className="rounded-lg border border-line bg-panel p-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-mute">
                  Recent activity
                </h2>
                <Link
                  href="/reports"
                  className="text-xs font-medium text-ink-mute hover:text-ink transition-colors duration-150 inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 rounded"
                >
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </div>

              {recentActivity.length > 0 ? (
                <div className="mt-2.5 space-y-2">
                  {recentActivity.map((act) => (
                    <div key={act.id} className="flex items-start gap-2.5 text-xs py-0.5">
                      <div
                        className={cn(
                          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                          act.status === "success" && "bg-emerald-400",
                          act.status === "error" && "bg-amber-400",
                          act.status === "info" && "bg-sky-400"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-ink truncate">{act.title}</p>
                        <p className="text-[11px] text-ink-mute truncate">
                          {act.description} · {new Date(act.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center text-xs text-ink-mute">No recent sync events logged yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Fix Connection Modal ──────────────────────────────────────────────── */}
      {fixTarget && (
        <FixConnectionModal
          isOpen={Boolean(fixTarget)}
          onClose={() => setFixTarget(null)}
          connection={fixTarget}
          onReconnected={() => {
            setFixTarget(null);
            mutate();
          }}
        />
      )}
    </PageShell>
  );
}
