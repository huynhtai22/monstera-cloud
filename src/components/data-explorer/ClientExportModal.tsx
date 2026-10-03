"use client";

import React, { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Copy, Check, FileSpreadsheet, Download, MessageSquare, Sparkles, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useMounted } from "@/hooks/useMounted";
import {
  calculateOverallKPIs,
  calculatePlatformRollups,
  calculateCampaignRollups,
  generateClientBriefMarkdown,
  formatCurrencyValue,
  type MetricRowExport,
} from "@/lib/client-export";
import { downloadCsv, downloadMultiSheetExcel } from "@/lib/export-utils";

interface ClientExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  rows: MetricRowExport[];
  dateRange: { start: string; end: string };
  dataThrough?: string | null;
  clientName?: string;
  hasMore?: boolean;
  isLoadingAll?: boolean;
  onLoadAll?: () => Promise<void>;
}

export function ClientExportModal({
  isOpen,
  onClose,
  rows,
  dateRange,
  dataThrough,
  clientName,
  hasMore,
  isLoadingAll,
  onLoadAll,
}: ClientExportModalProps) {
  const mounted = useMounted();
  const [activeTab, setActiveTab] = useState<"brief" | "excel" | "raw">("brief");
  const [copied, setCopied] = useState(false);

  const overall = useMemo(() => calculateOverallKPIs(rows), [rows]);
  const platformRollups = useMemo(() => calculatePlatformRollups(rows), [rows]);
  const campaignRollups = useMemo(() => calculateCampaignRollups(rows, 30), [rows]);

  const briefMarkdown = useMemo(() => {
    return generateClientBriefMarkdown({
      overall,
      platformRollups,
      campaignRollups,
      dateRange,
      dataThrough,
      clientName,
      isPartialData: Boolean(hasMore),
      totalRecordsLoaded: rows.length,
    });
  }, [overall, platformRollups, campaignRollups, dateRange, dataThrough, clientName, hasMore, rows.length]);

  const handleCopyBrief = async () => {
    try {
      await navigator.clipboard.writeText(briefMarkdown);
      setCopied(true);
      toast.success("Client brief copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy to clipboard.");
    }
  };

  const handleDownloadExecutiveExcel = () => {
    const summarySheetRows: Array<{ Metric: string; Value: string | number; Currency?: string }> = [];

    if (overall.isMixedCurrency && overall.currencyBreakdowns && overall.currencyBreakdowns.length > 0) {
      for (const cb of overall.currencyBreakdowns) {
        summarySheetRows.push(
          { Metric: `Ad Spend (${cb.currency})`, Value: cb.spend, Currency: cb.currency },
          { Metric: `Attributed Revenue (${cb.currency})`, Value: cb.revenue, Currency: cb.currency },
          { Metric: `ROAS (${cb.currency})`, Value: `${cb.roas.toFixed(2)}x`, Currency: cb.currency },
          { Metric: `CPA (${cb.currency})`, Value: cb.cpa > 0 ? Number(cb.cpa.toFixed(2)) : "—", Currency: cb.currency },
        );
      }
    } else {
      summarySheetRows.push(
        { Metric: "Total Ad Spend", Value: overall.totalSpend, Currency: overall.currency },
        { Metric: "Attributed Revenue", Value: overall.totalRevenue, Currency: overall.currency },
        { Metric: "Blended ROAS", Value: `${overall.blendedRoas.toFixed(2)}x`, Currency: overall.currency },
        { Metric: "Blended CPA", Value: overall.blendedCpa > 0 ? Number(overall.blendedCpa.toFixed(2)) : "—", Currency: overall.currency },
        { Metric: "Average CPC", Value: overall.averageCpc > 0 ? Number(overall.averageCpc.toFixed(2)) : "—", Currency: overall.currency },
      );
    }

    summarySheetRows.push(
      { Metric: "Total Conversions", Value: overall.totalConversions },
      { Metric: "Total Clicks", Value: overall.totalClicks },
      { Metric: "Average CTR", Value: `${overall.blendedCtr.toFixed(2)}%` },
      { Metric: "Total Impressions", Value: overall.totalImpressions },
      { Metric: "Reporting Period", Value: `${dateRange.start} to ${dateRange.end}` },
      { Metric: "Data Through", Value: dataThrough || "Latest" },
      { Metric: "Total Records Exported", Value: rows.length },
    );

    const platformSheetRows = platformRollups.map((p) => ({
      Platform: p.platformLabel,
      Spend: p.spend,
      Currency: p.currency,
      "Share of Spend (%)": Number(p.shareOfSpend.toFixed(1)),
      Conversions: p.conversions,
      CPA: Number(p.cpa.toFixed(2)),
      Revenue: p.revenue,
      ROAS: Number(p.roas.toFixed(2)),
      Clicks: p.clicks,
      "CTR (%)": Number(p.ctr.toFixed(2)),
      CPC: Number(p.cpc.toFixed(2)),
      Impressions: p.impressions,
    }));

    const campaignSheetRows = campaignRollups.map((c) => ({
      Campaign: c.campaignName,
      Platform: c.platformLabel,
      Account: c.accountName || c.accountId || "Default",
      "Campaign ID": c.campaignId || "",
      Spend: c.spend,
      Currency: c.currency,
      Conversions: c.conversions,
      CPA: Number(c.cpa.toFixed(2)),
      Revenue: c.revenue,
      ROAS: Number(c.roas.toFixed(2)),
    }));

    // Export ALL loaded records without arbitrary truncation
    const rawExportRows = rows.map((r) => ({
      Date: r.date.split("T")[0],
      Platform: pLabel(r.platform),
      Account: r.accountName || r.accountId || "",
      Campaign: r.campaignName || r.campaignId || "",
      Spend: r.spend,
      Impressions: r.impressions,
      Clicks: r.clicks,
      Conversions: r.conversions,
      Revenue: r.revenue,
      ROAS: r.roas ?? 0,
      Currency: r.currency || overall.currency,
    }));

    downloadMultiSheetExcel(
      [
        { name: "Executive Summary", rows: summarySheetRows },
        { name: "Platform Breakdown", rows: platformSheetRows },
        { name: "Top Campaigns", rows: campaignSheetRows },
        { name: "Granular Records", rows: rawExportRows },
      ],
      `Client-Performance-Report-${dateRange.start || "all"}-${dateRange.end || "now"}`
    );
    toast.success("Executive Excel report downloaded!");
  };

  const handleDownloadSummaryCsv = () => {
    const csvRows = platformRollups.map((p) => ({
      Platform: p.platformLabel,
      Spend: p.spend,
      "Share (%)": Number(p.shareOfSpend.toFixed(1)),
      Conversions: p.conversions,
      CPA: Number(p.cpa.toFixed(2)),
      Revenue: p.revenue,
      ROAS: Number(p.roas.toFixed(2)),
      Clicks: p.clicks,
      CTR: Number(p.ctr.toFixed(2)),
      CPC: Number(p.cpc.toFixed(2)),
      Currency: p.currency,
    }));
    downloadCsv(csvRows, `Platform-Summary-${dateRange.start}-${dateRange.end}`);
    toast.success("Summary CSV downloaded!");
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6 animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-line bg-panel shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Client reporting & export"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4 bg-canvas/60">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/[0.08] text-ink">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <h2 className="text-base font-semibold text-ink">
                Client Reporting & Export
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-ink-mute">
              Formatted performance briefs and multi-sheet summaries across channels.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-mute hover:bg-white/[0.06] hover:text-ink transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-line px-5 pt-3 bg-canvas/30">
          <button
            type="button"
            onClick={() => setActiveTab("brief")}
            className={`flex items-center gap-1.5 pb-2.5 px-2 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "brief"
                ? "border-accent text-ink"
                : "border-transparent text-ink-mute hover:text-ink"
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Client Brief (Slack / Telegram)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("excel")}
            className={`flex items-center gap-1.5 pb-2.5 px-2 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "excel"
                ? "border-accent text-ink"
                : "border-transparent text-ink-mute hover:text-ink"
            }`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Executive Excel & CSV
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {hasMore && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Showing {rows.length.toLocaleString()} records loaded. Additional warehouse records exist for this date range.
                </span>
              </div>
              {onLoadAll && (
                <button
                  type="button"
                  onClick={onLoadAll}
                  disabled={isLoadingAll}
                  className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold transition disabled:opacity-50 shrink-0 cursor-pointer"
                >
                  {isLoadingAll ? "Loading remaining..." : "Load all records"}
                </button>
              )}
            </div>
          )}

          {activeTab === "brief" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-ink-mute">
                  Ready-to-paste weekly performance brief:
                </span>
                <button
                  type="button"
                  onClick={handleCopyBrief}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90 transition-opacity"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied!" : "Copy Brief"}
                </button>
              </div>

              {/* Preview Block */}
              <div className="rounded-lg border border-line bg-canvas p-4 font-mono text-xs text-ink/90 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto select-all">
                {briefMarkdown}
              </div>

              <div className="rounded-lg border border-line/60 bg-white/[0.02] p-3 text-[11px] text-ink-mute">
                💡 <strong>Tip:</strong> Copy and paste this directly to your clients or media buyers. It includes blended CPA, ROAS, and platform breakdowns with zero manual calculations.
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-line bg-canvas p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
                  <span>Executive Multi-Sheet Excel (.xlsx)</span>
                </div>
                <p className="text-xs text-ink-mute leading-relaxed">
                  Generates an executive-ready Excel workbook formatted with 4 distinct sheets:
                </p>
                <ul className="text-xs text-ink-mute space-y-1 pl-4 list-disc">
                  <li><strong>Executive Summary</strong>: Overall spend, conversions, CPA, revenue, and ROAS.</li>
                  <li><strong>Platform Breakdown</strong>: Side-by-side comparison of Meta, Google, TikTok, Shopee.</li>
                  <li><strong>Top Campaigns</strong>: Top 30 campaigns ranked by ad spend.</li>
                  <li><strong>Granular Records</strong>: All filtered rows for deep auditing.</li>
                </ul>

                <button
                  type="button"
                  onClick={handleDownloadExecutiveExcel}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 text-xs font-semibold shadow-sm transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Download Executive Excel (.xlsx)
                </button>
              </div>

              <div className="rounded-lg border border-line bg-canvas p-4 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-ink">Platform Summary CSV</h4>
                  <p className="text-[11px] text-ink-mute">Lightweight CSV with spend, CPA, and ROAS per platform.</p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadSummaryCsv}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/[0.04] transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download CSV
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-line px-5 py-3 bg-canvas/40">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line bg-panel px-3.5 py-1.5 text-xs font-medium text-ink hover:bg-white/[0.04] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function pLabel(p: string): string {
  if (p === "meta_ads") return "Meta Ads";
  if (p === "google_ads") return "Google Ads";
  if (p === "tiktok_business") return "TikTok Ads";
  if (p === "shopee") return "Shopee";
  if (p === "lazada") return "Lazada";
  if (p === "shopify") return "Shopify";
  return p;
}
