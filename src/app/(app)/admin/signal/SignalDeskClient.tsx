"use client";

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  Compass,
  Copy,
  ExternalLink,
  FileText,
  Flame,
  Gauge,
  Radio,
  RefreshCw,
  Search as SearchIcon,
  ShieldAlert,
  Sparkles,
  Terminal,
  TrendingUp,
} from "lucide-react";
import { signalApi } from "@/lib/signal-api";
import type {
  Draft,
  EvidenceItem,
  Health,
  Idea,
  MorningBrief,
  MorningBriefOpportunity,
  SearchDetail,
  SearchSummary,
} from "@/types/signal-desk";
import { FeedbackBar } from "./FeedbackBar";
import { PreferenceInsightsCard } from "./PreferenceInsightsCard";


type DraftDepth = "concise" | "standard" | "deep";

const SCORE_ROWS: { key: keyof NonNullable<Draft["score"]>; label: string; risk?: boolean }[] = [
  { key: "reply_potential", label: "Reply Potential" },
  { key: "share_potential", label: "Share Potential" },
  { key: "dwell_potential", label: "Curiosity / Surprise" },
  { key: "follow_potential", label: "Specificity" },
  { key: "originality", label: "Originality" },
  { key: "spam_risk", label: "Spam Risk", risk: true },
];

