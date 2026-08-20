"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ShieldCheck,
  FileSpreadsheet,
  BarChart2,
  Terminal,
} from "lucide-react";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { cn } from "@/lib/utils";

type PipelineStage = "connect" | "normalize" | "warehouse" | "deliver";

const STAGES: Array<{ id: PipelineStage; number: string; title: string; subtitle: string }> = [
  { id: "connect", number: "01", title: "Connect", subtitle: "Read-only OAuth" },
  { id: "normalize", number: "02", title: "Normalize", subtitle: "Schema mapping" },
  { id: "warehouse", number: "03", title: "Warehouse", subtitle: "Isolated storage" },
  { id: "deliver", number: "04", title: "Deliver", subtitle: "Sheets & Looker" },
];

const SOURCES = [
  { id: "meta", name: "Meta Ads", logo: INTEGRATION_LOGOS.meta, rawField: "spend", status: "Connected" },
  { id: "google", name: "Google Ads", logo: INTEGRATION_LOGOS.googleAds, rawField: "cost", status: "Connected" },
  { id: "tiktok", name: "TikTok Ads", logo: INTEGRATION_LOGOS.tiktok, rawField: "stat_cost", status: "Connected" },
  { id: "shopee", name: "Shopee", logo: INTEGRATION_LOGOS.shopee, rawField: "cost", status: "Connected" },
];

const NORMALIZED_SCHEMA = [
  { field: "date", type: "DATE", example: "2026-08-19" },
  { field: "platform", type: "STRING", example: "meta_ads" },
  { field: "account_name", type: "STRING", example: "Alpha Agency - Client A" },
  { field: "campaign", type: "STRING", example: "Summer PMax Scale" },
  { field: "spend", type: "DECIMAL", example: "$1,420.50" },
  { field: "impressions", type: "INTEGER", example: "84,120" },
  { field: "conversions", type: "DECIMAL", example: "142" },
  { field: "roas", type: "DECIMAL", example: "4.12x" },
];

const DESTINATIONS = [
  {
    id: "sheets",
    name: "Google Sheets™",
    description: "Automated add-on syncs data directly into client workbook tabs.",
    icon: FileSpreadsheet,
    logo: INTEGRATION_LOGOS.googleSheets,
    badge: "Official Add-on",
  },
  {
    id: "looker",
    name: "Looker Studio™",
    description: "Live community connector powering interactive agency client decks.",
    icon: BarChart2,
    logo: INTEGRATION_LOGOS.looker,
    badge: "Certified Connector",
  },
  {
    id: "api",
    name: "CSV & REST API",
    description: "Programmatic querying with multi-tenant token authorization.",
    icon: Terminal,
    badge: "Fast JSON / CSV",
  },
];

