"use client";

import React from "react";
import { createPortal } from "react-dom";
import { X, AlertTriangle, Flame, ShieldAlert, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useMounted } from "@/hooks/useMounted";
import type { MarketingAnomaly } from "@/lib/marketing-anomalies";
import { formatCurrencyValue } from "@/lib/client-export";

interface AnomalyDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  anomalies: MarketingAnomaly[];
  clientName?: string;
}

export function AnomalyDetailsModal({
  isOpen,
  onClose,
  anomalies,
  clientName,
}: AnomalyDetailsModalProps) {
  const mounted = useMounted();

  if (!isOpen || !mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-xl max-h-[85vh] flex flex-col rounded-xl border border-line bg-panel shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4 bg-canvas/60">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <ShieldAlert className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-ink flex items-center gap-2">
                Marketing Anomaly Watchdog
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-500/15 text-rose-300 border border-rose-500/30">
                  {anomalies.length} {anomalies.length === 1 ? "Issue" : "Issues"}
                </span>
              </h2>
              <p className="text-xs text-ink-mute">
                {clientName ? `Active alerts for ${clientName}` : "Active alerts across marketing accounts"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-mute hover:bg-white/[0.06] hover:text-ink transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Anomaly List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
          {anomalies.length === 0 ? (
            <div className="text-center py-10 text-xs text-ink-mute">
              No anomalies detected. Campaigns are performing within expected thresholds.
            </div>
          ) : (
            anomalies.map((a) => {
              const isCritical = a.severity === "critical";
              return (
                <div
                  key={a.id}
                  className={`p-4 rounded-xl border transition ${
                    isCritical
                      ? "bg-rose-500/[0.06] border-rose-500/25 hover:border-rose-500/40"
                      : "bg-amber-500/[0.06] border-amber-500/25 hover:border-amber-500/40"
                  }`}
                >
                  {/* Top Bar */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {isCritical ? (
                        <span className="flex items-center gap-1 text-[11px] font-bold text-rose-400 px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/30">
                          <Flame className="w-3 h-3" />
                          SPEND BURN
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] font-bold text-amber-400 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30">
                          <AlertTriangle className="w-3 h-3" />
                          EFFICIENCY ALERT
                        </span>
                      )}
                      <span className="text-xs font-semibold text-ink">{a.platformLabel}</span>
                      {a.accountName && (
                        <span className="text-[11px] text-ink-mute">· {a.accountName}</span>
                      )}
                    </div>

                    <span className="text-[11px] font-mono font-medium text-ink">
                      {formatCurrencyValue(a.currentSpend, a.currency)} spend
                    </span>
                  </div>

                  {/* Campaign Name */}
                  <div className="mt-2 text-xs font-semibold text-ink">
                    {a.campaignName}
                  </div>

                  {/* Message */}
                  <p className="mt-1 text-xs text-ink-mute leading-relaxed">
                    {a.message}
                  </p>

                  {/* Action Hint */}
                  <div className="mt-2.5 flex items-center gap-1.5 p-2 rounded-lg bg-black/20 text-[11px] text-ink-mute">
                    <span className="font-semibold text-ink shrink-0">Action:</span>
                    <span>{a.actionHint}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-5 py-3 bg-canvas/40 text-xs">
          <Link
            href="/explorer"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 text-accent hover:underline font-medium"
          >
            Investigate in Data Explorer
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>

          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-lg border border-line text-ink-mute hover:text-ink hover:border-line-strong transition"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