function statusLabel(status: string) {
  switch (status) {
    case "created":
      return "Starting discovery…";
    case "discovering":
      return "Discovering broad tech signals…";
    case "collecting_x":
      return "Acquiring bounded X conversations…";
    case "searching_web":
      return "Validating against web sources…";
    case "clustering":
      return "Clustering topics & cross-referencing signals…";
    case "synthesizing":
      return "Synthesizing underused opportunities…";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

function useElapsed(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function SignalDeskClient({ userEmail }: { userEmail: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const collectionIdParam = searchParams.get("collection");

  // Hub state
  const [keyword, setKeyword] = useState("");
  const [mode] = useState("keyword");
  const [health, setHealth] = useState<Health | null>(null);
  const [items, setItems] = useState<SearchSummary[]>([]);
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [researchingOppId, setResearchingOppId] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Active collection state
  const [activeCollection, setActiveCollection] = useState<SearchDetail | null>(null);
  const [operation, setOperation] = useState<"analysis" | "draft" | "score" | null>(null);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);
  const [draftDepth, setDraftDepth] = useState<DraftDepth>("standard");

  const elapsed = useElapsed(Boolean(operation));

  // Initial load
  useEffect(() => {
    signalApi.health().then(setHealth).catch(() => setHealth(null));
    signalApi
      .listSearches()
      .then((data) => setItems(data.items))
      .catch((err) => setGlobalError(err.message));

    signalApi
      .getLatestMorningBrief()
      .then((res) => {
        if (res.brief) setBrief(res.brief);
      })
      .catch(() => {});
  }, []);

  // Polling for active Morning Brief
  useEffect(() => {
    if (!brief || brief.status === "completed" || brief.status === "failed") {
      setBriefBusy(false);
      return;
    }

    setBriefBusy(true);
    const interval = setInterval(async () => {
      try {
        const updated = await signalApi.getMorningBrief(brief.id);
        setBrief(updated);
        if (updated.status === "completed" || updated.status === "failed") {
          setBriefBusy(false);
          clearInterval(interval);
          if (updated.status === "completed") {
            toast.success("Curator Brief run completed!");
          } else {
            toast.error(updated.error_message || "Curator Brief run failed");
          }
        }
      } catch {
        // Keep polling on transient errors
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [brief]);

  // Load active collection if URL param exists
  const loadCollection = useCallback(async (id: string, version?: number) => {
    try {
      const data = await signalApi.getSearch(id, version);
      setActiveCollection(data);
      if (data.analysis?.ideas?.length) {
        const firstIdea = data.analysis.ideas[0];
        if (firstIdea.drafts?.length && !selectedDraft) {
          setSelectedIdea(firstIdea);
          setSelectedDraft(firstIdea.drafts[0]);
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load collection");
      setGlobalError(err.message);
    }
  }, [selectedDraft]);

  useEffect(() => {
    if (collectionIdParam) {
      loadCollection(collectionIdParam);
    } else {
      setActiveCollection(null);
      setSelectedDraft(null);
      setSelectedIdea(null);
    }
  }, [collectionIdParam, loadCollection]);

  // Actions
  async function onRunMorningBrief() {
    if (briefBusy) return;
    setBriefBusy(true);
    setGlobalError(null);
    try {
      const newBrief = await signalApi.runMorningBrief();
      setBrief(newBrief);
      toast.info("Curator Brief started in background");
    } catch (err: any) {
      setGlobalError(err.message || "Curator Brief failed to start");
      toast.error(err.message || "Curator Brief failed to start");
      setBriefBusy(false);
    }
  }

  async function onStartSearch(event: FormEvent) {
    event.preventDefault();
    const clean = keyword.trim();
    if (!clean || searchBusy) return;

    if (/what('s| is) happening in tech today/i.test(clean)) {
      onRunMorningBrief();
      return;
    }

    setSearchBusy(true);
    setGlobalError(null);
    try {
      const search = await signalApi.createSearch(clean, mode);
      const summaryItem: SearchSummary = {
        id: search.id,
        keyword: search.keyword,
        query: search.query,
        source: search.source,
        status: search.status,
        error_message: search.error_message,
        research_metadata: search.research_metadata,
        post_count: search.posts?.length ?? 0,
        created_at: search.created_at,
      };
      setItems((prev) => [summaryItem, ...prev.filter((i) => i.id !== search.id)]);
      setKeyword("");
      router.push(`/admin/signal?collection=${search.id}`);
    } catch (err: any) {
      setGlobalError(err.message || "Search failed");
      toast.error(err.message || "Search failed");
    } finally {
      setSearchBusy(false);
    }
  }

  async function onResearchOpportunity(opp: MorningBriefOpportunity) {
    setResearchingOppId(opp.id);
    setGlobalError(null);
    try {
      const context = {
        source_opportunity_id: opp.id,
        opportunity_title: opp.title,
        underused_angle: opp.underused_angle,
        dominant_narrative: opp.dominant_narrative,
        why_angle_valuable: opp.why_angle_valuable,
        suggested_query: opp.suggested_query,
        opportunity_score: opp.content_opportunity_score,
      };
      const search = await signalApi.createSearch(opp.title, "trending", context);
      const summaryItem: SearchSummary = {
        id: search.id,
        keyword: search.keyword,
        query: search.query,
        source: search.source,
        status: search.status,
        error_message: search.error_message,
        research_metadata: search.research_metadata,
        post_count: search.posts?.length ?? 0,
        created_at: search.created_at,
      };
      setItems((prev) => [summaryItem, ...prev.filter((i) => i.id !== search.id)]);
      router.push(`/admin/signal?collection=${search.id}`);
    } catch (err: any) {
      setGlobalError(err.message || "Failed to seed research from opportunity");
      toast.error(err.message || "Failed to start research");
      setResearchingOppId(null);
    }
  }

  async function runAnalysis(depth: "fast" | "deep") {
    if (!activeCollection) return;
    setOperation("analysis");
    setGlobalError(null);
    try {
      const updated = await signalApi.analyze(activeCollection.id, depth);
      setActiveCollection(updated);
      toast.success("Research analysis completed!");
    } catch (err: any) {
      setGlobalError(err.message || "Analysis failed");
      toast.error(err.message || "Analysis failed");
    } finally {
      setOperation(null);
    }
  }

  async function writeDraft(idea: Idea, depth = draftDepth) {
    setSelectedIdea(idea);
    setOperation("draft");
    setGlobalError(null);
    try {
      const draft = await signalApi.createDraft(idea.id, depth);
      setSelectedDraft(draft);
      if (activeCollection) {
        await loadCollection(activeCollection.id, activeCollection.analysis?.version);
      }
      toast.success("Draft generated successfully");
      document.getElementById("draft-workspace")?.scrollIntoView({ behavior: "smooth" });
    } catch (err: any) {
      setGlobalError(err.message || "Draft generation failed");
      toast.error(err.message || "Draft generation failed");
    } finally {
      setOperation(null);
    }
  }

  async function scoreDraft() {
    if (!selectedDraft) return;
    setOperation("score");
    setGlobalError(null);
    try {
      const draft = await signalApi.scoreDraft(selectedDraft.id);
      setSelectedDraft(draft);
      if (activeCollection) {
        await loadCollection(activeCollection.id, activeCollection.analysis?.version);
      }
      toast.success("Content Potential Score calculated");
    } catch (err: any) {
      setGlobalError(err.message || "Draft scoring failed");
      toast.error(err.message || "Draft scoring failed");
    } finally {
      setOperation(null);
    }
  }

  const allDrafts = useMemo(() => {
    return (
      activeCollection?.analysis?.ideas.flatMap((idea) =>
        idea.drafts.map((draft) => ({ idea, draft }))
      ) ?? []
    );
  }, [activeCollection]);

  const stage =
    operation === "analysis"
      ? "Insights"
      : operation === "draft"
      ? "Draft"
      : operation === "score"
      ? "Score"
      : selectedDraft
      ? "Draft"
      : activeCollection?.analysis
      ? "Ideas"
      : "Research";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">
      {/* ── Top Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-200 dark:border-[#2f3336] pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
              <Radio className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                  Signal Desk
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 dark:bg-cyan-950/60 px-2 py-0.5 text-xs font-semibold text-cyan-700 dark:text-cyan-300 ring-1 ring-inset ring-cyan-600/20">
                  <Sparkles className="h-3 w-3" /> Private Engine
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Autonomous X + Web intelligence & content generation desk.
              </p>
            </div>
          </div>
        </div>

        {/* Health status bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300">
            <span
              className={`h-2 w-2 rounded-full ${
                health?.cloud_llm_status === "ready"
                  ? "bg-emerald-500"
                  : health?.llm_configured
                  ? "bg-amber-500"
                  : "bg-red-500"
              }`}
            />
            <span>LLM: {health?.active_llm_model || "deepseek-v4-flash"}</span>
          </div>

          <div className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300">
            <span
              className={`h-2 w-2 rounded-full ${
                health?.web_status === "ready"
                  ? "bg-emerald-500"
                  : health?.tavily_web_status === "ready"
                  ? "bg-amber-500"
                  : "bg-red-500"
              }`}
            />
            <span>
              Web Search:{" "}
              {health?.web_status === "ready" 
                ? "ready" 
                : health?.tavily_web_status === "ready"
                  ? "degraded · Tavily fallback ready"
                  : (health?.web_status || "checking")}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className="p-2 rounded-lg border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] hover:bg-gray-50 dark:hover:bg-[#1d1f23] text-gray-500 dark:text-gray-400 transition-colors"
            title="Technical Diagnostics"
          >
            <Terminal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Technical Diagnostics (Collapsible) ────────────────────── */}
      {showDiagnostics && (
        <div className="rounded-xl border border-gray-200 dark:border-[#2f3336] bg-gray-50/80 dark:bg-[#16181c]/80 p-4 text-xs font-mono space-y-2 animate-in fade-in duration-200">
          <div className="flex items-center justify-between font-bold text-gray-700 dark:text-gray-300">
            <span>Diagnostics & Service Telemetry</span>
            <span className="text-[10px] text-gray-400 font-normal">Admin: {userEmail}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-gray-600 dark:text-gray-400">
            <div>Provider: {health?.active_llm_provider || "deepseek"}</div>
            <div>Cloud LLM: {health?.cloud_llm_status || "unknown"}</div>
            <div>X Source: {health?.x_provider || "x_api"}</div>
            <div>Local Ollama Fallback: {health?.local_llm_status || "disabled"}</div>
          </div>
        </div>
      )}

      {/* ── Global Alert Banner ────────────────────────────────────── */}
      {globalError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Signal Desk Notice</p>
            <p className="mt-0.5 text-xs opacity-90">{globalError}</p>
          </div>
          <button
            type="button"
            onClick={() => setGlobalError(null)}
            className="text-xs font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Main Surface ───────────────────────────────────────────── */}
      {activeCollection ? (
        /* ═══════════════════════════════════════════════════════════
           COLLECTION & RESEARCH DETAIL VIEW
           ═══════════════════════════════════════════════════════════ */
        <div className="space-y-6">
          {/* Breadcrumb & Top Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push("/admin/signal")}
                className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> Discovery Hub
              </button>
              <span className="text-gray-300 dark:text-gray-700">/</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white truncate max-w-md">
                {activeCollection.keyword}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => runAnalysis("fast")}
                disabled={Boolean(operation) || activeCollection.status !== "completed"}
                className="flex items-center gap-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white px-4 py-2 text-sm font-semibold transition-colors shadow-sm"
              >
                {operation === "analysis" ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {operation === "analysis"
                  ? "Analyzing…"
                  : activeCollection.analysis
                  ? "Analyze Again"
                  : "Analyze Research"}
              </button>

              <button
                type="button"
                onClick={() => runAnalysis("deep")}
                disabled={Boolean(operation) || activeCollection.status !== "completed"}
                className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] hover:bg-gray-50 dark:hover:bg-[#1d1f23] disabled:opacity-50 text-gray-700 dark:text-gray-300 px-4 py-2 text-sm font-semibold transition-colors"
              >
                Deep Research
              </button>
            </div>
          </div>

          {/* Workflow Stepper */}
          <div className="flex items-center justify-between rounded-xl border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] px-6 py-3 text-xs font-semibold overflow-x-auto">
            {["Research", "Insights", "Ideas", "Draft", "Score"].map((step, idx) => {
              const isActive = step === stage;
              return (
                <React.Fragment key={step}>
                  {idx > 0 && (
                    <ChevronRight className="h-4 w-4 text-gray-300 dark:text-gray-700 shrink-0 mx-2" />
                  )}
                  <span
                    className={`flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                      isActive
                        ? "text-cyan-600 dark:text-cyan-400 font-bold"
                        : "text-gray-400 dark:text-gray-600"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                        isActive
                          ? "bg-cyan-500 text-white"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-500"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    {step}
                  </span>
                </React.Fragment>
              );
            })}
          </div>

          {/* Operation Status Bar */}
          {operation && (
            <div className="flex items-center justify-between rounded-xl border border-cyan-200 dark:border-cyan-800/60 bg-cyan-50/70 dark:bg-cyan-950/40 px-5 py-3 text-sm text-cyan-900 dark:text-cyan-200 animate-pulse">
              <div className="flex items-center gap-2.5">
                <RefreshCw className="h-4 w-4 animate-spin text-cyan-600 dark:text-cyan-400" />
                <span className="font-semibold">
                  {operation === "analysis"
                    ? "DeepSeek is analyzing research evidence and extracting whitespace opportunities…"
                    : operation === "draft"
                    ? "DeepSeek is composing content draft with chosen hook and tone…"
                    : "DeepSeek is scoring draft across 6 multi-dimensional potential metrics…"}
                </span>
              </div>
              <span className="text-xs font-mono text-cyan-700 dark:text-cyan-300">
                {elapsed} elapsed
              </span>
            </div>
          )}

          {/* Cross-source Trend Signal Card */}
          {activeCollection.research_metadata?.trend_diagnostics && (
            <TrendDiagnosticsCard
              trend={activeCollection.research_metadata.trend_diagnostics}
            />
          )}

          {/* Research Quality Banner */}
          {activeCollection.research_metadata?.x_selection && (
            <details className="group rounded-xl border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] p-4 text-sm">
              <summary className="flex items-center justify-between cursor-pointer font-semibold text-gray-700 dark:text-gray-200">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-cyan-500" />
                  <span>Research Quality & Candidate Selection</span>
                </div>
                <span className="text-xs font-normal text-gray-400">
                  {activeCollection.research_metadata.x_selection.selected_count} selected of{" "}
                  {activeCollection.research_metadata.x_selection.candidate_count} candidates
                </span>
              </summary>
              <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeCollection.posts
                  .filter((p) => p.is_selected)
                  .slice(0, 4)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#1d1f23]/50 p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between font-medium text-gray-900 dark:text-white">
                        <span>@{p.author_username || "anonymous"}</span>
                        <span className="text-cyan-600 dark:text-cyan-400 font-bold">
                          {p.selection_score.toFixed(1)} quality
                        </span>
                      </div>
                      <p className="text-gray-500 dark:text-gray-400 line-clamp-2">
                        {p.selection_reason || p.text}
                      </p>
                    </div>
                  ))}
              </div>
            </details>
          )}

          {/* ── Empty State: Not yet analyzed ── */}
          {!activeCollection.analysis ? (
            <div className="rounded-2xl border border-dashed border-gray-300 dark:border-[#2f3336] bg-white dark:bg-[#16181c] p-12 text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
                <Compass className="h-6 w-6" />
              </div>
              <div className="max-w-md mx-auto space-y-1">
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  Ready to Turn Evidence into Actionable Ideas
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {activeCollection.posts.length} X conversations and{" "}
                  {activeCollection.research_items.length} web sources gathered. Run DeepSeek
                  analysis to discover dominant narratives and white-space angles.
                </p>
              </div>
              <button
                type="button"
                onClick={() => runAnalysis("fast")}
                disabled={Boolean(operation)}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white px-5 py-2.5 text-sm font-semibold shadow-sm transition-colors"
              >
                <Sparkles className="h-4 w-4" /> Run Fast Analysis
              </button>
            </div>
          ) : (
            /* ── Analysis Results: Insights, Ideas, Drafts, Scores ── */
            <div className="space-y-8">
              {/* Summary Card */}
              <div className="rounded-xl border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] p-6 space-y-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
                  <BarChart3 className="h-4 w-4" /> Research Summary & White-space Character
                </div>
                <p className="text-base text-gray-800 dark:text-gray-200 leading-relaxed font-medium">
                  {activeCollection.analysis.summary}
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  {strongestItems(activeCollection.analysis.insights).map((item) => (
                    <span
                      key={item.label}
                      className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-[#1d1f23] px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-300"
                    >
                      <Check className="h-3 w-3 text-cyan-500" /> {item.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Insights Grid */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                      Where the Opportunity Is
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Decision-ready signals categorized by saturation and novelty.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <InsightColumn
                    title="Dominant Topics"
                    items={activeCollection.analysis.insights?.dominant_topics}
                    total={activeCollection.posts.length}
                    icon={Flame}
                  />
                  <InsightColumn
                    title="Underused Angles"
                    items={activeCollection.analysis.insights?.underrepresented_angles}
                    total={activeCollection.posts.length}
                    icon={Sparkles}
                    opportunity
                  />
                  <InsightColumn
                    title="Saturated Angles"
                    items={activeCollection.analysis.insights?.saturated_angles}
                    total={activeCollection.posts.length}
                    icon={AlertTriangle}
                  />
                  <InsightColumn
                    title="Open Questions"
                    items={activeCollection.analysis.insights?.unresolved_questions}
                    total={activeCollection.posts.length}
                    icon={Compass}
                  />
                </div>

                <div className="bg-white dark:bg-[#16181c] rounded-xl border border-gray-200 dark:border-[#2f3336] px-4 py-2">
                  <FeedbackBar
                    stage="analysis"
                    entityType="analysis"
                    entityId={activeCollection.analysis.id}
                    searchId={activeCollection.id}
                    contentExcerpt={activeCollection.analysis.summary || activeCollection.keyword}
                    metadata={{
                      keyword: activeCollection.keyword,
                      insight_count: activeCollection.analysis.insights?.dominant_topics?.length || 0,
                    }}
                  />
                </div>
              </div>


              {/* Ideas Grid */}
              <div id="ideas-section" className="space-y-4 pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                      Ranked Idea Opportunities
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Ranked by high relevance and low saturation whitespace.
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-gray-400">
                    {activeCollection.analysis.ideas.length} ideas generated
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[...activeCollection.analysis.ideas].sort(rankIdeas).map((idea, index) => (
                    <IdeaCard
                      key={idea.id}
                      idea={idea}
                      rank={index + 1}
                      busy={operation === "draft" && selectedIdea?.id === idea.id}
                      onWrite={() => writeDraft(idea)}
                    />
                  ))}
                </div>
              </div>

              {/* Draft Workspace */}
              {selectedDraft && (
                <div
                  id="draft-workspace"
                  className="rounded-xl border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] p-6 space-y-6 shadow-sm scroll-mt-20"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-800 pb-4">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
                        Draft Studio
                      </span>
                      <h3 className="text-base font-bold text-gray-900 dark:text-white">
                        {selectedIdea?.title || "Active Draft"}
                      </h3>
                    </div>

                    <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-[#1d1f23] p-1 rounded-lg">
                      {(["concise", "standard", "deep"] as DraftDepth[]).map((depth) => (
                        <button
                          key={depth}
                          type="button"
                          onClick={() => {
                            setDraftDepth(depth);
                            if (selectedIdea) writeDraft(selectedIdea, depth);
                          }}
                          className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                            draftDepth === depth
                              ? "bg-white dark:bg-[#16181c] text-cyan-600 dark:text-cyan-400 shadow-sm"
                              : "text-gray-600 dark:text-gray-400 hover:text-gray-900"
                          }`}
                        >
                          {depth.charAt(0).toUpperCase() + depth.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Draft Text Preview Area */}
                  <div className="rounded-xl bg-gray-50 dark:bg-[#000000] border border-gray-200 dark:border-[#2f3336] p-5">
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 dark:text-gray-200 leading-relaxed font-normal">
                      {selectedDraft.text}
                    </pre>
                  </div>

                  {/* Draft Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => selectedIdea && writeDraft(selectedIdea, draftDepth)}
                        disabled={Boolean(operation)}
                        className="rounded-lg border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] hover:bg-gray-50 dark:hover:bg-[#1d1f23] text-gray-700 dark:text-gray-300 px-3 py-1.5 text-xs font-semibold transition-colors"
                      >
                        Regenerate
                      </button>
                      <button
                        type="button"
                        onClick={() => selectedIdea && writeDraft(selectedIdea, "concise")}
                        disabled={Boolean(operation)}
                        className="rounded-lg border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] hover:bg-gray-50 dark:hover:bg-[#1d1f23] text-gray-700 dark:text-gray-300 px-3 py-1.5 text-xs font-semibold transition-colors"
                      >
                        Make Shorter
                      </button>
                      <button
                        type="button"
                        onClick={() => selectedIdea && writeDraft(selectedIdea, "deep")}
                        disabled={Boolean(operation)}
                        className="rounded-lg border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] hover:bg-gray-50 dark:hover:bg-[#1d1f23] text-gray-700 dark:text-gray-300 px-3 py-1.5 text-xs font-semibold transition-colors"
                      >
                        Add Depth
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(selectedDraft.text);
                          toast.success("Draft copied to clipboard!");
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] hover:bg-gray-50 dark:hover:bg-[#1d1f23] text-gray-700 dark:text-gray-300 px-3.5 py-2 text-xs font-semibold transition-colors"
                      >
                        <Copy className="h-3.5 w-3.5" /> Copy Text
                      </button>

                      <button
                        type="button"
                        onClick={scoreDraft}
                        disabled={Boolean(operation)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 text-xs font-semibold transition-colors shadow-sm"
                      >
                        <Gauge className="h-3.5 w-3.5" />
                        {operation === "score"
                          ? "Scoring…"
                          : selectedDraft.score
                          ? "Rescore Draft"
                          : "Calculate Potential Score"}
                      </button>
                    </div>
                  </div>

                  {/* Draft Feedback Bar */}
                  <FeedbackBar
                    stage="draft"
                    entityType="draft"
                    entityId={selectedDraft.id}
                    ideaId={selectedIdea?.id}
                    draftId={selectedDraft.id}
                    contentExcerpt={selectedDraft.text}
                    promptVersion="generate_draft.v4"
                    metadata={{
                      draft_depth: selectedDraft.requested_length_mode || draftDepth,
                      angle_type: selectedIdea?.angle,
                      content_pillar: selectedIdea?.content_pillar,
                    }}
                  />

                  {/* Content Potential Score Panel */}
                  {selectedDraft.score && (
                    <ScorePanel
                      score={selectedDraft.score}
                      idea={selectedIdea || undefined}
                      draftId={selectedDraft.id}
                    />
                  )}


                </div>
              )}

              {/* Past Drafts Quick Picker */}
              {!selectedDraft && allDrafts.length > 0 && (
                <div className="rounded-xl border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] p-4 space-y-3">
                  <span className="text-xs font-bold uppercase text-gray-400">
                    Previous Drafts in this Collection
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {allDrafts.map(({ idea, draft }) => (
                      <button
                        key={draft.id}
                        type="button"
                        onClick={() => {
                          setSelectedIdea(idea);
                          setSelectedDraft(draft);
                          document.getElementById("draft-workspace")?.scrollIntoView({ behavior: "smooth" });
                        }}
                        className="text-left rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-[#1d1f23] p-3 hover:border-cyan-500/50 transition-colors"
                      >
                        <p className="text-xs font-bold text-gray-900 dark:text-white truncate">
                          {idea.title}
                        </p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                          {draft.score ? `Score: ${draft.score.overall_score.toFixed(1)} / 10` : "Ready to score"}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Analysis History & Evidence Tab */}
          <details className="rounded-xl border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] p-4 text-sm">
            <summary className="font-semibold text-gray-700 dark:text-gray-300 cursor-pointer flex items-center justify-between">
              <span>Evidence Archive & Past Runs</span>
              <span className="text-xs font-normal text-gray-400">
                {activeCollection.posts.length} posts · {activeCollection.research_items.length} web sources
              </span>
            </summary>

            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 space-y-4">
              {/* History Runs Switcher */}
              {activeCollection.analysis_versions?.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Analysis Version:</span>
                  {activeCollection.analysis_versions.map((v) => (
                    <button
                      key={v.version}
                      type="button"
                      onClick={() => loadCollection(activeCollection.id, v.version)}
                      className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-colors ${
                        activeCollection.analysis?.version === v.version
                          ? "bg-cyan-500 text-white"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      v{v.version} {v.active ? "(Active)" : ""}
                    </button>
                  ))}
                </div>
              )}

              {/* Evidence cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
                {activeCollection.research_items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#1d1f23]/50 p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between font-semibold text-gray-900 dark:text-white">
                      <span>{item.source_name}</span>
                      <span className="text-cyan-600 font-medium">
                        {Math.round(item.quality_score * 100)}% quality
                      </span>
                    </div>
                    <p className="font-medium text-gray-800 dark:text-gray-200">{item.title}</p>
                    <p className="text-gray-500 dark:text-gray-400 line-clamp-3">
                      {item.content}
                    </p>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-cyan-600 hover:underline"
                      >
                        Open Source <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                ))}

                {activeCollection.posts.map((post) => (
                  <div
                    key={post.id}
                    className="rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-[#1d1f23]/50 p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-gray-500">
                      <span className="font-semibold text-gray-900 dark:text-white">
                        @{post.author_username || "anonymous"}
                      </span>
                      <span>{post.posted_at?.slice(0, 16).replace("T", " ")}</span>
                    </div>
                    <p className="text-gray-700 dark:text-gray-300">{post.text}</p>
                    <div className="flex items-center gap-3 text-[10px] text-gray-400 pt-1">
                      <span>♥ {post.like_count}</span>
                      <span>↻ {post.retweet_count}</span>
                      <span>💬 {post.reply_count}</span>
                      {post.url && (
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-auto text-cyan-600 hover:underline inline-flex items-center gap-0.5"
                        >
                          View on X <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </div>
      ) : (
        /* ═══════════════════════════════════════════════════════════
           DISCOVERY HUB (OVERVIEW MODE)
           ═══════════════════════════════════════════════════════════ */
        <div className="space-y-8">
          {/* Preference Learning & Signal Dashboard */}
          <PreferenceInsightsCard />

          {/* Two-Entry Hero Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Entry 1: Morning Brief */}
            <div className="flex flex-col justify-between rounded-2xl border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] p-6 shadow-sm space-y-6">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-1.5 rounded-md bg-cyan-50 dark:bg-cyan-950/60 px-2.5 py-1 text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                  <Sparkles className="h-3.5 w-3.5" /> Autonomous Discovery
                </div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  Discover What to Talk About
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  Run bounded cross-source scans across developer tools, software engineering, AI
                  agents, and SaaS startups to rank underused angles.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={onRunMorningBrief}
                  disabled={briefBusy}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white py-3 text-sm font-semibold transition-colors shadow-sm"
                >
                  {briefBusy ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Radio className="h-4 w-4" />
                  )}
                  {briefBusy ? "Running Discovery Scan…" : "Run Curator Brief"}
                </button>

                {brief && (
                  <div className="flex items-center justify-between text-xs text-gray-400 px-1">
                    <span>
                      Status:{" "}
                      <strong className="text-gray-700 dark:text-gray-200">
                        {statusLabel(brief.status)}
                      </strong>
                    </span>
                    <span>{brief.opportunities?.length || 0} opportunities</span>
                  </div>
                )}
              </div>
            </div>

            {/* Entry 2: Search Something Specific */}
            <div className="flex flex-col justify-between rounded-2xl border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] p-6 shadow-sm space-y-6">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                  <SearchIcon className="h-3.5 w-3.5" /> Specific Investigation
                </div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  Research Something Specific
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  Enter a keyword, competitor, framework, or thesis to pull real-time discussions
                  and synthesize white-space insights.
                </p>
              </div>

              <form onSubmit={onStartSearch} className="space-y-3">
                <div className="relative">
                  <SearchIcon className="absolute left-3.5 top-3.5 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="e.g., local LLMs, AI agents, DuckDB, Next.js 16..."
                    className="w-full rounded-xl border border-gray-200 dark:border-[#2f3336] bg-gray-50 dark:bg-[#000000] pl-10 pr-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={searchBusy || !keyword.trim()}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-[#2f3336] bg-gray-900 hover:bg-black text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 disabled:opacity-50 py-3 text-sm font-semibold transition-colors"
                >
                  {searchBusy ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                  {searchBusy ? "Collecting Evidence…" : "Start Research"}
                </button>
              </form>
            </div>
          </div>

          {/* Morning Brief Live Results Section */}
          {brief && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Radio className="h-5 w-5 text-cyan-500" /> Latest Curator Brief Opportunities
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Cross-referenced opportunities synthesized from current industry discussions.
                  </p>
                </div>
                <span className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">
                  {statusLabel(brief.status)}
                </span>
              </div>

              {brief.status !== "completed" && brief.status !== "failed" && (
                <div className="rounded-xl border border-cyan-200 dark:border-cyan-800/60 bg-cyan-50/70 dark:bg-cyan-950/40 p-4 text-sm flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <RefreshCw className="h-4 w-4 animate-spin text-cyan-600" />
                    <span>{statusLabel(brief.status)}</span>
                  </div>
                  <span className="text-xs text-gray-500">Autonomous run in progress</span>
                </div>
              )}

              {brief.opportunities?.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {brief.opportunities.map((opp) => (
                    <OpportunityCard
                      key={opp.id}
                      opportunity={opp}
                      busy={researchingOppId === opp.id}
                      onResearch={() => onResearchOpportunity(opp)}
                    />
                  ))}
                </div>
              ) : brief.status === "completed" ? (
                <div className="rounded-xl border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] p-8 text-center text-xs text-gray-500">
                  No opportunities returned in the last brief run.
                </div>
              ) : null}
            </div>
          )}

          {/* Recent Research Collections Table */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <FileText className="h-5 w-5 text-gray-400" /> Recent Research Collections
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Access and continue past analysis and drafts.
                </p>
              </div>
            </div>

            {items.length === 0 ? (
              <div className="rounded-xl border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] p-8 text-center text-xs text-gray-500">
                No past research collections found. Run a Curator Brief or search a keyword above!
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] overflow-hidden shadow-sm">
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => router.push(`/admin/signal?collection=${item.id}`)}
                      className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-[#1d1f23] cursor-pointer transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-gray-900 dark:text-white">
                            {item.keyword}
                          </p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              item.status === "completed"
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                : "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400">
                          {item.post_count} posts collected · {item.created_at?.slice(0, 10)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 text-xs font-semibold text-cyan-600 dark:text-cyan-400">
                        <span>Open Collection</span>
                        <ChevronRight className="h-4 w-4" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function OpportunityCard({
  opportunity,
  busy,
  onResearch,
}: {
  opportunity: MorningBriefOpportunity;
  busy: boolean;
  onResearch: () => void;
}) {
  const satColors: Record<string, string> = {
    low: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    medium: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
    high: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  };

  return (
    <div className="flex flex-col justify-between rounded-xl border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] p-5 shadow-sm hover:border-cyan-500/40 transition-all space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-cyan-600 dark:text-cyan-400 flex items-center gap-2">
            #{opportunity.rank} Opportunity
            {opportunity.classification && (
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                opportunity.classification === "High Priority" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300" :
                opportunity.classification === "Hidden Gem" ? "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300" :
                "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
              }`}>
                {opportunity.classification}
              </span>
            )}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
              satColors[opportunity.saturation] || satColors.medium
            }`}
          >
            {opportunity.saturation} saturation
          </span>
        </div>

        <h3 className="text-base font-bold text-gray-900 dark:text-white leading-snug">
          {opportunity.title}
        </h3>

        <div className="space-y-2 text-xs text-gray-600 dark:text-gray-300">
          <div>
            <strong className="text-gray-900 dark:text-white font-semibold">What happened: </strong>
            <span>{opportunity.what_happened}</span>
          </div>
          <div>
            <strong className="text-cyan-600 dark:text-cyan-400 font-semibold">
              Underused angle:{" "}
            </strong>
            <span>{opportunity.underused_angle}</span>
          </div>
        </div>

        <details className="text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-800 mt-2">
          <summary className="cursor-pointer font-medium hover:underline">Curator Diagnostics & Hidden Mechanics</summary>
          <div className="mt-2 space-y-2 p-3 rounded-lg bg-gray-50 dark:bg-[#1d1f23]">
            <p><strong>Surprising Part:</strong> {opportunity.surprising_part}</p>
            <p><strong>Smart Reader Might Not Know:</strong> {opportunity.smart_reader_might_not_know}</p>
            <p><strong>Deeper Mechanism:</strong> {opportunity.deeper_mechanism}</p>
            <p><strong>Best Specific Fact:</strong> {opportunity.best_specific_fact}</p>
            <p><strong>Explainability:</strong> {opportunity.explainability}</p>
            <p><strong>Curator Value Reason:</strong> {opportunity.curator_value_reason}</p>
          </div>
        </details>
      </div>

      <div className="pt-3 border-t border-gray-100 dark:border-gray-800 space-y-3">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex gap-3">
            <span>Trend: <strong className="text-gray-900 dark:text-white font-bold">{opportunity.content_opportunity_score?.toFixed(1) || "0.0"}</strong></span>
            <span>Curator: <strong className="text-purple-600 dark:text-purple-400 font-bold">{opportunity.curator_value_score?.toFixed(1) || "0.0"}</strong></span>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-1 font-semibold text-gray-700 dark:text-gray-300">
            X signal: {opportunity.x_signal?.toFixed(1) || "0.0"}/10
          </span>
          {opportunity.web_signal !== null && opportunity.web_signal !== undefined ? (
            <span className="rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 px-2 py-1 font-semibold">
              Web signal: {opportunity.web_signal.toFixed(1)}/10
            </span>
          ) : (
            <span className="rounded-md bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 px-2 py-1 font-semibold">
              Web validation unavailable (X-only)
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onResearch}
          disabled={busy}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white py-2 text-xs font-semibold transition-colors shadow-sm"
        >
          {busy ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {busy ? "Seeding Research…" : "Research this Opportunity →"}
        </button>

        <FeedbackBar
          stage="curator"
          entityType="opportunity"
          entityId={opportunity.id}
          opportunityId={opportunity.id}
          contentExcerpt={opportunity.title}
          promptVersion="morning_brief_angles.v3"
          metadata={{
            classification: opportunity.classification,
            category: opportunity.classification,
            underused_angle: opportunity.underused_angle,
            content_opportunity_score: opportunity.content_opportunity_score,
            curator_value_score: opportunity.curator_value_score,
          }}
        />
      </div>
    </div>
  );
}


function TrendDiagnosticsCard({
  trend,
}: {
  trend: NonNullable<SearchDetail["research_metadata"]["trend_diagnostics"]>;
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-cyan-500" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">
            Cross-Source Trend Signal
          </h3>
        </div>
        <span className="text-xs font-bold text-cyan-600 dark:text-cyan-400">
          {trend.trend_confidence.toFixed(1)} / 10 Confidence
        </span>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Synthesized from independent X conversation volume and authoritative web coverage.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
        <div className="rounded-lg bg-gray-50 dark:bg-[#1d1f23] p-2.5 text-center">
          <p className="text-[10px] text-gray-400 font-medium">X Signal</p>
          <p className="text-sm font-bold text-gray-900 dark:text-white">
            {trend.x_discussion_strength ? `${trend.x_discussion_strength} / 10` : "Not checked"}
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 dark:bg-[#1d1f23] p-2.5 text-center">
          <p className="text-[10px] text-gray-400 font-medium">Web Coverage</p>
          <p className="text-sm font-bold text-gray-900 dark:text-white">
            {trend.web_coverage_strength} / 10
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 dark:bg-[#1d1f23] p-2.5 text-center">
          <p className="text-[10px] text-gray-400 font-medium">Source Diversity</p>
          <p className="text-sm font-bold text-gray-900 dark:text-white">
            {trend.source_diversity} domains
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 dark:bg-[#1d1f23] p-2.5 text-center">
          <p className="text-[10px] text-gray-400 font-medium">Quality Score</p>
          <p className="text-sm font-bold text-gray-900 dark:text-white">
            {Math.round(trend.information_quality * 100)}%
          </p>
        </div>
      </div>
    </div>
  );
}

function InsightColumn({
  title,
  items,
  total,
  icon: Icon,
  opportunity = false,
}: {
  title: string;
  items?: EvidenceItem[];
  total: number;
  icon: React.ElementType;
  opportunity?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] p-4 space-y-3">
      <div className="flex items-center gap-1.5 font-bold text-xs text-gray-800 dark:text-gray-200">
        <Icon className="h-4 w-4 text-cyan-500" />
        <span>{title}</span>
      </div>

      {items?.length ? (
        <div className="space-y-2.5">
          {items.slice(0, 3).map((item) => (
            <div
              key={item.label}
              className="rounded-lg bg-gray-50 dark:bg-[#1d1f23] p-2.5 text-xs space-y-1"
            >
              <div className="flex items-center justify-between font-semibold text-gray-900 dark:text-white">
                <span className="truncate max-w-[140px]">{item.label}</span>
                <span className="text-[10px] text-gray-400">{item.post_count}/{total}</span>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2">
                {item.opportunity || (opportunity ? "Untapped angle with low direct competition in this batch." : item.label)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 italic py-2">No signals recorded.</p>
      )}
    </div>
  );
}

function IdeaCard({
  idea,
  rank,
  busy,
  onWrite,
}: {
  idea: Idea;
  rank: number;
  busy: boolean;
  onWrite: () => void;
}) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-gray-200 dark:border-[#2f3336] bg-white dark:bg-[#16181c] p-5 shadow-sm space-y-4">
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              rank === 1
                ? "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300"
                : "bg-gray-100 dark:bg-[#1d1f23] text-gray-600 dark:text-gray-400"
            }`}
          >
            {rank === 1 ? "★ Recommended" : `#${rank}`}
          </span>
          <span className="text-[10px] font-semibold text-gray-400">
            {idea.content_pillar || "Tech Insight"}
          </span>
        </div>

        <h3 className="text-sm font-bold text-gray-900 dark:text-white leading-snug">
          {idea.title}
        </h3>

        <div className="rounded-lg bg-gray-50 dark:bg-[#000000] border border-gray-100 dark:border-gray-800 p-2.5 text-xs text-gray-700 dark:text-gray-300">
          <p className="font-semibold text-gray-900 dark:text-white text-[11px] mb-1">
            Hook Angle:
          </p>
          <p className="italic">{idea.hook}</p>
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
          <strong className="text-gray-700 dark:text-gray-300">Why this works: </strong>
          <span>{idea.why_this_angle || idea.angle}</span>
        </div>
      </div>

      <div className="pt-2 space-y-2">
        <button
          type="button"
          onClick={onWrite}
          disabled={busy}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white py-2 text-xs font-semibold transition-colors shadow-sm"
        >
          {busy ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileText className="h-3.5 w-3.5" />
          )}
          {busy ? "Drafting with DeepSeek…" : "Write Draft"}
        </button>

        <FeedbackBar
          stage="idea"
          entityType="idea"
          entityId={idea.id}
          ideaId={idea.id}
          contentExcerpt={idea.title}
          promptVersion="generate_ideas.v6"
          metadata={{
            angle_type: idea.angle || idea.content_angle,
            content_pillar: idea.content_pillar,
            hook: idea.hook,
          }}
        />
      </div>
    </div>
  );
}


function ScorePanel({
  score,
  idea,
  draftId,
}: {
  score: NonNullable<Draft["score"]>;
  idea?: Idea;
  draftId?: string;
}) {

  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#2f3336] bg-gray-50/70 dark:bg-[#000000]/60 p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-200/60 dark:border-gray-800 pb-3">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
            Content Potential Evaluation
          </span>
          <h4 className="text-sm font-bold text-gray-900 dark:text-white">
            Content Potential Score: {score.overall_score.toFixed(1)} / 10
          </h4>
        </div>
        <span className="text-xs text-gray-400">Heuristic Content Potential Metric</span>
      </div>

      {/* 6 Metric Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-center">
        {SCORE_ROWS.map((row) => (
          <div
            key={row.key}
            className="rounded-lg bg-white dark:bg-[#16181c] border border-gray-200/80 dark:border-gray-800 p-2.5"
          >
            <p className="text-[10px] font-medium text-gray-400">{row.label}</p>
            <p
              className={`text-base font-bold tabular-nums ${
                row.risk ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-white"
              }`}
            >
              {Number(score[row.key])}/10
            </p>
          </div>
        ))}
      </div>

      {/* Notes & Evidence Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div className="rounded-lg bg-white dark:bg-[#16181c] border border-gray-200/80 dark:border-gray-800 p-3 space-y-1">
          <p className="font-bold text-gray-900 dark:text-white">Strengths & Signal</p>
          <ul className="text-gray-600 dark:text-gray-400 space-y-1 list-disc list-inside">
            <li>{score.topic_relevance}/10 Topic Relevance</li>
            <li>{score.evidence_strength}/10 Research Evidence Backing</li>
          </ul>
        </div>

        <div className="rounded-lg bg-white dark:bg-[#16181c] border border-gray-200/80 dark:border-gray-800 p-3 space-y-1">
          <p className="font-bold text-gray-900 dark:text-white">Saturation & Whitespace</p>
          <p className="text-gray-600 dark:text-gray-400">
            {idea?.content_angle || "This angle"} has{" "}
            <strong className="text-gray-900 dark:text-white">
              {idea?.angle_saturation || score.angle_saturation || "low"} saturation
            </strong>
          </p>
        </div>
      </div>

      {score.notes && (
        <details className="text-xs text-gray-500 dark:text-gray-400 pt-1">
          <summary className="cursor-pointer font-medium hover:underline">
            View Scoring Rationale Notes
          </summary>
          <p className="mt-2 p-3 rounded-lg bg-white dark:bg-[#16181c] border border-gray-200 dark:border-gray-800 leading-relaxed">
            {score.notes}
          </p>
        </details>
      )}

      <FeedbackBar
        stage="scoring"
        entityType="score"
        entityId={score.id}
        draftId={draftId || score.draft_id}
        contentExcerpt={score.notes}
        promptVersion="score_draft.v3"
        metadata={{
          overall_score: score.overall_score,
          originality: score.originality,
          spam_risk: score.spam_risk,
        }}
      />
    </div>
  );
}



function strongestItems(insights?: Record<string, EvidenceItem[]>) {
  if (!insights) return [];
  return [
    ...(insights.dominant_topics || []),
    ...(insights.underrepresented_angles || []),
    ...(insights.unresolved_questions || []),
  ].slice(0, 5);
}

function rankIdeas(a: Idea, b: Idea) {
  const value = (idea: Idea) =>
    (idea.research_relevance === "high" ? 4 : idea.research_relevance === "medium" ? 2 : 1) +
    (idea.angle_saturation === "low" ? 3 : idea.angle_saturation === "medium" ? 2 : 1);
  return value(b) - value(a) || a.position - b.position;
}
