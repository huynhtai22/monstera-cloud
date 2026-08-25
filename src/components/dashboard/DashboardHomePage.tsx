"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  AlertTriangle,
  ArrowRight,
  Database,
  Layers,
  Plus,
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
import { PipelineArchitectureVisualizer } from "./PipelineArchitectureVisualizer";
import { CopyableBadge } from "@/components/ui/CopyableBadge";
import type { DashboardOverviewDTO } from "@/lib/dashboard-overview";
import { cn } from "@/lib/utils";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to fetch dashboard data");
  return data;
};

const PROVIDER_NAMES: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  tiktok_business: "TikTok Ads",
  shopee: "Shopee",
  lazada: "Lazada",
  shopify: "Shopify",
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

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-line bg-panel p-3.5">
              <div className="h-3 w-16 rounded bg-canvas motion-safe:animate-pulse motion-reduce:animate-none" />
              <div className="mt-3 h-5 w-24 rounded bg-canvas motion-safe:animate-pulse motion-reduce:animate-none" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-7">
            <div className="h-56 rounded-lg border border-line bg-panel motion-safe:animate-pulse motion-reduce:animate-none" />
            <div className="h-40 rounded-lg border border-line bg-panel motion-safe:animate-pulse motion-reduce:animate-none" />
          </div>
          <div className="space-y-6 xl:col-span-5">
            <div className="h-44 rounded-lg border border-line bg-panel motion-safe:animate-pulse motion-reduce:animate-none" />
            <div className="h-52 rounded-lg border border-line bg-panel motion-safe:animate-pulse motion-reduce:animate-none" />
          </div>
        </div>
      </section>
    </PageShell>
  );
}

type StatePresentation = {
  label: string;
  detail: string;
  dotClassName: string;
  textClassName: string;
};

function warehouseStatePresentation(
  status: DashboardOverviewDTO["summaryCards"]["warehouse"]["status"] | undefined,
): StatePresentation {
  switch (status) {
    case "fresh":
      return { label: "Fresh", detail: "Warehouse data is current.", dotClassName: "bg-emerald-400", textClassName: "text-emerald-400" };
    case "refreshing":
      return { label: "Syncing", detail: "A warehouse refresh is in progress.", dotClassName: "bg-sky-400", textClassName: "text-sky-400" };
    case "stale":
      return { label: "Stale", detail: "Warehouse data needs a refresh.", dotClassName: "bg-amber-400", textClassName: "text-amber-400" };
    case "partial":
      return { label: "Partial", detail: "The latest refresh completed for only some sources.", dotClassName: "bg-amber-400", textClassName: "text-amber-400" };
    case "failed":
      return { label: "Refresh failed", detail: "The latest refresh did not complete.", dotClassName: "bg-red-400", textClassName: "text-red-400" };
    default:
      return { label: "Not synced", detail: "No warehouse data has been imported yet.", dotClassName: "bg-amber-400", textClassName: "text-amber-400" };
  }
}

function sourceStatePresentation(state: DashboardOverviewDTO["sourcesList"][number]["state"]): StatePresentation {
  switch (state) {
    case "fresh":
      return { label: "Healthy", detail: "Authorized with a recent successful sync.", dotClassName: "bg-emerald-400", textClassName: "text-emerald-400" };
    case "stale":
      return { label: "Stale", detail: "The last successful sync is more than a day old.", dotClassName: "bg-amber-400", textClassName: "text-amber-400" };
    case "error":
      return { label: "Needs attention", detail: "Authorization or connection setup needs attention.", dotClassName: "bg-red-400", textClassName: "text-red-400" };
    case "partial":
      return { label: "Partial sync", detail: "Some requested data was imported; review the source before delivery.", dotClassName: "bg-amber-400", textClassName: "text-amber-400" };
    case "syncing":
      return { label: "Syncing", detail: "A warehouse sync is in progress.", dotClassName: "bg-sky-400", textClassName: "text-sky-400" };
    case "disconnected":
      return { label: "Disconnected", detail: "This source cannot sync until it is reconnected.", dotClassName: "bg-red-400", textClassName: "text-red-400" };
    case "unknown":
      return { label: "State needs review", detail: "This source has an unrecognized state and is not treated as healthy.", dotClassName: "bg-red-400", textClassName: "text-red-400" };
    default:
      return { label: "Connected — not synced", detail: "No successful warehouse sync is recorded yet.", dotClassName: "bg-amber-400", textClassName: "text-amber-400" };
  }
}