export function SignaturePipeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeStage, setActiveStage] = useState<PipelineStage>("connect");
  const [hasPlayed, setHasPlayed] = useState(false);

  // Auto-play progression once when meaningfully scrolled into view
  useEffect(() => {
    const el = containerRef.current;
    if (!el || hasPlayed) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasPlayed) {
          // Controlled entrance progression: connect -> normalize -> warehouse -> deliver
          setActiveStage("connect");
          const t1 = setTimeout(() => setActiveStage("normalize"), 1200);
          const t2 = setTimeout(() => setActiveStage("warehouse"), 2400);
          const t3 = setTimeout(() => {
            setActiveStage("deliver");
            setHasPlayed(true);
          }, 3600);

          return () => {
            clearTimeout(t1);
            clearTimeout(t2);
            clearTimeout(t3);
          };
        }
      },
      { threshold: 0.25 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasPlayed]);

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-xl border border-line bg-panel shadow-2xl transition-colors duration-200"
    >
      {/* ── Top Pipeline Stepper Header ── */}
      <div className="flex flex-wrap items-center justify-between border-b border-line bg-canvas/60 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-emerald-400" />
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-ink">
            Architecture Pipeline
          </span>
          <span className="hidden text-xs text-ink-mute sm:inline">
            · Continuous ETL Engine
          </span>
        </div>

        {/* Stage selection tabs */}
        <div className="flex items-center gap-1">
          {STAGES.map((s) => {
            const isCurrent = activeStage === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveStage(s.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150",
                  isCurrent
                    ? "bg-white/[0.12] text-ink font-semibold border border-white/20 shadow-xs"
                    : "text-ink-mute hover:text-ink hover:bg-white/[0.03]"
                )}
              >
                <span className="font-mono text-[10px] opacity-60">{s.number}</span>
                <span>{s.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main Interactive Flow Canvas ── */}
      <div className="p-5 sm:p-8">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4 lg:gap-4 items-stretch">
          {/* ── 1. CONNECT STAGE ── */}
          <div
            onClick={() => setActiveStage("connect")}
            className={cn(
              "cursor-pointer rounded-lg border p-4 transition-all duration-200 flex flex-col justify-between",
              activeStage === "connect"
                ? "border-white/30 bg-canvas shadow-xs ring-1 ring-white/10 opacity-100"
                : "border-line/40 bg-canvas/30 opacity-55 hover:opacity-80"
            )}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
                  01 · Sources
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400 font-mono">
                  <CheckCircle2 className="h-3 w-3" /> OAuth 2.0
                </span>
              </div>
              <h4 className="text-sm font-semibold text-ink mb-1">Direct Ingestion</h4>
              <p className="text-xs text-ink-mute leading-relaxed mb-4">
                Official API connections without credential sharing.
              </p>

              {/* Source chips */}
              <div className="space-y-2">
                {SOURCES.map((src) => (
                  <div
                    key={src.id}
                    className={cn(
                      "flex items-center justify-between rounded-md border px-2.5 py-2 text-xs transition-colors",
                      activeStage === "connect"
                        ? "border-line bg-panel text-ink"
                        : "border-line/50 bg-panel/60 text-ink-mute"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <IntegrationMark src={src.logo} alt={src.name} size="sm" />
                      <span className="font-medium text-ink text-[12px]">{src.name}</span>
                    </div>
                    <span className="font-mono text-[10px] text-ink-mute">
                      raw: <code className="text-neutral-300">{src.rawField}</code>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between text-[11px] text-ink-mute">
              <span>Sync frequency</span>
              <span className="font-mono text-ink">Manual / Nightly</span>
            </div>
          </div>

          {/* ── 2. NORMALIZE STAGE ── */}
          <div
            onClick={() => setActiveStage("normalize")}
            className={cn(
              "cursor-pointer rounded-lg border p-4 transition-all duration-200 flex flex-col justify-between",
              activeStage === "normalize"
                ? "border-white/30 bg-canvas shadow-xs ring-1 ring-white/10 opacity-100"
                : "border-line/40 bg-canvas/30 opacity-55 hover:opacity-80"
            )}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
                  02 · Transform
                </span>
                <span className="font-mono text-[10px] text-ink-mute">
                  PostgreSQL Engine
                </span>
              </div>
              <h4 className="text-sm font-semibold text-ink mb-1">Schema Normalization</h4>
              <p className="text-xs text-ink-mute leading-relaxed mb-4">
                Converts disparate ad metrics into a single standard structure.
              </p>

              {/* Normalized schema preview */}
              <div
                className={cn(
                  "rounded-md border p-2.5 space-y-1.5 font-mono text-[11px] transition-colors",
                  activeStage === "normalize"
                    ? "border-line bg-panel"
                    : "border-line/50 bg-panel/60"
                )}
              >
                <div className="text-[10px] font-semibold text-ink-mute uppercase border-b border-line pb-1">
                  Unified Schema
                </div>
                {NORMALIZED_SCHEMA.slice(0, 5).map((col) => (
                  <div key={col.field} className="flex items-center justify-between text-[11px]">
                    <span className="text-ink font-medium">{col.field}</span>
                    <span className="text-ink-mute text-[10px]">{col.type}</span>
                  </div>
                ))}
                <div className="text-[10px] text-ink-mute text-center pt-1 border-t border-line">
                  + conversions, revenue, roas
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between text-[11px] text-ink-mute">
              <span>Timezone &amp; currency</span>
              <span className="font-mono text-ink">Currency-aware</span>
            </div>
          </div>

          {/* ── 3. WAREHOUSE STAGE ── */}
          <div
            onClick={() => setActiveStage("warehouse")}
            className={cn(
              "cursor-pointer rounded-lg border p-4 transition-all duration-200 flex flex-col justify-between",
              activeStage === "warehouse"
                ? "border-white/30 bg-canvas shadow-xs ring-1 ring-white/10 opacity-100"
                : "border-line/40 bg-canvas/30 opacity-55 hover:opacity-80"
            )}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
                  03 · Warehouse
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400 font-mono">
                  <ShieldCheck className="h-3 w-3" /> Tenant Fenced
                </span>
              </div>
              <h4 className="text-sm font-semibold text-ink mb-1">Unified Warehouse</h4>
              <p className="text-xs text-ink-mute leading-relaxed mb-4">
                Query-ready persistence with strict multi-client isolation.
              </p>

              {/* Warehouse inspection box */}
              <div
                className={cn(
                  "rounded-md border p-3 space-y-2 transition-colors",
                  activeStage === "warehouse"
                    ? "border-line bg-panel"
                    : "border-line/50 bg-panel/60"
                )}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink-mute">Storage:</span>
                  <span className="font-mono text-ink font-semibold">PostgreSQL (Prisma)</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink-mute">Partitioning:</span>
                  <span className="font-mono text-ink">Workspace Fenced</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink-mute">Query access:</span>
                  <span className="font-mono text-emerald-400">Workspace scoped</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink-mute">Encryption:</span>
                  <span className="font-mono text-ink">AES-256 at rest</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between text-[11px] text-ink-mute">
              <span>Security posture</span>
              <span className="font-mono text-ink">Zero data cross-leak</span>
            </div>
          </div>

          {/* ── 4. DELIVER STAGE ── */}
          <div
            onClick={() => setActiveStage("deliver")}
            className={cn(
              "cursor-pointer rounded-lg border p-4 transition-all duration-200 flex flex-col justify-between",
              activeStage === "deliver"
                ? "border-white/30 bg-canvas shadow-xs ring-1 ring-white/10 opacity-100"
                : "border-line/40 bg-canvas/30 opacity-55 hover:opacity-80"
            )}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
                  04 · Deliver
                </span>
                <span className="font-mono text-[10px] text-emerald-400">
                  Ready to consume
                </span>
              </div>
              <h4 className="text-sm font-semibold text-ink mb-1">Downstream Destinations</h4>
              <p className="text-xs text-ink-mute leading-relaxed mb-4">
                Automated delivery into tools teams already rely on.
              </p>

              {/* Destination list */}
              <div className="space-y-2">
                {DESTINATIONS.map((dest) => (
                  <div
                    key={dest.id}
                    className={cn(
                      "flex items-center justify-between rounded-md border px-2.5 py-2 text-xs transition-colors",
                      activeStage === "deliver"
                        ? "border-line bg-panel text-ink"
                        : "border-line/50 bg-panel/60 text-ink-mute"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {dest.logo ? (
                        <IntegrationMark src={dest.logo} alt={dest.name} size="sm" />
                      ) : (
                        <div className="flex h-5 w-5 items-center justify-center rounded bg-canvas border border-line text-ink">
                          <Terminal className="h-3 w-3" />
                        </div>
                      )}
                      <span className="font-medium text-ink text-[12px]">{dest.name}</span>
                    </div>
                    <span className="font-mono text-[10px] text-ink-mute">{dest.badge}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between text-[11px] text-ink-mute">
              <span>Reporting manual work</span>
              <span className="font-mono text-emerald-400 font-semibold">0 minutes</span>
            </div>
          </div>
        </div>

        {/* Bottom architecture summary note */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-xs text-ink-mute">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>
              End-to-end data lineage: <strong className="text-ink">Raw API → Normalization → Isolated Storage → Client Decks</strong>
            </span>
          </div>
          <span className="font-mono text-[11px] text-ink-mute">
            No middleware glue code · No Zapier fragility
          </span>
        </div>
      </div>
    </div>
  );
}
