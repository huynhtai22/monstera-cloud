"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import useSWR from "swr";
import { X, RefreshCw, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { useMounted } from "@/hooks/useMounted";

const AD_SOURCES = ["meta_ads", "google_ads", "tiktok_business", "shopee", "lazada"] as const;

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const PROVIDER_NAMES: Record<string, string> = {
  meta_ads: "Meta Ads",
  tiktok_business: "TikTok Ads",
  google_ads: "Google Ads",
  shopee: "Shopee",
  lazada: "Lazada",
  shopify: "Shopify",
};

interface RefreshWarehouseModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string | null;
  onRefreshStarted?: () => void;
}

type Step = "config" | "success" | "error";

export function RefreshWarehouseModal({
  isOpen,
  onClose,
  workspaceId,
  onRefreshStarted,
}: RefreshWarehouseModalProps) {
  const mounted = useMounted();
  const [step, setStep] = useState<Step>("config");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [preset, setPreset] = useState<"7" | "30" | "90" | "custom">("30");
  const [selectedConnIds, setSelectedConnIds] = useState<Set<string>>(new Set());
  const [metaAcctPick, setMetaAcctPick] = useState<Record<string, Set<string>>>({});
  const [metaAccountsByConn, setMetaAccountsByConn] = useState<Record<string, { id: string; name: string }[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);

  // Initialize date range to last 30 days
  useEffect(() => {
    if (!isOpen) return;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    setEndDate(end.toISOString().split("T")[0]);
    setStartDate(start.toISOString().split("T")[0]);
    setPreset("30");
    setStep("config");
    setErrorMessage(null);
  }, [isOpen]);

  const { data: connectionsData, isLoading: connectionsLoading } = useSWR(
    isOpen && workspaceId ? `/api/workspaces/${workspaceId}/connections` : null,
    fetcher
  );

  const connections = useMemo(() => {
    const raw = connectionsData;
    const list: Array<{ id: string; name: string; provider: string; type: string; status: string }> =
      Array.isArray(raw) ? raw : (raw?.connections ?? []) || [];
    return list.filter(
      (c) => AD_SOURCES.includes(c.provider as (typeof AD_SOURCES)[number]) && c.type === "source"
    );
  }, [connectionsData]);

  // Select all connected sources by default when loaded
  useEffect(() => {
    if (connections.length > 0 && selectedConnIds.size === 0) {
      setSelectedConnIds(new Set(connections.map((c) => c.id)));
    }
  }, [connections, selectedConnIds.size]);

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

  const handlePreset = (days: number, key: "7" | "30" | "90") => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setEndDate(end.toISOString().split("T")[0]);
    setStartDate(start.toISOString().split("T")[0]);
    setPreset(key);
  };

  const toggleSource = (connId: string, provider: string) => {
    const next = new Set(selectedConnIds);
    if (next.has(connId)) {
      next.delete(connId);
      setMetaAcctPick((p) => {
        const cp = { ...p };
        delete cp[connId];
        return cp;
      });
    } else {
      next.add(connId);
      if (provider === "meta_ads" && !metaAccountsByConn[connId]) {
        void fetchMetaAccounts(connId);
      }
    }
    setSelectedConnIds(next);
  };

  const toggleMetaAcct = (connId: string, acctId: string) => {
    setMetaAcctPick((prev) => {
      const base = new Set(prev[connId] ?? []);
      if (base.has(acctId)) base.delete(acctId);
      else base.add(acctId);
      return { ...prev, [connId]: base };
    });
  };

  const handleRunRefresh = async () => {
    if (!workspaceId || !startDate || !endDate) {
      setErrorMessage("Please set a valid date range.");
      return;
    }
    if (selectedConnIds.size === 0) {
      setErrorMessage("Please select at least one data source.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

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

    try {
      const res = await fetch("/api/data-explorer/warehouse/import-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          since: startDate,
          until: endDate,
          items,
          async: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMessage(data.error || `Refresh failed (${res.status})`);
        setStep("error");
        return;
      }

      setQueuedCount(items.length);
      setStep("success");
      onRefreshStarted?.();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to start refresh");
      setStep("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const logoForProvider = (provider: string) => {
    switch (provider) {
      case "meta_ads":
        return INTEGRATION_LOGOS.meta;
      case "google_ads":
        return INTEGRATION_LOGOS.googleAds;
      case "tiktok_business":
        return INTEGRATION_LOGOS.tiktok;
      case "shopee":
        return INTEGRATION_LOGOS.shopee;
      case "lazada":
        return INTEGRATION_LOGOS.lazada;
      default:
        return INTEGRATION_LOGOS.meta;
    }
  };

  if (!isOpen || !mounted) return null;

  const content = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px] transition-opacity"
        onClick={() => {
          if (!isSubmitting) onClose();
        }}
      />

      {/* Modal surface */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="refresh-modal-title"
        className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl transition-transform"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header line accent */}
        <div className="h-[2px] w-full bg-white/20" />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-canvas">
              <RefreshCw className="h-4 w-4 text-ink" strokeWidth={1.5} />
            </div>
            <div>
              <h3 id="refresh-modal-title" className="text-base font-semibold text-ink">
                Refresh warehouse
              </h3>
              <p className="text-xs text-ink-mute">
                Pull latest campaign data from connected sources.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-mute hover:bg-white/[0.04] hover:text-ink disabled:opacity-50"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {step === "config" && (
            <div className="space-y-5">
              {/* Date Presets & Inputs */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-ink-mute">
                  Date range
                </label>
                <div className="mb-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handlePreset(7, "7")}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                      preset === "7"
                        ? "border-line bg-white/[0.08] text-ink"
                        : "border-line bg-canvas text-ink-mute hover:text-ink"
                    )}
                  >
                    Last 7 days
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePreset(30, "30")}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                      preset === "30"
                        ? "border-line bg-white/[0.08] text-ink"
                        : "border-line bg-canvas text-ink-mute hover:text-ink"
                    )}
                  >
                    Last 30 days
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePreset(90, "90")}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                      preset === "90"
                        ? "border-line bg-white/[0.08] text-ink"
                        : "border-line bg-canvas text-ink-mute hover:text-ink"
                    )}
                  >
                    Last 90 days
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] text-ink-mute">From</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        setPreset("custom");
                      }}
                      className="w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-xs text-ink focus:border-white/20 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-ink-mute">To</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => {
                        setEndDate(e.target.value);
                        setPreset("custom");
                      }}
                      className="w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-xs text-ink focus:border-white/20 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Sources */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-ink-mute">
                    Sources ({selectedConnIds.size}/{connections.length})
                  </label>
                  {connections.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedConnIds.size === connections.length) {
                          setSelectedConnIds(new Set());
                        } else {
                          setSelectedConnIds(new Set(connections.map((c) => c.id)));
                        }
                      }}
                      className="text-[11px] text-ink-mute hover:text-ink"
                    >
                      {selectedConnIds.size === connections.length ? "Deselect all" : "Select all"}
                    </button>
                  )}
                </div>

                {connectionsLoading ? (
                  <div className="py-6 text-center text-xs text-ink-mute">Loading connected sources…</div>
                ) : connections.length === 0 ? (
                  <div className="rounded-md border border-dashed border-line bg-canvas p-4 text-center">
                    <p className="text-xs text-ink-mute">No ad sources connected in this workspace.</p>
                    <Link
                      href="/sources"
                      onClick={onClose}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-ink underline"
                    >
                      Connect Meta, Google, or TikTok Ads →
                    </Link>
                  </div>
                ) : (
                  <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                    {connections.map((c) => {
                      const isChecked = selectedConnIds.has(c.id);
                      return (
                        <div
                          key={c.id}
                          className={cn(
                            "rounded-md border p-2.5 transition-colors",
                            isChecked ? "border-white/20 bg-canvas" : "border-line bg-canvas/40"
                          )}
                        >
                          <label className="flex cursor-pointer items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleSource(c.id, c.provider)}
                                className="h-4 w-4 rounded border-line accent-white"
                              />
                              <IntegrationMark src={logoForProvider(c.provider)} size="sm" />
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium text-ink">{c.name}</p>
                                <p className="text-[10px] text-ink-mute">
                                  {PROVIDER_NAMES[c.provider] || c.provider}
                                </p>
                              </div>
                            </div>
                          </label>

                          {/* Meta sub-accounts toggle if selected */}
                          {isChecked && c.provider === "meta_ads" && (
                            <div className="mt-2.5 border-t border-line pt-2 pl-6">
                              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-mute">
                                Specific ad accounts (optional)
                              </p>
                              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                                {(metaAccountsByConn[c.id] ?? []).map((a) => (
                                  <label
                                    key={a.id}
                                    className="flex cursor-pointer items-center gap-1 rounded bg-panel px-2 py-0.5 text-[11px] text-ink"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={metaAcctPick[c.id]?.has(a.id) ?? false}
                                      onChange={() => toggleMetaAcct(c.id, a.id)}
                                      className="rounded border-line accent-white"
                                    />
                                    <span className="truncate">{a.name || a.id}</span>
                                  </label>
                                ))}
                                {isChecked && !(metaAccountsByConn[c.id]?.length) && (
                                  <span className="text-[11px] text-ink-mute">Syncing all linked ad accounts</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {errorMessage && (
                <div className="flex items-start gap-2 rounded-md border border-red-900/50 bg-red-950/30 p-3 text-xs text-red-300">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>
          )}

          {step === "success" && (
            <div className="py-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-950/40 border border-emerald-500/30">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" strokeWidth={1.5} />
              </div>
              <h4 className="text-base font-semibold text-ink">Warehouse refresh started</h4>
              <p className="mt-1 text-sm text-ink-mute">
                {queuedCount} source{queuedCount === 1 ? "" : "s"} queued for extraction and normalization.
              </p>
              <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  href="/reports"
                  onClick={onClose}
                  className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-md border border-line bg-canvas px-4 py-2 text-xs font-medium text-ink hover:bg-white/[0.04]"
                >
                  View progress in Sync activity <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full sm:w-auto rounded-md bg-white px-4 py-2 text-xs font-semibold text-neutral-900 hover:bg-neutral-100"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {step === "error" && (
            <div className="py-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-950/40 border border-red-500/30">
                <AlertCircle className="h-6 w-6 text-red-400" strokeWidth={1.5} />
              </div>
              <h4 className="text-base font-semibold text-ink">Refresh failed to start</h4>
              <p className="mt-1 text-xs text-red-300">{errorMessage || "An unknown error occurred."}</p>
              <div className="mt-6 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep("config")}
                  className="rounded-md border border-line bg-canvas px-4 py-2 text-xs font-medium text-ink hover:bg-white/[0.04]"
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-line bg-panel px-4 py-2 text-xs font-medium text-ink-mute hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions for config step */}
        {step === "config" && (
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md border border-line px-3.5 py-2 text-xs font-medium text-ink-mute hover:bg-white/[0.04] hover:text-ink disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRunRefresh}
              disabled={isSubmitting || connections.length === 0 || selectedConnIds.size === 0}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-4 py-2 text-xs font-semibold text-neutral-900 transition-colors hover:bg-neutral-100 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Queueing refresh…
                </>
              ) : (
                "Run refresh"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
