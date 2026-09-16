"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import useSWR from "swr";
import { X, RefreshCw, CheckCircle2, AlertCircle, ArrowRight, TriangleAlert } from "lucide-react";
import { deriveSessionKey, needsReinit, terminalStatusToUiStep, canViewImportedData } from "@/lib/refresh-modal-logic";
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
  onRefreshCompleted?: (info: {
    since: string;
    until: string;
    rowsIngested: number;
    platform?: string | null;
    accountId?: string | null;
  }) => void;
  initialStartDate?: string;
  initialEndDate?: string;
  initialPlatform?: string | null;
  initialAccountId?: string | null;
  onApplyViewFilters?: (filters: {
    startDate: string;
    endDate: string;
    platform?: string | null;
    accountId?: string | null;
  }) => void;
}

type Step = "config" | "polling" | "success" | "partial" | "error";

export function RefreshWarehouseModal({
  isOpen,
  onClose,
  workspaceId,
  onRefreshStarted,
  onRefreshCompleted,
  initialStartDate,
  initialEndDate,
  initialPlatform,
  initialAccountId,
  onApplyViewFilters,
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
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  const [jobOutcome, setJobOutcome] = useState<{
    id?: string;
    status?: string;
    since?: string;
    until?: string;
    requestedRange?: { since: string; until: string };
    effectiveRange?: { since: string; until: string };
    clamped?: boolean;
    approximateRows?: number;
    totalItems?: number;
    completedItems?: number;
    results?: any[];
    errorMsg?: string | null;
  } | null>(null);
  /**
   * Tracks the session-context key for which account selection was last
   * initialized. Reset to null on every close so the next open always
   * re-derives the correct context — even if the context is identical.
   * This replaces the prior boolean ref that could never reset between sessions.
   */
  const initializedSessionKeyRef = useRef<string | null>(null);
  const userModifiedSelectionRef = useRef(false);
  const [accountNotFoundNotice, setAccountNotFoundNotice] = useState<string | null>(null);

  // Initialize date range from active Warehouse view or fallback to last 30 days
  // and reset transient state on open/close
  useEffect(() => {
    if (!isOpen) {
      setSelectedConnIds(new Set());
      setMetaAcctPick({});
      setMetaAccountsByConn({});
      initializedSessionKeyRef.current = null;
      userModifiedSelectionRef.current = false;
      setAccountNotFoundNotice(null);
      setErrorMessage(null);
      setPollingJobId(null);
      setJobOutcome(null);
      setStep("config");
      return;
    }

    if (
      initialStartDate &&
      initialEndDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(initialStartDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(initialEndDate)
    ) {
      setStartDate(initialStartDate);
      setEndDate(initialEndDate);
      setPreset("custom");
    } else {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      setEndDate(end.toISOString().split("T")[0]);
      setStartDate(start.toISOString().split("T")[0]);
      setPreset("30");
    }
    setStep("config");
    setErrorMessage(null);
    setPollingJobId(null);
    setJobOutcome(null);
    initializedSessionKeyRef.current = null;
    userModifiedSelectionRef.current = false;
    setAccountNotFoundNotice(null);
  }, [isOpen, initialStartDate, initialEndDate]);

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

  // Pre-fetch Meta accounts if initialAccountId is specified or initialPlatform is meta_ads
  useEffect(() => {
    if (!isOpen || connections.length === 0) return;
    if (initialAccountId || initialPlatform === "meta_ads") {
      for (const c of connections) {
        if (c.provider === "meta_ads" && !metaAccountsByConn[c.id]) {
          void fetchMetaAccounts(c.id);
        }
      }
    }
  }, [isOpen, connections, initialAccountId, initialPlatform, metaAccountsByConn, fetchMetaAccounts]);

  // Initialize selection based on current session context once connection data is available
  useEffect(() => {
    if (!isOpen || connections.length === 0) return;

    const currentSessionKey = deriveSessionKey({
      workspaceId,
      platform: initialPlatform ?? null,
      accountId: initialAccountId ?? null,
    });

    if (!needsReinit(currentSessionKey, initializedSessionKeyRef.current) || userModifiedSelectionRef.current) {
      return;
    }

    // Branch 1: initialAccountId is specified -> match targeted Meta ad account
    if (initialAccountId) {
      const normTarget = initialAccountId.replace(/^act_/, "").trim();
      let matchFound = false;

      for (const [connId, accounts] of Object.entries(metaAccountsByConn)) {
        if (!Array.isArray(accounts) || accounts.length === 0) continue;
        const match = accounts.find(
          (a) => a.id === initialAccountId || a.id.replace(/^act_/, "").trim() === normTarget
        );
        if (match) {
          matchFound = true;
          initializedSessionKeyRef.current = currentSessionKey;
          setSelectedConnIds(new Set([connId]));
          setMetaAcctPick({ [connId]: new Set([match.id]) });
          setAccountNotFoundNotice(null);
          break;
        }
      }

      if (matchFound) return;

      const metaConns = connections.filter((c) => c.provider === "meta_ads");
      const allLoaded = metaConns.length > 0 && metaConns.every((c) => Array.isArray(metaAccountsByConn[c.id]));

      if (allLoaded) {
        // All accounts loaded but no match found: fail closed (do NOT select random sources)
        setAccountNotFoundNotice(
          `Configured account ${initialAccountId} was not found in linked Meta connections. Please select an account manually.`
        );
        initializedSessionKeyRef.current = currentSessionKey;
      }
      return;
    }

    // Branch 2: initialPlatform is specified (e.g. google_ads, tiktok_business, etc.)
    if (initialPlatform) {
      const matching = connections.filter((c) => c.provider === initialPlatform);
      if (matching.length > 0) {
        setSelectedConnIds(new Set(matching.map((c) => c.id)));
      }
      initializedSessionKeyRef.current = currentSessionKey;
      return;
    }

    // Branch 3: No initialPlatform or initialAccountId -> conservative explicit selection (empty)
    initializedSessionKeyRef.current = currentSessionKey;
  }, [
    isOpen,
    workspaceId,
    connections,
    initialPlatform,
    initialAccountId,
    metaAccountsByConn,
  ]);

  const handlePreset = (days: number, key: "7" | "30" | "90") => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setEndDate(end.toISOString().split("T")[0]);
    setStartDate(start.toISOString().split("T")[0]);
    setPreset(key);
  };

  const toggleSource = (connId: string, provider: string) => {
    userModifiedSelectionRef.current = true;
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
    userModifiedSelectionRef.current = true;
    setMetaAcctPick((prev) => {
      const base = new Set(prev[connId] ?? []);
      if (base.has(acctId)) base.delete(acctId);
      else base.add(acctId);
      return { ...prev, [connId]: base };
    });
  };


  const isTargetAccountResolving = Boolean(
    initialAccountId &&
    connections.some((c) => c.provider === "meta_ads" && !Array.isArray(metaAccountsByConn[c.id])) &&
    Object.keys(metaAcctPick).length === 0 &&
    !accountNotFoundNotice
  );

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
      if (initialAccountId && (!loaded.length || picks == null || picks.size === 0)) {
        setErrorMessage("Target ad account could not be resolved. Please select an ad account manually.");
        setIsSubmitting(false);
        return;
      }
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
      onRefreshStarted?.();

      if (data.jobId) {
        setPollingJobId(data.jobId);
        setStep("polling");
      } else {
        const effSince = data.effectiveRange?.since || startDate;
        const effUntil = data.effectiveRange?.until || endDate;
        const totalRows =
          data.approximateRows ??
          (data.results?.reduce((s: number, r: any) => s + (r.rowsIngested ?? r.upserted ?? 0), 0) || 0);
        const syncStatus = data.success ? (data.status === "partial" ? "partial" : "completed") : "failed";
        setJobOutcome({
          id: "sync",
          status: syncStatus,
          since: effSince,
          until: effUntil,
          requestedRange: data.requestedRange,
          effectiveRange: data.effectiveRange,
          clamped: data.clamped,
          approximateRows: totalRows,
          totalItems: items.length,
          completedItems: data.results?.filter((r: any) => r.ok && r.outcome !== "failed")?.length || 0,
          results: data.results || [],
          errorMsg: data.errorMsg,
        });
        const nextStep = terminalStatusToUiStep(syncStatus);
        setStep(nextStep);
        if (nextStep === "error") {
          setErrorMessage(data.error || "Refresh failed");
        } else {
          onRefreshCompleted?.({
            since: effSince,
            until: effUntil,
            rowsIngested: totalRows,
          });
        }
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to start refresh");
      setStep("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (step !== "polling" || !pollingJobId) return;

    let isCancelled = false;
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/data-explorer/warehouse/jobs/${encodeURIComponent(pollingJobId)}`);
        if (!res.ok) return;
        const job = await res.json();
        if (isCancelled) return;

        if (job.status === "completed" || job.status === "partial" || job.status === "failed") {
          clearInterval(pollInterval);
          setJobOutcome(job);
          if (job.status === "failed") {
            setErrorMessage(job.errorMsg || "Import job failed");
            setStep("error");
          } else {
            const nextStep = terminalStatusToUiStep(job.status);
            setStep(nextStep);
            const effSince = job.effectiveRange?.since || job.since;
            const effUntil = job.effectiveRange?.until || job.until;
            const totalRows =
              job.approximateRows ??
              (job.results?.reduce((s: number, r: any) => s + (r.rowsIngested ?? r.upserted ?? 0), 0) || 0);
            onRefreshCompleted?.({
              since: effSince,
              until: effUntil,
              rowsIngested: totalRows,
            });
          }
        }
      } catch {
        /* Retry on next poll */
      }
    }, 1500);

    return () => {
      isCancelled = true;
      clearInterval(pollInterval);
    };
  }, [step, pollingJobId, onRefreshCompleted]);

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
                        userModifiedSelectionRef.current = true;
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

              {accountNotFoundNotice && (
                <div className="flex items-start gap-2 rounded-md border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-300">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span>{accountNotFoundNotice}</span>
                </div>
              )}

              {errorMessage && (
                <div className="flex items-start gap-2 rounded-md border border-red-900/50 bg-red-950/30 p-3 text-xs text-red-300">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>
          )}

          {step === "polling" && (
            <div className="py-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-canvas">
                <RefreshCw className="h-6 w-6 animate-spin text-ink" strokeWidth={1.5} />
              </div>
              <h4 className="text-base font-semibold text-ink">Refreshing warehouse data…</h4>
              <p className="mt-1.5 text-xs text-ink-mute">
                Extracting and persisting campaign metrics across {selectedConnIds.size} source{selectedConnIds.size === 1 ? "" : "s"} ({queuedCount} task{queuedCount === 1 ? "" : "s"}).
              </p>

              <p className="mt-1 text-[11px] text-ink-mute/70">
                This process runs asynchronously in your warehouse pipeline.
              </p>
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-line bg-canvas px-4 py-2 text-xs font-medium text-ink-mute hover:text-ink"
                >
                  Close & continue in background
                </button>
              </div>
            </div>
          )}

          {step === "success" && (() => {
            const effSince = jobOutcome?.effectiveRange?.since || jobOutcome?.since || startDate;
            const effUntil = jobOutcome?.effectiveRange?.until || jobOutcome?.until || endDate;
            const totalRows =
              jobOutcome?.approximateRows ??
              (jobOutcome?.results?.reduce((s: number, r: any) => s + (r.rowsIngested ?? r.upserted ?? 0), 0) || 0);
            const isClamped = Boolean(jobOutcome?.clamped);

            const isOutsideView =
              Boolean(initialStartDate && initialEndDate) &&
              (effSince < initialStartDate! || effUntil > initialEndDate! || effUntil < initialStartDate! || effSince > initialEndDate!);

            const allSelectedProviders = connections
              .filter((c) => selectedConnIds.has(c.id))
              .map((c) => c.provider);
            const uniformProvider =
              allSelectedProviders.length > 0 && allSelectedProviders.every((p) => p === allSelectedProviders[0])
                ? allSelectedProviders[0]
                : null;

            return (
              <div className="py-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-950/40">
                  <CheckCircle2 className="h-6 w-6 text-emerald-400" strokeWidth={1.5} />
                </div>
                <h4 className="text-base font-semibold text-ink">Warehouse refresh complete</h4>
                <p className="mt-1 text-sm text-ink-mute">
                  {totalRows} row{totalRows === 1 ? "" : "s"} imported for <span className="font-mono text-ink">{effSince}</span> to <span className="font-mono text-ink">{effUntil}</span>.
                </p>

                {isClamped && (
                  <div className="mx-auto mt-3 max-w-sm rounded-md border border-amber-900/50 bg-amber-950/20 p-2.5 text-left text-[11px] text-amber-300">
                    <div className="flex items-center gap-1.5 font-medium">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <span>Date range clamped by workspace plan</span>
                    </div>
                    <p className="mt-1 text-amber-300/80">
                      Requested: {jobOutcome?.requestedRange?.since || startDate} to {jobOutcome?.requestedRange?.until || endDate}. Effective: {effSince} to {effUntil}.
                    </p>
                  </div>
                )}

                {isOutsideView && (
                  <div className="mx-auto mt-3 max-w-sm rounded-md border border-sky-900/50 bg-sky-950/20 p-2.5 text-left text-[11px] text-sky-300">
                    <div className="flex items-center gap-1.5 font-medium">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                      <span>Imported data is outside your current view</span>
                    </div>
                    <p className="mt-1 text-sky-300/80">
                      Your workbench view is currently set to <span className="font-mono">{initialStartDate}</span> – <span className="font-mono">{initialEndDate}</span>.
                    </p>
                  </div>
                )}

                <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                  {onApplyViewFilters && (
                    <button
                      type="button"
                      onClick={() => {
                        onApplyViewFilters({
                          startDate: effSince,
                          endDate: effUntil,
                          platform: uniformProvider || initialPlatform || undefined,
                        });
                        onClose();
                      }}
                      className="w-full sm:w-auto rounded-md bg-white px-4 py-2 text-xs font-semibold text-neutral-900 hover:bg-neutral-100"
                    >
                      {isOutsideView ? `View imported data (${effSince} to ${effUntil})` : "Apply & view data"}
                    </button>
                  )}
                  <Link
                    href="/reports"
                    onClick={onClose}
                    className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-md border border-line bg-canvas px-4 py-2 text-xs font-medium text-ink hover:bg-white/[0.04]"
                  >
                    View sync activity <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full sm:w-auto rounded-md border border-line bg-panel px-4 py-2 text-xs font-medium text-ink-mute hover:text-ink"
                  >
                    Done
                  </button>
                </div>
              </div>
            );
          })()}

          {step === "partial" && (() => {
            const effSince = jobOutcome?.effectiveRange?.since || jobOutcome?.since || startDate;
            const effUntil = jobOutcome?.effectiveRange?.until || jobOutcome?.until || endDate;
            const totalRows =
              jobOutcome?.approximateRows ??
              (jobOutcome?.results?.reduce((s: number, r: any) => s + (r.rowsIngested ?? r.upserted ?? 0), 0) || 0);
            const isClamped = Boolean(jobOutcome?.clamped);

            const isOutsideView =
              Boolean(initialStartDate && initialEndDate) &&
              (effSince < initialStartDate! || effUntil > initialEndDate! || effUntil < initialStartDate! || effSince > initialEndDate!);

            const allSelectedProviders = connections
              .filter((c) => selectedConnIds.has(c.id))
              .map((c) => c.provider);
            const uniformProvider =
              allSelectedProviders.length > 0 && allSelectedProviders.every((p) => p === allSelectedProviders[0])
                ? allSelectedProviders[0]
                : null;

            const results = jobOutcome?.results ?? [];
            const failedResults = results.filter((r: any) => !r.ok || r.outcome === "failed");
            const successfulResults = results.filter((r: any) => r.ok && r.outcome !== "failed");
            const totalItemsCount = jobOutcome?.totalItems || (failedResults.length + successfulResults.length) || 1;
            const hasViewableData = canViewImportedData("partial", totalRows);

            return (
              <div className="py-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-amber-500/30 bg-amber-950/40">
                  <TriangleAlert className="h-6 w-6 text-amber-400" strokeWidth={1.5} />
                </div>
                <h4 className="text-base font-semibold text-ink">Warehouse refresh completed with warnings</h4>
                <p className="mt-1 text-sm text-ink-mute">
                  Some requested data may be missing. {totalRows} row{totalRows === 1 ? "" : "s"} imported for <span className="font-mono text-ink">{effSince}</span> to <span className="font-mono text-ink">{effUntil}</span>.
                </p>

                {jobOutcome?.errorMsg && (
                  <div className="mx-auto mt-3 max-w-sm rounded-md border border-amber-900/50 bg-amber-950/20 p-2.5 text-left text-[11px] text-amber-300">
                    <p className="font-medium text-amber-400">Warning</p>
                    <p className="mt-0.5 text-amber-300/80">{jobOutcome.errorMsg}</p>
                  </div>
                )}

                {failedResults.length > 0 && (
                  <div className="mx-auto mt-3 max-w-sm rounded-md border border-red-900/40 bg-red-950/20 p-2.5 text-left text-[11px]">
                    <p className="font-medium text-red-300">
                      Failed tasks ({failedResults.length}/{totalItemsCount}):
                    </p>
                    <ul className="mt-1.5 space-y-1 text-ink-mute">
                      {failedResults.map((r: any, idx: number) => {
                        const provName = PROVIDER_NAMES[r.provider] || r.provider || "Source";
                        const acct = r.adAccountId || r.accountId;
                        return (
                          <li key={idx} className="flex flex-col text-[10px]">
                            <span className="font-medium text-ink">
                              {provName}{acct ? ` (${acct})` : ""}:
                            </span>
                            <span className="text-red-400/90 truncate">{r.error || "Sync failed"}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {isClamped && (
                  <div className="mx-auto mt-3 max-w-sm rounded-md border border-amber-900/50 bg-amber-950/20 p-2.5 text-left text-[11px] text-amber-300">
                    <div className="flex items-center gap-1.5 font-medium">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <span>Date range clamped by workspace plan</span>
                    </div>
                    <p className="mt-1 text-amber-300/80">
                      Requested: {jobOutcome?.requestedRange?.since || startDate} to {jobOutcome?.requestedRange?.until || endDate}. Effective: {effSince} to {effUntil}.
                    </p>
                  </div>
                )}

                {isOutsideView && hasViewableData && (
                  <div className="mx-auto mt-3 max-w-sm rounded-md border border-sky-900/50 bg-sky-950/20 p-2.5 text-left text-[11px] text-sky-300">
                    <div className="flex items-center gap-1.5 font-medium">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                      <span>Imported data is outside your current view</span>
                    </div>
                    <p className="mt-1 text-sky-300/80">
                      Your workbench view is currently set to <span className="font-mono">{initialStartDate}</span> – <span className="font-mono">{initialEndDate}</span>.
                    </p>
                  </div>
                )}

                <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                  {onApplyViewFilters && hasViewableData && (
                    <button
                      type="button"
                      onClick={() => {
                        onApplyViewFilters({
                          startDate: effSince,
                          endDate: effUntil,
                          platform: uniformProvider || initialPlatform || undefined,
                        });
                        onClose();
                      }}
                      className="w-full sm:w-auto rounded-md bg-white px-4 py-2 text-xs font-semibold text-neutral-900 hover:bg-neutral-100"
                    >
                      {isOutsideView ? `View imported data (${effSince} to ${effUntil})` : "Apply & view data"}
                    </button>
                  )}
                  <Link
                    href="/reports"
                    onClick={onClose}
                    className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-md border border-line bg-canvas px-4 py-2 text-xs font-medium text-ink hover:bg-white/[0.04]"
                  >
                    View sync activity <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full sm:w-auto rounded-md border border-line bg-panel px-4 py-2 text-xs font-medium text-ink-mute hover:text-ink"
                  >
                    Done
                  </button>
                </div>
              </div>
            );
          })()}

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
              disabled={isSubmitting || connections.length === 0 || selectedConnIds.size === 0 || isTargetAccountResolving}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-4 py-2 text-xs font-semibold text-neutral-900 transition-colors hover:bg-neutral-100 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Queueing refresh…
                </>
              ) : isTargetAccountResolving ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Resolving account…
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
