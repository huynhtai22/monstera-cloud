"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Printer,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExecutiveBriefResponse, ReportingWindowPreset } from "@/lib/ai/reporting-contracts";

type ClientBriefModalProps = {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  clientId: string | null;
  clientName?: string;
};

export function ClientBriefModal({
  isOpen,
  onClose,
  workspaceId,
  clientId,
  clientName,
}: ClientBriefModalProps) {
  const [dateRange, setDateRange] = useState<ReportingWindowPreset>("last_7d");
  const [language, setLanguage] = useState<"en" | "vi">("en");
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<ExecutiveBriefResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [copiedFormat, setCopiedFormat] = useState<"markdown" | "text" | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);

  // Preserve and restore focus
  useEffect(() => {
    if (isOpen) {
      triggerElementRef.current = document.activeElement as HTMLElement | null;
      // Focus first interactive control in modal on open
      requestAnimationFrame(() => {
        const firstFocusable = modalRef.current?.querySelector<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        firstFocusable?.focus();
      });
    } else if (triggerElementRef.current) {
      triggerElementRef.current.focus();
      triggerElementRef.current = null;
    }
  }, [isOpen]);

  // Handle Escape key and focus trap
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);

        if (focusableElements.length === 0) {
          e.preventDefault();
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const fetchBrief = useCallback(async () => {
    if (!workspaceId || !clientId || clientId === "all" || clientId === "unassigned") {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/executive-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          clientId,
          dateRange,
          language,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to generate executive brief.");
        setBrief(null);
        return;
      }
      setBrief(data.brief);
    } catch {
      setError("Network error while generating brief.");
      setBrief(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, clientId, dateRange, language]);

  useEffect(() => {
    if (isOpen && clientId && clientId !== "all" && clientId !== "unassigned") {
      void fetchBrief();
    } else {
      setBrief(null);
      setError(null);
    }
  }, [isOpen, clientId, fetchBrief]);

  if (!isOpen) return null;

  const exportEligible = brief?.readiness.exportEligible === true;
  const isVi = language === "vi";

  const requestServerExport = async (format: "markdown" | "text" | "print"): Promise<string | null> => {
    if (!brief) return null;
    setIsExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/ai/executive-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          clientId,
          dateRange,
          language,
          action: "export",
          expectedFingerprint: brief.fingerprint,
          format,
        }),
      });

      if (res.status === 409) {
        setExportError(
          isVi
            ? "Dữ liệu kho đã cập nhật kể từ lần xem trước. Đang tạo lại báo cáo..."
            : "Warehouse data changed since preview was generated. Regenerating brief...",
        );
        void fetchBrief();
        return null;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setExportError(err.error || (isVi ? "Xuất báo cáo bị từ chối." : "Export not permitted."));
        return null;
      }

      const data = await res.json();
      return typeof data.content === "string" ? data.content : null;
    } catch {
      setExportError(isVi ? "Lỗi kết nối khi xuất báo cáo." : "Connection error during export.");
      return null;
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopy = async (format: "markdown" | "text") => {
    const text = await requestServerExport(format);
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // Fallback for headless or restricted clipboard contexts
    }
    setCopiedFormat(format);
    setTimeout(() => setCopiedFormat(null), 2500);
  };

  const handlePrint = async () => {
    const text = await requestServerExport("print");
    if (!text) return;
    window.print();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="brief-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs print:static print:bg-white print:p-0 print:m-0 print:block"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border border-line bg-panel shadow-2xl print:max-h-none print:w-full print:border-none print:shadow-none print:bg-white print:text-black print:overflow-visible print:p-0"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4 print:border-none print:px-0 print:py-2">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-indigo-400 print:hidden" />
            <div>
              <h2 id="brief-modal-title" className="text-base font-semibold text-ink print:text-black print:text-xl">
                Executive Client Brief
                {clientName ? <span className="font-normal text-ink-mute print:text-neutral-700"> · {clientName}</span> : ""}
              </h2>
              <p className="text-xs text-ink-mute print:text-neutral-600">
                Verified, truth-first client brief built directly from warehouse evidence.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-ink-mute hover:bg-canvas hover:text-ink print:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Controls Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas/40 px-6 py-3 print:hidden">
          <div className="flex items-center gap-3">
            {/* Period Selector */}
            <div className="flex rounded-md border border-line bg-panel p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setDateRange("last_7d")}
                className={cn(
                  "rounded-sm px-3 py-1 font-medium transition",
                  dateRange === "last_7d" ? "bg-white text-neutral-900 shadow-xs" : "text-ink-mute hover:text-ink",
                )}
              >
                Last 7 Days
              </button>
              <button
                type="button"
                onClick={() => setDateRange("last_30d")}
                className={cn(
                  "rounded-sm px-3 py-1 font-medium transition",
                  dateRange === "last_30d" ? "bg-white text-neutral-900 shadow-xs" : "text-ink-mute hover:text-ink",
                )}
              >
                Last 30 Days
              </button>
            </div>

            {/* Language Selector */}
            <div className="flex rounded-md border border-line bg-panel p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setLanguage("en")}
                className={cn(
                  "rounded-sm px-2.5 py-1 font-medium transition",
                  language === "en" ? "bg-white text-neutral-900 shadow-xs" : "text-ink-mute hover:text-ink",
                )}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLanguage("vi")}
                className={cn(
                  "rounded-sm px-2.5 py-1 font-medium transition",
                  language === "vi" ? "bg-white text-neutral-900 shadow-xs" : "text-ink-mute hover:text-ink",
                )}
              >
                VI
              </button>
            </div>
          </div>

          {/* Export Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopy("markdown")}
              disabled={!exportEligible || loading || isExporting}
              title={!exportEligible ? "Client export disabled — dataset is not report ready." : "Copy as Markdown"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-canvas disabled:opacity-40",
              )}
            >
              {copiedFormat === "markdown" ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedFormat === "markdown" ? "Copied" : isExporting ? "Exporting..." : "Copy Markdown"}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={!exportEligible || loading || isExporting}
              title={!exportEligible ? "Client print disabled — dataset is not report ready." : "Print or Save as PDF"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-neutral-900 shadow-xs transition hover:bg-neutral-100 disabled:opacity-40",
              )}
            >
              <Printer className="h-3.5 w-3.5" />
              {isExporting ? "Preparing..." : "Print / PDF"}
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 print:overflow-visible print:p-0 print:m-0 print:space-y-4">
          {(!clientId || clientId === "all" || clientId === "unassigned") ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="h-10 w-10 text-amber-400 mb-3" />
              <h3 className="text-sm font-semibold text-ink">Concrete Client Required</h3>
              <p className="max-w-md text-xs text-ink-mute mt-1">
                Executive client briefs cannot target all clients or unassigned sources. Please select a specific client from the filter.
              </p>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-ink-mute mb-3" />
              <p className="text-xs text-ink-mute">Evaluating warehouse evidence and generating executive brief...</p>
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-xs text-red-200 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4" /> Error Generating Brief
              </div>
              <div>{error}</div>
            </div>
          ) : brief ? (
            <div className="space-y-6 print:m-0 print:p-0">
              {exportError && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
                  <span>{exportError}</span>
                </div>
              )}
              {/* Readiness Banner */}
              <div
                className={cn(
                  "flex items-start justify-between rounded-lg border px-4 py-3 text-xs",
                  exportEligible
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-200",
                )}
              >
                <div className="flex items-start gap-2.5">
                  {exportEligible ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                  )}
                  <div>
                    <div className="font-semibold">
                      {exportEligible
                        ? "Verified Report-Ready (Client Export Permitted)"
                        : `Internal Preview Only (${brief.readiness.status}) — Export Blocked`}
                    </div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      Period: {brief.window.current.start} to {brief.window.current.end} ({brief.window.daysCount} days, {brief.window.timezone}) · Mode: {brief.generationMode}
                    </div>
                    {brief.readiness.blockers.length > 0 ? (
                      <div className="mt-1 text-[11px] font-mono text-red-300">
                        Blockers: {brief.readiness.blockers.join(", ")}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="text-right text-[11px] text-ink-mute font-mono">
                  Fingerprint: {brief.fingerprint.slice(0, 10)}...
                </div>
              </div>

              {/* Headline Card */}
              <div className="rounded-lg border border-line bg-canvas p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-mute mb-2">
                  {isVi ? "Tóm tắt điều hành" : "Executive Headline"}
                </h3>
                <p className="text-sm font-medium text-ink leading-relaxed">
                  {brief.sections.headline}
                </p>
              </div>

              {/* KPI Scorecard Grid */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-mute">
                    {isVi ? "Bảng chỉ số chính (KPI Scorecard)" : "KPI Scorecard"}
                  </h3>
                  {brief.window.comparisonAvailable === false && (
                    <span className="text-[11px] text-amber-400 font-medium">
                      {isVi ? "Không so sánh kỳ trước (giới hạn gói)" : "Comparison unavailable (plan limit)"}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {brief.sections.kpiScorecard.slice(0, 8).map((kpi) => {
                    const chg = kpi.percentageChange != null ? (kpi.percentageChange * 100).toFixed(1) : null;
                    const isPositive = kpi.percentageChange != null && kpi.percentageChange >= 0;
                    return (
                      <div key={kpi.metricId} className="rounded-lg border border-line bg-canvas p-3">
                        <div className="text-[11px] text-ink-mute truncate">{kpi.name}</div>
                        <div className="text-base font-bold text-ink mt-1">
                          {kpi.currentValue != null
                            ? (kpi.currency ? `${kpi.currency} ${kpi.currentValue.toLocaleString()}` : (kpi.metricId === "roas" ? `${kpi.currentValue.toFixed(2)}x` : (kpi.metricId === "ctr" ? `${(kpi.currentValue * 100).toFixed(2)}%` : kpi.currentValue.toLocaleString())))
                            : "N/A"}
                        </div>
                        {chg != null ? (
                          <div className={cn("text-[11px] font-medium mt-1", isPositive ? "text-emerald-400" : "text-amber-400")}>
                            {isPositive ? "+" : ""}{chg}% vs prior period
                          </div>
                        ) : brief.window.comparisonAvailable === false ? (
                          <div className="text-[11px] text-amber-400/90 mt-1 font-medium">Comparison unavailable (plan limit)</div>
                        ) : (
                          <div className="text-[11px] text-ink-mute/70 mt-1">Zero prior baseline</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Channel Scorecard */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-mute mb-3">
                  {isVi ? "Hiệu quả theo kênh" : "Channel Scorecard"}
                </h3>
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-canvas text-ink-mute border-b border-line">
                      <tr>
                        <th className="px-3.5 py-2.5 font-semibold">Channel</th>
                        <th className="px-3.5 py-2.5 font-semibold">Spend</th>
                        <th className="px-3.5 py-2.5 font-semibold">Conversions / Orders</th>
                        <th className="px-3.5 py-2.5 font-semibold">Revenue</th>
                        <th className="px-3.5 py-2.5 font-semibold">ROAS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {brief.sections.channelScorecard.map((ch) => (
                        <tr key={`${ch.channel}-${ch.currency}`} className="hover:bg-canvas/50">
                          <td className="px-3.5 py-2.5 font-medium text-ink uppercase">{ch.channel}</td>
                          <td className="px-3.5 py-2.5 text-ink">
                            {ch.spend != null ? `${ch.currency} ${ch.spend.toLocaleString()}` : "—"}
                          </td>
                          <td className="px-3.5 py-2.5 text-ink">
                            {ch.orders != null ? `${ch.orders.toLocaleString()} orders` : (ch.conversions != null ? `${ch.conversions.toLocaleString()} conv.` : "—")}
                          </td>
                          <td className="px-3.5 py-2.5 text-ink">
                            {ch.orderRevenue != null ? `${ch.currency} ${ch.orderRevenue.toLocaleString()}` : (ch.conversionValue != null ? `${ch.currency} ${ch.conversionValue.toLocaleString()}` : "—")}
                          </td>
                          <td className="px-3.5 py-2.5 text-ink">
                            {ch.roas != null ? `${ch.roas.toFixed(2)}x` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Key Observations */}
              <div className="rounded-lg border border-line bg-canvas p-4 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-mute">
                  {isVi ? "Quan sát và đóng góp chính" : "Key Observations"}
                </h3>
                <ul className="space-y-1.5 text-xs text-ink list-disc list-inside">
                  {brief.sections.observations.map((obs) => (
                    <li key={obs.id}>{obs.text}</li>
                  ))}
                </ul>
              </div>

              {/* Suggested Next Steps */}
              <div className="rounded-lg border border-line bg-canvas p-4 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-mute">
                  {isVi ? "Hành động đề xuất (Suggested Checks)" : "Suggested Checks & Next Steps"}
                </h3>
                <ul className="space-y-1.5 text-xs text-ink list-disc list-inside">
                  {brief.sections.suggestedChecks.map((check, idx) => (
                    <li key={idx}>{check}</li>
                  ))}
                </ul>
              </div>

              {/* Sources and Limitations Disclosure */}
              <div className="rounded-lg border border-line bg-canvas/40 p-4 space-y-1.5 text-[11px] text-ink-mute">
                <div className="font-semibold uppercase tracking-wider text-ink-mute/80">
                  {isVi ? "Nguồn dữ liệu & Giới hạn quy kết" : "Data Sources & Attribution Disclosures"}
                </div>
                {brief.sections.sourcesAndLimitations.map((lim, idx) => (
                  <div key={idx}>· {lim}</div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