function destinationStatePresentation(
  status: DashboardOverviewDTO["destinationsList"][number]["status"],
): StatePresentation {
  switch (status) {
    case "healthy":
      return { label: "Healthy", detail: "A recent destination operation completed.", dotClassName: "bg-emerald-400", textClassName: "text-emerald-400" };
    case "active":
      return { label: "Active", detail: "The destination is configured and available.", dotClassName: "bg-emerald-400", textClassName: "text-emerald-400" };
    case "ready":
      return { label: "Ready", detail: "Configured and awaiting its first successful operation.", dotClassName: "bg-sky-400", textClassName: "text-sky-400" };
    case "syncing":
      return { label: "In progress", detail: "A destination operation is currently running.", dotClassName: "bg-sky-400", textClassName: "text-sky-400" };
    case "partial":
      return { label: "Partial", detail: "Some destination pipelines need attention.", dotClassName: "bg-amber-400", textClassName: "text-amber-400" };
    case "stale":
      return { label: "Stale", detail: "The destination has not completed recently.", dotClassName: "bg-amber-400", textClassName: "text-amber-400" };
    case "error":
      return { label: "Needs attention", detail: "The latest destination operation failed.", dotClassName: "bg-red-400", textClassName: "text-red-400" };
    default:
      return { label: "Not configured", detail: "Set up this destination to begin using it.", dotClassName: "bg-neutral-500", textClassName: "text-ink-mute" };
  }
}

function DashboardSourceRow({ source }: { source: DashboardOverviewDTO["sourcesList"][number] }) {
  const state = sourceStatePresentation(source.state);
  const lastSyncLabel = source.lastSyncAt
    ? `Last successful sync ${formatDateTime(source.lastSyncAt)}`
    : state.detail;

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-2.5 last:pb-0">
      <div className="flex min-w-0 items-center gap-3">
        <IntegrationMark src={logoPathForConnectionProvider(source.provider)} size="md" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/sources/${source.id}`}
              className="break-words text-xs font-semibold leading-snug text-ink hover:text-white transition-colors"
            >
              {source.name}
            </Link>
            {source.managerBadge && (
              <CopyableBadge
                text={source.managerBadge}
                copyValue={source.managerBadge.replace(/^\[|\]$/g, "").replace(/^(MCC|BM|BC):\s*/, "")}
                title={`Click to copy ${source.managerBadge}`}
                className="text-[10px] text-ink-mute"
              />
            )}
            {source.shortId && (
              <CopyableBadge
                text={`#${source.shortId}`}
                copyValue={source.id}
                title={`Click to copy connection ID (${source.id})`}
                className="text-[10px] text-ink-mute/60"
              />
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-ink-mute">
            {source.accountCount} {source.accountCount === 1 ? "account" : "accounts"} · {lastSyncLabel}
          </p>
        </div>
      </div>

      <span
        className={cn("inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium", state.textClassName)}
        aria-label={`${state.label}. ${state.detail}`}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", state.dotClassName, source.state === "syncing" && "motion-safe:animate-pulse motion-reduce:animate-none")} />
        {state.label}
      </span>
    </div>
  );
}

