"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Languages,
  Loader2,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeAnalystClientId } from "@/lib/client-context";
import { useWorkspaceStore } from "@/store/workspace";
import { ClientBriefModal } from "./ClientBriefModal";
import type { AnalystStructuredOutput } from "@/lib/ai/analyst";

type TurnResponse = {
  turnId?: string;
  status?: "answered" | "refused" | "queued";
  answer?: string;
  structured?: AnalystStructuredOutput;
  blockers?: string[];
  queuedCopy?: string;
  evidence?: {
    freshness?: string;
    currencies?: string[];
    lastDataThrough?: string | null;
    completeness?: { sourceCount?: number; partialCount?: number };
    attribution?: { model?: string; matchRate?: number };
  };
  error?: string;
};

const QUEUED_COPY = "Deeper briefs queue for the nightly AI worker.";

const SUPPORTED_PROMPTS = [
  {
    id: "summary",
    en: "Summarize this client’s performance",
    vi: "Tóm tắt hiệu quả của client này",
  },
  {
    id: "comparison",
    en: "Compare spend and reported conversions with the previous period",
    vi: "So sánh chi tiêu và chuyển đổi với kỳ trước",
  },
  {
    id: "campaigns",
    en: "Which campaigns contributed most to the revenue change?",
    vi: "Chiến dịch nào đóng góp nhiều nhất vào thay đổi doanh thu?",
  },
  {
    id: "health",
    en: "Which sources need attention before reporting?",
    vi: "Nguồn dữ liệu nào cần chú ý trước khi báo cáo?",
  },
] as const;

function analystEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_GOVERNED_ANALYST === "1";
}

export type AnalystPaneProps = {
  selectedClientId?: string | null;
  selectedClientName?: string;
  startDate?: string;
  endDate?: string;
};

