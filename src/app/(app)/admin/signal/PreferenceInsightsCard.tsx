"use client";

import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Flame,
  Info,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { signalApi } from "@/lib/signal-api";
import type { PreferenceSummary } from "@/types/signal-desk";

export function PreferenceInsightsCard() {
  const [summary, setSummary] = useState<PreferenceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await signalApi.getFeedbackSummary();
      setSummary(data);
    } catch (err: any) {
      setError(err.message || "Failed to load preference insights");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  if (!summary && loading) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between text-xs text-slate-500">
        <span className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />
          Loading Preference Insights…
        </span>
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  const confidenceBadge = () => {
    if (summary.sample_confidence === "meaningful_signal") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
          <CheckCircle2 className="w-3 h-3" />
          Robust Signal (n={summary.total_count})
        </span>
      );
    }
    if (summary.sample_confidence === "weak_signal") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300">
          <Sparkles className="w-3 h-3" />
          Preliminary Signal (n={summary.total_count})
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
        <Info className="w-3 h-3" />
        Not enough data yet (n={summary.total_count})
      </span>
    );
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Preference Insights
              </h3>
              {confidenceBadge()}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Learned from explicit daily usage feedback (Observational only)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchSummary}
            disabled={loading}
            title="Refresh preferences"
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {expanded ? "Collapse" : "Expand"}
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Primary KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2.5">
          <div className="text-slate-500 dark:text-slate-400 text-[11px]">Total Feedback</div>
          <div className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            {summary.total_count}
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2.5">
          <div className="text-slate-500 dark:text-slate-400 text-[11px]">Positive Rate</div>
          <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
            {summary.total_count > 0 ? `${(summary.positive_rate * 100).toFixed(1)}%` : "—"}
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2.5">
          <div className="text-slate-500 dark:text-slate-400 text-[11px]">Positive / Negative</div>
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mt-1">
            {summary.positive_count} 👍 / {summary.negative_count} 👎
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2.5">
          <div className="text-slate-500 dark:text-slate-400 text-[11px]">Top Friction Signal</div>
          <div className="text-xs font-semibold text-rose-600 dark:text-rose-400 truncate mt-1">
            {Object.keys(summary.negative_reason_frequency)[0] || "None"}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4 text-xs">
          {summary.total_count < 5 ? (
            <div className="bg-slate-50 dark:bg-slate-800/40 rounded-lg p-3 text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <Info className="w-4 h-4 text-slate-400" />
              <span>
                Not enough feedback recorded yet (requires $\ge 5$ observations for preliminary signals, $\ge 15$ for robust patterns). Use 👍 and 👎 across cards to build your profile.
              </span>
            </div>
          ) : (
            <>
              {/* Recurring Signals Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Positive Patterns */}
                <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300 font-semibold text-xs mb-2">
                    <TrendingUp className="w-3.5 h-3.5" />
                    Top Liked Angle Types & Patterns
                  </div>
                  {summary.recurring_positive_patterns.length > 0 ? (
                    <div className="space-y-1.5">
                      {summary.recurring_positive_patterns.map((p, idx) => (
                        <div key={idx} className="flex items-center justify-between text-[11px]">
                          <span className="font-medium text-slate-700 dark:text-slate-200 capitalize">
                            {p.value} ({p.type})
                          </span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">
                            {(p.positive_rate * 100).toFixed(0)}% (n={p.sample_size})
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      No strong angle preference pattern yet.
                    </p>
                  )}
                </div>

                {/* Negative Signals */}
                <div className="bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-rose-800 dark:text-rose-300 font-semibold text-xs mb-2">
                    <TrendingDown className="w-3.5 h-3.5" />
                    Most Common Negative Signals
                  </div>
                  {summary.recurring_negative_patterns.length > 0 ? (
                    <div className="space-y-1.5">
                      {summary.recurring_negative_patterns.map((n, idx) => (
                        <div key={idx} className="flex items-center justify-between text-[11px]">
                          <span className="font-medium text-slate-700 dark:text-slate-200">
                            {n.reason_code}
                          </span>
                          <span className="font-bold text-rose-600 dark:text-rose-400">
                            {n.occurrences}x ({n.affected_stages.join(", ")})
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      No recurring negative issues recorded.
                    </p>
                  )}
                </div>
              </div>

              {/* Suggested Review Areas */}
              {summary.suggested_review_areas.length > 0 && (
                <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-amber-900 dark:text-amber-300 font-semibold text-xs mb-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Suggested Areas for Review (Human-Informed)
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
                    {summary.suggested_review_areas.map((area, idx) => (
                      <li key={idx}>{area}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