export function DashboardHomePage() {
  const { workspaceId, isLoading: workspaceLoading } = useResolvedWorkspaceId();
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
    isValidating,
    mutate,
  } = useSWR<DashboardOverviewDTO>(
    workspaceId ? `/api/dashboard/summary?workspaceId=${workspaceId}` : null,
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: true }
  );

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [manualRefreshFailed, setManualRefreshFailed] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await mutate();
      setManualRefreshFailed(false);
    } catch {
      setManualRefreshFailed(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [mutate]);

  React.useEffect(() => {
    if (!isValidating && !error && overview) setManualRefreshFailed(false);
  }, [error, isValidating, overview]);

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
  const isUpdating = isRefreshing || isValidating;

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
            disabled={isValidating}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-wait disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", isValidating && "motion-safe:animate-spin")} />
            {isValidating ? "Retrying…" : "Retry"}
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
  const warehouseState = warehouseStatePresentation(summaryCards?.warehouse?.status);
  const sourceCount = summaryCards?.sources?.total ?? 0;
  const accountCount = summaryCards?.sources?.accountsTotal ?? 0;
  const errorSourceCount = sourcesList.filter((source) => source.state === "error").length;
  const partialSourceCount = sourcesList.filter((source) => source.state === "partial").length;
  const pendingSourceCount = sourcesList.filter((source) => source.state === "pending").length;
  const syncingSourceCount = sourcesList.filter((source) => source.state === "syncing").length;
  const staleSourceCount = sourcesList.filter((source) => source.state === "stale").length;
  const disconnectedSourceCount = sourcesList.filter((source) => source.state === "disconnected").length;
  const unknownSourceCount = sourcesList.filter((source) => source.state === "unknown").length;
  const attentionSourceCount = errorSourceCount + partialSourceCount + staleSourceCount + disconnectedSourceCount + unknownSourceCount;
  const inProgressSourceCount = pendingSourceCount + syncingSourceCount;
  const accountSummary = `${accountCount} account${accountCount === 1 ? "" : "s"}`;
  const sourceSummaryDetail = attentionSourceCount
    ? `${attentionSourceCount} need attention`
    : inProgressSourceCount
      ? `${inProgressSourceCount} awaiting a successful sync`
      : sourceCount
        ? `${accountSummary} · All current`
        : "Connect a source to begin";
  const hasPeriodMetrics = (summaryCards?.warehouse?.rows7d ?? 0) > 0;
  const configuredDestinationNames = summaryCards?.destinations?.list ?? [];
  const showRefreshWarning = Boolean(overview && (error || manualRefreshFailed));

  return (
    <PageShell>
      <div className="space-y-6">
        {/* ── 1. Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 border-b border-line pb-5 mb-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">Dashboard</h1>
            <p className="mt-0.5 text-xs text-ink-mute">
              Viewing <span className="font-medium text-ink">{overview?.workspace?.name ?? "your workspace"}</span>
              {" · "}
              {sourceCount} source connection{sourceCount === 1 ? "" : "s"}
              {" · "}
              {accountCount} account{accountCount === 1 ? "" : "s"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-mute" role="status" aria-live="polite">
              <span className={cn("inline-flex items-center gap-1 font-medium", warehouseState.textClassName)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", warehouseState.dotClassName, summaryCards?.warehouse?.status === "refreshing" && "motion-safe:animate-pulse motion-reduce:animate-none")} />
                Warehouse: {warehouseState.label}
              </span>
              <span aria-hidden="true">·</span>
              <span>{warehouseSnapshot?.dataThroughDate ? `Data through ${warehouseSnapshot.dataThroughDate}` : warehouseState.detail}</span>
              {summaryCards?.syncs?.lastSyncTimeAgo && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Last successful sync {summaryCards.syncs.lastSyncTimeAgo}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isUpdating}
              className="inline-flex min-w-[92px] items-center justify-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs font-medium text-ink-mute transition-colors duration-150 hover:bg-white/[0.04] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw className={cn("h-3 w-3 transition-transform duration-150", isUpdating && "motion-safe:animate-spin text-ink")} />
              <span>{isUpdating ? "Updating…" : "Update status"}</span>
            </button>
            <Link
              href="/sources"
              data-dashboard-focus-fallback
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add Source</span>
            </Link>
          </div>
        </div>

        {showRefreshWarning && (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3.5 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-2 text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              <span>
                Dashboard update failed. Showing the last available summary; operational status may be out of date.
              </span>
            </div>
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isUpdating}
              className="self-end rounded-md border border-amber-400/30 px-2.5 py-1.5 font-semibold text-amber-100 transition-colors hover:bg-amber-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/40 disabled:cursor-wait disabled:opacity-50 sm:self-auto"
            >
              {isUpdating ? "Retrying…" : "Retry update"}
            </button>
          </div>
        )}

        {/* ── 1b. Onboarding setup wizard ───────────────────────────────────── */}
        {!wizardDismissed && (
          <SetupWizard
            hasSource={(summaryCards?.sources?.total ?? 0) > 0}
            hasSuccessfulSync={(sourcesList ?? []).some((s) => s.lastSyncAt)}
            onDismiss={handleWizardDismiss}
          />
        )}

        {/* ── 2. Performance & Spend at a Glance ─────────────────────────────── */}
        <div className="rounded-xl border border-line bg-panel p-4 sm:p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line pb-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-ink">
                Performance & Spend
              </span>
              <span className="inline-flex items-center rounded-md border border-line/80 bg-canvas px-2 py-0.5 font-mono text-[11px] text-ink-mute">
                Last 7 Days
              </span>
            </div>
            <Link
              href="/explorer"
              className="text-xs font-medium text-ink-mute hover:text-ink transition-colors duration-150 inline-flex items-center gap-1"
            >
              Open warehouse analytics <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Total Ad Spend */}
            <div className="rounded-lg border border-line bg-canvas p-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">Total Ad Spend</span>
                <span className="text-[10px] font-mono text-ink-mute/60">7D</span>
              </div>
              <p className="mt-2 text-xl font-bold tracking-tight text-ink tabular-nums">
                {!hasPeriodMetrics
                  ? "—"
                  : warehouseSnapshot?.metrics7d?.byCurrency?.length
                  ? warehouseSnapshot.metrics7d.mixedCurrency
                    ? `${warehouseSnapshot.metrics7d.byCurrency
                        .slice(0, 2)
                        .map((b) => formatCurrency(b.spend, b.currency))
                        .join(" · ")}${warehouseSnapshot.metrics7d.byCurrency.length > 2 ? ` +${warehouseSnapshot.metrics7d.byCurrency.length - 2}` : ""}`
                    : formatCurrency(warehouseSnapshot.metrics7d.byCurrency[0]?.spend ?? 0, warehouseSnapshot.metrics7d.byCurrency[0]?.currency)
                  : "—"}
              </p>
              <p className="mt-1 text-[11px] text-ink-mute">
                {hasPeriodMetrics && warehouseSnapshot?.metrics7d?.byCurrency?.length
                  ? "Combined ad channels"
                  : "Awaiting sync data"}
              </p>
            </div>

            {/* Attributed Revenue / GMV */}
            <div className="rounded-lg border border-line bg-canvas p-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">Attributed GMV / Rev</span>
                <span className="text-[10px] font-mono text-ink-mute/60">7D</span>
              </div>
              <p className="mt-2 text-xl font-bold tracking-tight text-ink tabular-nums">
                {!hasPeriodMetrics
                  ? "—"
                  : warehouseSnapshot?.metrics7d?.byCurrency?.length
                  ? warehouseSnapshot.metrics7d.mixedCurrency
                    ? `${warehouseSnapshot.metrics7d.byCurrency
                        .slice(0, 2)
                        .map((b) => formatCurrency(b.revenue, b.currency))
                        .join(" · ")}${warehouseSnapshot.metrics7d.byCurrency.length > 2 ? ` +${warehouseSnapshot.metrics7d.byCurrency.length - 2}` : ""}`
                    : formatCurrency(warehouseSnapshot.metrics7d.byCurrency[0]?.revenue ?? 0, warehouseSnapshot.metrics7d.byCurrency[0]?.currency)
                  : "—"}
              </p>
              <p className="mt-1 text-[11px] text-ink-mute">
                {hasPeriodMetrics ? "E-commerce & retail conversions" : "Awaiting sync data"}
              </p>
            </div>

            {/* Blended ROAS */}
            <div className="rounded-lg border border-line bg-canvas p-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">Blended ROAS</span>
                <span className="text-[10px] font-mono text-ink-mute/60">7D</span>
              </div>
              <p className="mt-2 text-xl font-bold tracking-tight text-ink tabular-nums">
                {!hasPeriodMetrics
                  ? "—"
                  : warehouseSnapshot?.metrics7d?.mixedCurrency
                  ? <span className="text-ink-mute text-sm font-medium">Multi-currency</span>
                  : (warehouseSnapshot?.metrics7d?.byCurrency?.[0]?.spend ?? 0) > 0
                    ? `${(warehouseSnapshot?.metrics7d?.byCurrency?.[0]?.roas ?? 0).toFixed(2)}×`
                    : "—"}
              </p>
              <p className="mt-1 text-[11px] text-ink-mute">
                {hasPeriodMetrics ? "Revenue / Spend ratio" : "Calculated from warehouse data"}
              </p>
            </div>

            {/* Paid Traffic & Conversions */}
            <div className="rounded-lg border border-line bg-canvas p-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">Traffic Volume</span>
                <span className="text-[10px] font-mono text-ink-mute/60">7D</span>
              </div>
              <p className="mt-2 text-xl font-bold tracking-tight text-ink tabular-nums">
                {hasPeriodMetrics
                  ? `${formatCompactNumber(warehouseSnapshot?.metrics7d?.impressions ?? 0)} imp`
                  : "—"}
              </p>
              <p className="mt-1 text-[11px] text-ink-mute">
                {hasPeriodMetrics
                  ? `${formatCompactNumber(warehouseSnapshot?.metrics7d?.clicks ?? 0)} clicks · ${formatCompactNumber(warehouseSnapshot?.metrics7d?.conversions ?? 0)} conv`
                  : "Impressions & clicks"}
              </p>
            </div>
          </div>

          {/* Channel Spend Distribution Bar */}
          {hasPeriodMetrics && warehouseSnapshot?.metrics7d?.byPlatform && warehouseSnapshot.metrics7d.byPlatform.length > 0 && (
            <div className="mt-4 pt-3.5 border-t border-line/60">
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                    Spend Share by Channel
                  </span>
                  <span className="font-mono text-[10px] text-ink-mute">
                    {warehouseSnapshot.metrics7d.byPlatform.length} active channel{warehouseSnapshot.metrics7d.byPlatform.length === 1 ? "" : "s"}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-canvas border border-line/80">
                  {warehouseSnapshot.metrics7d.byPlatform.map((bp) => {
                    const colorClass = bp.platform === "google_ads"
                      ? "bg-emerald-500"
                      : bp.platform === "meta_ads"
                      ? "bg-blue-500"
                      : bp.platform === "tiktok_business"
                      ? "bg-purple-500"
                      : bp.platform === "shopee"
                      ? "bg-orange-500"
                      : "bg-sky-500";
                    return (
                      <div
                        key={bp.platform}
                        style={{ width: `${Math.max(bp.percentage, 4)}%` }}
                        className={cn("h-full transition-all duration-300", colorClass)}
                        title={`${PROVIDER_NAMES[bp.platform] || bp.platform}: ${bp.percentage}% (${formatCurrency(bp.spend, bp.currency)})`}
                      />
                    );
                  })}
                </div>

                {/* Channel Labels & Pills */}
                <div className="flex flex-wrap items-center gap-4 pt-1">
                  {warehouseSnapshot.metrics7d.byPlatform.map((bp) => {
                    const dotClass = bp.platform === "google_ads"
                      ? "bg-emerald-500"
                      : bp.platform === "meta_ads"
                      ? "bg-blue-500"
                      : bp.platform === "tiktok_business"
                      ? "bg-purple-500"
                      : bp.platform === "shopee"
                      ? "bg-orange-500"
                      : "bg-sky-500";
                    const label = PROVIDER_NAMES[bp.platform] || bp.platform;
                    return (
                      <div key={bp.platform} className="flex items-center gap-1.5 text-xs">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", dotClass)} />
                        <span className="font-medium text-ink">{label}</span>
                        <span className="font-mono text-[11px] text-ink-mute">
                          {bp.percentage}% · {formatCurrency(bp.spend, bp.currency)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── 4. Operational Pillars (Sources, Warehouse, Syncs, Destinations) ── */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {/* Sources Card */}
          <div className="rounded-lg border border-line bg-panel p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">Sources</span>
              <Layers className="h-3.5 w-3.5 text-ink-mute" />
            </div>
            <p className="mt-1.5 text-base font-semibold tabular-nums text-ink">
              {sourceCount} source connection{sourceCount === 1 ? "" : "s"}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-mute truncate">
              {sourceSummaryDetail}
            </p>
          </div>

          {/* Warehouse Card */}
          <div className="rounded-lg border border-line bg-panel p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">Warehouse</span>
              <Database className="h-3.5 w-3.5 text-ink-mute" />
            </div>
            <p className="mt-1.5 text-base font-semibold tabular-nums text-ink flex items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", warehouseState.dotClassName, summaryCards?.warehouse?.status === "refreshing" && "motion-safe:animate-pulse motion-reduce:animate-none")} />
              <span className={warehouseState.textClassName}>{warehouseState.label}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-ink-mute truncate">
              {summaryCards?.warehouse?.dataThroughDate ? `Data through ${summaryCards.warehouse.dataThroughDate}` : warehouseState.detail}
            </p>
          </div>

          {/* Syncs Card */}
          <div className="rounded-lg border border-line bg-panel p-3.5">
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
          <div className="rounded-lg border border-line bg-panel p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">Destinations</span>
              <Share2 className="h-3.5 w-3.5 text-ink-mute" />
            </div>
            <p className="mt-1.5 text-base font-semibold tabular-nums text-ink">
              {summaryCards?.destinations?.activeCount ?? 0} active
            </p>
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-mute">
              {configuredDestinationNames.length > 0
                ? configuredDestinationNames.join(" · ")
                : "No active destinations"}
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
                      <h3 className="line-clamp-2 text-xs font-medium leading-snug text-ink">{issue.title}</h3>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-mute leading-relaxed pl-3.5">
                      {issue.explanation}
                      <span className="text-ink-mute">
                        {" · "}
                        {new Date(issue.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </p>

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
                            errorMsg: issue.explanation,
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
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          {/* Left Column (7 cols): Sources & Warehouse */}
          <div className="space-y-6 xl:col-span-7">
            {/* Source readiness */}
            <div className="rounded-lg border border-line bg-panel p-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-mute">
                  Source readiness
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
                    <DashboardSourceRow key={source.id} source={source} />
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
              <div className="flex flex-col gap-2 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
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

              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded border border-line bg-canvas p-2.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">7d Spend</p>
                  <p className="mt-1 break-words text-sm font-semibold leading-snug tabular-nums text-ink">
                    {!hasPeriodMetrics
                      ? "—"
                      : warehouseSnapshot?.metrics7d?.byCurrency?.length
                      ? warehouseSnapshot.metrics7d.mixedCurrency
                        ? `${warehouseSnapshot.metrics7d.byCurrency
                            .slice(0, 2)
                            .map((bucket) => formatCurrency(bucket.spend, bucket.currency))
                            .join(" · ")}${warehouseSnapshot.metrics7d.byCurrency.length > 2 ? ` · +${warehouseSnapshot.metrics7d.byCurrency.length - 2}` : ""}`
                        : formatCurrency(warehouseSnapshot.metrics7d.byCurrency[0]?.spend ?? 0, warehouseSnapshot.metrics7d.byCurrency[0]?.currency)
                      : "—"}
                  </p>
                </div>
                <div className="rounded border border-line bg-canvas p-2.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">7d Impressions</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                    {hasPeriodMetrics ? formatCompactNumber(warehouseSnapshot?.metrics7d?.impressions ?? 0) : "—"}
                  </p>
                </div>
                <div className="rounded border border-line bg-canvas p-2.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">7d Conversions</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                    {hasPeriodMetrics ? formatCompactNumber(warehouseSnapshot?.metrics7d?.conversions ?? 0) : "—"}
                  </p>
                </div>
                <div className="rounded border border-line bg-canvas p-2.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">7d ROAS</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                    {!hasPeriodMetrics
                      ? "—"
                      : warehouseSnapshot?.metrics7d?.mixedCurrency
                      ? <span className="text-ink-mute text-[11px]">Multi-currency</span>
                      : (warehouseSnapshot?.metrics7d?.byCurrency?.[0]?.spend ?? 0) > 0
                        ? `${(warehouseSnapshot?.metrics7d?.byCurrency?.[0]?.roas ?? 0).toFixed(2)}×`
                        : "—"}
                  </p>
                </div>
              </div>

              {!hasPeriodMetrics && warehouseSnapshot?.hasData && (
                <p className="mt-2.5 text-xs text-ink-mute">
                  Warehouse data exists, but no advertising metrics fall within the last 7 days.
                </p>
              )}

              {!warehouseSnapshot?.hasData && (
                <p className="mt-2.5 text-xs text-ink-mute">
                  No warehouse data has been imported yet. Connect a source and complete a sync to populate these metrics.
                </p>
              )}

              <div className="mt-2.5 flex items-center justify-end font-mono text-[10px] text-ink-mute">
                <span>Total rows: {summaryCards?.warehouse?.totalRows?.toLocaleString() ?? 0}</span>
              </div>
            </div>
          </div>

          {/* Right Column (5 cols): Destinations & Activity */}
          <div className="space-y-6 xl:col-span-5">
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
                {destinationsList.map((dest) => {
                  const state = destinationStatePresentation(dest.status);
                  return (
                    <Link
                      key={dest.id}
                      href={dest.href}
                      aria-label={`${dest.name}: ${state.label}. ${dest.subtext}`}
                      className="group flex min-w-0 items-start justify-between gap-3 py-2.5 transition-colors duration-150 first:pt-2 last:pb-1 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-xs font-medium leading-snug text-ink transition-colors duration-150 group-hover:text-white">{dest.name}</p>
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-mute">{dest.subtext}</p>
                      </div>
                      <span className={cn("inline-flex shrink-0 items-center gap-1 text-[10px] font-medium", state.textClassName)}>
                        <span className={cn("h-1 w-1 rounded-full", state.dotClassName)} />
                        {state.label}
                      </span>
                    </Link>
                  );
                })}
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
                          act.status === "error" && "bg-red-400",
                          act.status === "warning" && "bg-amber-400",
                          act.status === "info" && "bg-sky-400",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-xs font-medium leading-snug text-ink">{act.title}</p>
                        <p className="mt-0.5 text-[11px] leading-snug text-ink-mute">
                          {act.description} · {formatDateTime(act.timestamp)}
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
            void mutate();
          }}
        />
      )}
    </PageShell>
  );
}