export function AnalystPane({
  selectedClientId,
  selectedClientName,
  startDate,
  endDate,
}: AnalystPaneProps = {}) {
  const enabled = analystEnabled();
  const { activeWorkspaceId } = useWorkspaceStore();
  const searchParams = useSearchParams();

  // Normalize client id: URL representation vs prop
  const paramClientId = normalizeAnalystClientId(searchParams?.get("clientId") ?? null);
  const propClientId = normalizeAnalystClientId(selectedClientId ?? null);
  const effectiveClientId = selectedClientId !== undefined ? propClientId : paramClientId;
  const isConcreteClient = Boolean(
    effectiveClientId &&
    effectiveClientId !== "all" &&
    effectiveClientId !== "all_clients" &&
    effectiveClientId !== "unassigned"
  );

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TurnResponse | null>(null);
  const [language, setLanguage] = useState<"en" | "vi">("en");
  const [isBriefModalOpen, setIsBriefModalOpen] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Clear previous analyst output on workspace, client, or window change;
  // cancel in-flight queries when filters change.
  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setResult(null);
    setLoading(false);
  }, [activeWorkspaceId, effectiveClientId, startDate, endDate, language]);

  const sheetsHref = useMemo(() => {
    const params = new URLSearchParams();
    if (activeWorkspaceId) params.set("workspaceId", activeWorkspaceId);
    return `/exports?${params.toString()}`;
  }, [activeWorkspaceId]);

  if (!enabled) return null;

  const evidence = result?.evidence;
  const exportable = result?.status === "answered" && !result.blockers?.length;

  const ask = async (overrideQuestion?: string) => {
    const q = (overrideQuestion ?? question).trim();
    if (!activeWorkspaceId || !q || loading) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/ai/analyst/turns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          clientId: effectiveClientId ?? undefined,
          question: q,
        }),
        signal: controller.signal,
      });

      const data = (await res.json().catch(() => ({}))) as TurnResponse;

      if (res.status === 402) {
        setResult({ status: "refused", answer: data.error || "AI budget exceeded.", blockers: ["budget"] });
        return;
      }
      if (res.status === 404) {
        const unknownClient = data.error === "Client not found";
        setResult({
          status: "refused",
          answer: unknownClient ? "Selected client is no longer available." : "Governed analyst is not enabled.",
          blockers: [unknownClient ? "client" : "flag"],
        });
        return;
      }
      if (!res.ok) {
        setResult({ status: "refused", answer: data.error || "Request failed.", blockers: ["error"] });
        return;
      }
      setResult(data);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setResult({
        status: "refused",
        answer: "Request was interrupted or failed.",
        blockers: ["network_error"],
      });
    } finally {
      setLoading(false);
    }
  };

  const handleChipClick = (promptText: string) => {
    setQuestion(promptText);
    void ask(promptText);
  };

  const structured = result?.structured;

  return (
    <section className="rounded-lg border border-line bg-panel p-4 space-y-4">
      {/* Header and Scope Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line/60 pb-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-ink">Guided Warehouse Analyst</h2>
              {isConcreteClient ? (
                <span className="inline-flex items-center rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                  {selectedClientName || "Client Scope"}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                  Agency Overview
                </span>
              )}
            </div>
            <p className="text-xs text-ink-mute">
              Warehouse-grounded operational analysis.
              {!isConcreteClient
                ? " Answers reflect an agency overview across assigned and unassigned accounts."
                : ` Filtered to ${selectedClientName || "selected client"}.`}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Language Selector for Prompt Chips */}
          <div className="inline-flex rounded-md border border-line/80 bg-canvas p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setLanguage("en")}
              className={cn(
                "rounded px-2 py-1 font-medium transition-colors",
                language === "en" ? "bg-panel text-ink shadow-xs" : "text-ink-mute hover:text-ink"
              )}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLanguage("vi")}
              className={cn(
                "rounded px-2 py-1 font-medium transition-colors",
                language === "vi" ? "bg-panel text-ink shadow-xs" : "text-ink-mute hover:text-ink"
              )}
            >
              VI
            </button>
          </div>

          {/* Trigger Client Brief Button */}
          {isConcreteClient ? (
            <button
              type="button"
              onClick={() => setIsBriefModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 transition-colors border border-accent/30"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Generate Client Brief
            </button>
          ) : (
            <div className="group relative">
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-ink-mute cursor-not-allowed border border-line/50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Generate Client Brief
              </button>
              <div className="absolute right-0 top-full mt-1 hidden w-52 rounded-md border border-line bg-canvas p-2 text-[10px] text-ink-mute shadow-lg group-hover:block z-20">
                Select a concrete client above to generate an executive brief.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Supported Prompt Chips */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-mute">
          <Languages className="h-3 w-3" />
          <span>Supported questions ({language.toUpperCase()}):</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUPPORTED_PROMPTS.map((p) => {
            const promptText = language === "vi" ? p.vi : p.en;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleChipClick(promptText)}
                disabled={loading}
                className="rounded-full border border-line bg-canvas/80 px-2.5 py-1 text-[11px] text-ink-soft hover:bg-panel hover:text-ink hover:border-line-strong transition-colors text-left disabled:opacity-50"
              >
                {promptText}
              </button>
            );
          })}
        </div>
      </div>

      {/* Question Input */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void ask();
          }}
          aria-label="Ask warehouse analyst"
          placeholder="Ask a warehouse question (e.g. spend, conversions, health)..."
          className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink placeholder:text-ink-mute focus:outline-hidden focus:border-accent"
        />
        <button
          type="button"
          onClick={() => void ask()}
          disabled={loading || !activeWorkspaceId || !question.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-white px-3.5 py-2 text-xs font-semibold text-neutral-900 shadow-xs hover:bg-neutral-100 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ask"}
        </button>
      </div>

      {/* Queued Notice */}
      {result?.status === "queued" && (
        <div className="rounded-md border border-line bg-canvas p-3 text-xs text-ink-mute">
          {result.queuedCopy || QUEUED_COPY}
        </div>
      )}

      {/* Refused Notice */}
      {result?.status === "refused" && (
        <div className="flex gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-medium text-amber-100">{result.answer}</div>
            {result.blockers?.length ? (
              <div className="text-[11px] text-amber-300/80">Blockers: {result.blockers.join(", ")}</div>
            ) : null}
            <div className="text-[11px] text-amber-300/70">
              Best-effort answers are not exportable as verified client briefs.
            </div>
          </div>
        </div>
      )}

      {/* Structured Output Answer */}
      {result?.status === "answered" && structured ? (
        <div className="space-y-3 rounded-md border border-line bg-canvas p-3.5">
          {/* Scope Label Banner */}
          <div
            className={cn(
              "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-xs",
              structured.isAgencyOverview
                ? "bg-amber-500/10 border border-amber-500/30 text-amber-200"
                : "bg-panel border border-line text-ink"
            )}
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold uppercase tracking-wider text-[10px]">
                {structured.isAgencyOverview ? "Agency Overview" : "Client Context"}
              </span>
              <span className="text-ink-mute">·</span>
              <span>{structured.scopeLabel}</span>
            </div>
            {structured.isAgencyOverview && (
              <span className="text-[10px] text-amber-300/80 font-medium">
                Assigned + unassigned accounts
              </span>
            )}
          </div>

          {/* Headline */}
          <h3 className="text-sm font-semibold text-ink">{structured.headline}</h3>

          {/* Supporting Observations */}
          {structured.observations.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
                Supporting Observations
              </h4>
              <div className="grid gap-1.5">
                {structured.observations.map((obs, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-3 rounded-md border border-line/80 bg-panel/60 p-2.5 text-xs text-ink"
                  >
                    <span className="min-w-0 flex-1">{obs.text}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {obs.changePercentage != null && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            Number(obs.changePercentage) >= 0
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-rose-500/15 text-rose-400"
                          )}
                        >
                          {Number(obs.changePercentage) >= 0 ? (
                            <TrendingUp className="h-3 w-3" />
                          ) : (
                            <TrendingDown className="h-3 w-3" />
                          )}
                          {`${(Number(obs.changePercentage) * 100).toFixed(1)}%`}
                        </span>
                      )}
                      {obs.sources?.map((src) => (
                        <span
                          key={src}
                          className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-ink-mute border border-line"
                        >
                          {src}
                        </span>
                      ))}
                      {obs.metric && (
                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent uppercase">
                          {obs.metric}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suggested Operational Checks */}
          {structured.suggestedChecks.length > 0 && (
            <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-sky-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Suggested Operational Checks</span>
              </div>
              <ul className="list-disc pl-4 space-y-1 text-sky-100/90 text-[11px]">
                {structured.suggestedChecks.map((check, idx) => (
                  <li key={idx}>{check}</li>
                ))}
              </ul>
              <p className="text-[10px] text-sky-300/70 pt-0.5">
                Checks are operational investigations only — not automated budget reallocations.
              </p>
            </div>
          )}

          {/* Evidence and Limitations Disclosure */}
          <div className="rounded-md border border-line/60 bg-panel/40 p-2.5 text-[11px] space-y-1.5 text-ink-mute">
            <div className="flex items-center gap-1 font-semibold text-ink-soft uppercase tracking-wider text-[10px]">
              <HelpCircle className="h-3 w-3" />
              <span>Evidence & Limitations</span>
            </div>
            <ul className="list-disc pl-4 space-y-0.5 text-[10px]">
              {structured.limitations.map((lim, idx) => (
                <li key={idx}>{lim}</li>
              ))}
            </ul>
            {evidence && (
              <div className="mt-2 pt-2 border-t border-line/40 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                <div>
                  <span className="text-ink-mute">Freshness: </span>
                  <span className="text-ink font-medium">{evidence.freshness ?? "unknown"}</span>
                </div>
                <div>
                  <span className="text-ink-mute">Currency: </span>
                  <span className="text-ink font-medium">
                    {(evidence.currencies ?? []).join(", ") || "unknown"}
                  </span>
                </div>
                <div>
                  <span className="text-ink-mute">Attribution: </span>
                  <span className="text-ink font-medium">
                    {evidence.attribution?.model ?? "platform-reported"}
                  </span>
                </div>
                <div>
                  <span className="text-ink-mute">Sources: </span>
                  <span className="text-ink font-medium">
                    {evidence.completeness?.sourceCount ?? 0}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : result?.status === "answered" && result.answer ? (
        /* Fallback raw answer formatting */
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-canvas px-3 py-2 text-[11px] text-ink">
          {result.answer}
        </pre>
      ) : null}

      {/* Export status */}
      <div className="flex items-center justify-between pt-1">
        {exportable ? (
          <a href={sheetsHref} className="inline-flex text-xs font-semibold text-ink underline">
            Open in Sheets
          </a>
        ) : result?.status === "answered" ? (
          <p className="text-[11px] text-ink-mute">
            Dataset is best-effort — not exportable as a verified client brief.
          </p>
        ) : <div />}

        {isConcreteClient && result?.status === "answered" && (
          <button
            type="button"
            onClick={() => setIsBriefModalOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline"
          >
            <Sparkles className="h-3 w-3" />
            Generate full executive brief for {selectedClientName || "this client"} →
          </button>
        )}
      </div>

      {/* Client Brief Modal */}
      {isConcreteClient && activeWorkspaceId && effectiveClientId && (
        <ClientBriefModal
          isOpen={isBriefModalOpen}
          onClose={() => setIsBriefModalOpen(false)}
          workspaceId={activeWorkspaceId}
          clientId={effectiveClientId}
          clientName={selectedClientName}
        />
      )}
    </section>
  );
}
