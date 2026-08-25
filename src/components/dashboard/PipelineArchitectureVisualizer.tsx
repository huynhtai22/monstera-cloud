"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Database,
  Layers,
  Share2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  BarChart3,
  Code2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { CopyableBadge } from "@/components/ui/CopyableBadge";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import type {
  DashboardSourceItem,
  DashboardDestinationItem,
  DashboardOverviewDTO,
} from "@/lib/dashboard-overview";

interface PipelineArchitectureVisualizerProps {
  sources?: DashboardSourceItem[];
  warehouse?: DashboardOverviewDTO["summaryCards"]["warehouse"];
  warehouseSnapshot?: DashboardOverviewDTO["warehouseSnapshot"];
  destinations?: DashboardDestinationItem[];
  className?: string;
}

const PROVIDER_LOGOS: Record<string, string | undefined> = {
  google_ads: INTEGRATION_LOGOS.googleAds,
  meta_ads: INTEGRATION_LOGOS.meta,
  tiktok_business: INTEGRATION_LOGOS.tiktok,
  shopee: INTEGRATION_LOGOS.shopee,
  lazada: INTEGRATION_LOGOS.lazada,
  shopify: INTEGRATION_LOGOS.shopify,
};

export function PipelineArchitectureVisualizer({
  sources = [],
  warehouse,
  warehouseSnapshot,
  destinations = [],
  className,
}: PipelineArchitectureVisualizerProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const healthySourcesCount = sources.filter((s) => s.state === "fresh").length;
  const totalAccounts = sources.reduce((acc, s) => acc + (s.accountCount || 1), 0);
  const totalRows = warehouse?.totalRows ?? 0;
  const dataThroughDate = warehouse?.dataThroughDate || "Current";
  const warehouseStatus = warehouse?.status === "fresh" ? "Fully synchronized" : (warehouse?.status || "Ready");

  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-panel p-4 sm:p-5 shadow-xs transition-all duration-200",
        className
      )}
    >
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white/[0.06] text-white">
            <Zap className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-ink">
            Pipeline Architecture
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live Data Flow
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs font-medium text-ink-mute hover:text-ink transition-colors inline-flex items-center gap-1 cursor-pointer"
          >
            {isExpanded ? "Collapse architecture" : "Expand architecture"}
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Flow Stages */}
      {isExpanded && (
        <div className="mt-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-11 lg:items-stretch">
            {/* ── STAGE 1: INGESTION SOURCES (4 cols) ── */}
            <div className="flex flex-col justify-between rounded-lg border border-line bg-canvas p-3.5 lg:col-span-4">
              <div>
                <div className="flex items-center justify-between border-b border-line/60 pb-2">
                  <div className="flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-ink-mute" />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                      Stage 1 · Ingestion Sources
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-ink-mute">
                    {sources.length} sources · {totalAccounts} accounts
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {sources.length === 0 ? (
                    <div className="py-4 text-center text-xs text-ink-mute">
                      No connected sources yet
                    </div>
                  ) : (
                    sources.slice(0, 4).map((source) => {
                      const logoSrc = PROVIDER_LOGOS[source.provider];
                      const isFresh = source.state === "fresh";
                      return (
                        <div
                          key={source.id}
                          className="flex items-center justify-between rounded-md border border-line/70 bg-panel px-2.5 py-2 transition-colors hover:border-line"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {logoSrc ? (
                              <IntegrationMark src={logoSrc} size="sm" />
                            ) : (
                              <div className="h-5 w-5 rounded bg-white/10" />
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-ink">
                                {source.name}
                              </p>
                              {source.managerBadge && (
                                <CopyableBadge
                                  text={source.managerBadge}
                                  copyValue={source.managerBadge.replace(/^\[|\]$/g, "").replace(/^(MCC|BM|BC):\s*/, "")}
                                  title={`Click to copy ${source.managerBadge}`}
                                  className="text-[10px] text-ink-mute mt-0.5"
                                />
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                isFresh ? "bg-emerald-400" : "bg-amber-400"
                              )}
                            />
                            <span className="font-mono text-[10px] text-ink-mute">
                              {isFresh ? "Synced" : source.state}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                  {sources.length > 4 && (
                    <p className="text-center font-mono text-[10px] text-ink-mute">
                      +{sources.length - 4} more configured sources
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-line/60 flex items-center justify-between text-xs">
                <span className="text-[11px] text-ink-mute">
                  {healthySourcesCount} of {sources.length} active
                </span>
                <Link
                  href="/sources"
                  className="font-medium text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 transition-colors"
                >
                  Manage sources <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>

            {/* ── FLOW CONNECTOR 1 -> 2 (1 col) ── */}
            <div className="hidden lg:flex lg:col-span-1 items-center justify-center">
              <div className="flex flex-col items-center gap-1 text-ink-mute/50">
                <div className="h-px w-full bg-gradient-to-r from-emerald-500/50 to-blue-500/50" />
                <ArrowRight className="h-4 w-4 text-emerald-400" />
                <span className="font-mono text-[9px] uppercase tracking-tighter">Auto-Sync</span>
              </div>
            </div>

            {/* ── STAGE 2: MONSTERA UNIFIED WAREHOUSE (3 cols) ── */}
            <div className="flex flex-col justify-between rounded-lg border border-line bg-gradient-to-b from-canvas to-panel p-3.5 lg:col-span-3 relative overflow-hidden">
              <div className="absolute top-0 right-0 h-16 w-16 bg-emerald-500/10 blur-xl pointer-events-none" />
              <div>
                <div className="flex items-center justify-between border-b border-line/60 pb-2">
                  <div className="flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink">
                      Stage 2 · Unified Warehouse
                    </span>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] font-medium text-emerald-400 border border-emerald-500/20">
                    Core Engine
                  </span>
                </div>

                <div className="mt-3 space-y-2.5">
                  <div className="rounded-md border border-line/80 bg-panel/80 p-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-ink-mute">Total Volume</span>
                      <span className="font-mono font-bold text-ink tabular-nums">
                        {totalRows > 0 ? totalRows.toLocaleString() : "0"} rows
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-ink-mute">Data Coverage</span>
                      <span className="font-mono text-[11px] text-ink">
                        {dataThroughDate}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] text-ink-mute border border-line/50">
                      Auto-Dedup
                    </span>
                    <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] text-ink-mute border border-line/50">
                      Multi-Currency
                    </span>
                    <span className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] text-ink-mute border border-line/50">
                      Columnar Engine
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-line/60 flex items-center justify-between text-xs">
                <span className="text-[11px] text-ink-mute">
                  {warehouseStatus}
                </span>
                <Link
                  href="/explorer"
                  className="font-medium text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 transition-colors"
                >
                  Workbench <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>

            {/* ── FLOW CONNECTOR 2 -> 3 (1 col) ── */}
            <div className="hidden lg:flex lg:col-span-1 items-center justify-center">
              <div className="flex flex-col items-center gap-1 text-ink-mute/50">
                <div className="h-px w-full bg-gradient-to-r from-blue-500/50 to-purple-500/50" />
                <ArrowRight className="h-4 w-4 text-blue-400" />
                <span className="font-mono text-[9px] uppercase tracking-tighter">Stream</span>
              </div>
            </div>

            {/* ── STAGE 3: CONSUMPTION DESTINATIONS (2 cols) ── */}
            <div className="flex flex-col justify-between rounded-lg border border-line bg-canvas p-3.5 lg:col-span-2">
              <div>
                <div className="flex items-center justify-between border-b border-line/60 pb-2">
                  <div className="flex items-center gap-1.5">
                    <Share2 className="h-3.5 w-3.5 text-ink-mute" />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                      Stage 3 · Exports
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-ink-mute">
                    {destinations.length} endpoints
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between rounded-md border border-line/70 bg-panel px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <span className="text-xs font-medium text-ink truncate">Google Sheets</span>
                    </div>
                    <span className="font-mono text-[9px] text-emerald-400">Ready</span>
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-line/70 bg-panel px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <BarChart3 className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                      <span className="text-xs font-medium text-ink truncate">Looker Studio</span>
                    </div>
                    <span className="font-mono text-[9px] text-blue-400">Connected</span>
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-line/70 bg-panel px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Code2 className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                      <span className="text-xs font-medium text-ink truncate">REST & Webhooks</span>
                    </div>
                    <span className="font-mono text-[9px] text-purple-400">API Active</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-line/60 flex items-center justify-between text-xs">
                <span className="text-[11px] text-ink-mute">Live sync sinks</span>
                <Link
                  href="/exports"
                  className="font-medium text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 transition-colors"
                >
                  Exports <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
