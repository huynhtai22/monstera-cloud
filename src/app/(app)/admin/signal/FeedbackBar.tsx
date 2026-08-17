"use client";

import React, { useState } from "react";
import { Check, MessageSquare, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { toast } from "sonner";
import { signalApi } from "@/lib/signal-api";
import type {
  CreateFeedbackPayload,
  FeedbackEntityType,
  FeedbackReasonCode,
  FeedbackSentiment,
  FeedbackStage,
} from "@/types/signal-desk";

const REASON_LABELS: Record<FeedbackReasonCode, string> = {
  TOO_GENERIC: "Too generic",
  WEAK_SOURCE: "Weak source",
  BAD_TOPIC: "Bad topic",
  FORCED_ANALOGY: "Forced analogy",
  REPETITIVE: "Repetitive",
  WEAK_HOOK: "Weak hook",
  FACTUAL_CONCERN: "Factual concern",
  UNSUPPORTED_CLAIM: "Unsupported claim",
  TOO_LONG: "Too long",
  TOO_SHORT: "Too short",
  BAD_STRUCTURE: "Bad structure",
  BAD_SCORE: "Bad score",
  UI_CONFUSING: "UI confusing",
  TOO_SLOW: "Too slow",
  OTHER: "Other",
};

const STAGE_REASONS: Record<FeedbackStage, FeedbackReasonCode[]> = {
  curator: ["BAD_TOPIC", "WEAK_SOURCE", "TOO_GENERIC", "OTHER"],
  analysis: ["TOO_GENERIC", "WEAK_SOURCE", "FACTUAL_CONCERN", "UNSUPPORTED_CLAIM", "OTHER"],
  idea: ["FORCED_ANALOGY", "REPETITIVE", "WEAK_HOOK", "TOO_GENERIC", "OTHER"],
  draft: ["WEAK_HOOK", "BAD_STRUCTURE", "TOO_LONG", "TOO_SHORT", "FACTUAL_CONCERN", "FORCED_ANALOGY", "OTHER"],
  scoring: ["BAD_SCORE", "TOO_GENERIC", "OTHER"],
};

export interface FeedbackBarProps {
  stage: FeedbackStage;
  entityType: FeedbackEntityType;
  entityId: string;
  briefId?: string | null;
  opportunityId?: string | null;
  searchId?: string | null;
  analysisId?: string | null;
  ideaId?: string | null;
  draftId?: string | null;
  scoreId?: string | null;
  modelProvider?: string | null;
  modelName?: string | null;
  promptVersion?: string | null;
  contentExcerpt?: string | null;
  metadata?: Record<string, unknown>;
  onSubmitted?: () => void;
}

export function FeedbackBar({
  stage,
  entityType,
  entityId,
  briefId,
  opportunityId,
  searchId,
  analysisId,
  ideaId,
  draftId,
  scoreId,
  modelProvider,
  modelName,
  promptVersion,
  contentExcerpt,
  metadata = {},
  onSubmitted,
}: FeedbackBarProps) {
  const [submittedSentiment, setSubmittedSentiment] = useState<FeedbackSentiment | null>(null);
  const [showNegativeMenu, setShowNegativeMenu] = useState(false);
  const [selectedReasons, setSelectedReasons] = useState<FeedbackReasonCode[]>([]);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const availableReasons = STAGE_REASONS[stage] || [
    "TOO_GENERIC",
    "WEAK_SOURCE",
    "FORCED_ANALOGY",
    "OTHER",
  ];

  const handlePositiveClick = async () => {
    if (submitting || submittedSentiment === "positive") return;
    setSubmitting(true);
    try {
      const payload: CreateFeedbackPayload = {
        stage,
        entity_type: entityType,
        entity_id: entityId,
        sentiment: "positive",
        reason_codes: [],
        note: note.trim() || undefined,
        brief_id: briefId,
        opportunity_id: opportunityId,
        search_id: searchId,
        analysis_id: analysisId,
        idea_id: ideaId,
        draft_id: draftId,
        score_id: scoreId,
        model_provider: modelProvider,
        model_name: modelName,
        prompt_version: promptVersion,
        content_excerpt: contentExcerpt,
        metadata,
      };
      await signalApi.submitFeedback(payload);
      setSubmittedSentiment("positive");
      setShowNegativeMenu(false);
      toast.success("Feedback recorded — thank you!");
      onSubmitted?.();
    } catch (err: any) {
      toast.error(`Failed to submit feedback: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNegativeInitialClick = () => {
    if (submittedSentiment === "negative") {
      setShowNegativeMenu(!showNegativeMenu);
      return;
    }
    setShowNegativeMenu(true);
  };

  const toggleReason = (code: FeedbackReasonCode) => {
    if (selectedReasons.includes(code)) {
      setSelectedReasons(selectedReasons.filter((c) => c !== code));
    } else {
      setSelectedReasons([...selectedReasons, code]);
    }
  };

  const handleNegativeSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload: CreateFeedbackPayload = {
        stage,
        entity_type: entityType,
        entity_id: entityId,
        sentiment: "negative",
        reason_codes: selectedReasons,
        note: note.trim() || undefined,
        brief_id: briefId,
        opportunity_id: opportunityId,
        search_id: searchId,
        analysis_id: analysisId,
        idea_id: ideaId,
        draft_id: draftId,
        score_id: scoreId,
        model_provider: modelProvider,
        model_name: modelName,
        prompt_version: promptVersion,
        content_excerpt: contentExcerpt,
        metadata,
      };
      await signalApi.submitFeedback(payload);
      setSubmittedSentiment("negative");
      setShowNegativeMenu(false);
      toast.success("Feedback recorded — thanks for the signal!");
      onSubmitted?.();
    } catch (err: any) {
      toast.error(`Failed to submit feedback: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-col gap-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
          <span className="text-[11px] font-medium tracking-tight">Signal feedback:</span>
          {submittedSentiment ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
              <Check className="w-3 h-3" />
              Recorded
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePositiveClick}
            disabled={submitting}
            aria-label="Mark as good output"
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-all ${
              submittedSentiment === "positive"
                ? "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent"
            }`}
          >
            <ThumbsUp className="w-3 h-3" />
            <span>Good</span>
          </button>

          <button
            type="button"
            onClick={handleNegativeInitialClick}
            disabled={submitting}
            aria-label="Mark as needs work"
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-all ${
              submittedSentiment === "negative"
                ? "bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800"
                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent"
            }`}
          >
            <ThumbsDown className="w-3 h-3" />
            <span>Needs work</span>
          </button>

          <button
            type="button"
            onClick={() => setShowNoteInput(!showNoteInput)}
            aria-label="Add optional comment note"
            className={`p-1 rounded transition-colors ${
              note
                ? "text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40"
                : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            }`}
          >
            <MessageSquare className="w-3 h-3" />
          </button>
        </div>
      </div>

      {showNegativeMenu && (
        <div className="bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-md p-2.5 flex flex-col gap-2">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-700 dark:text-slate-300">
            <span>What needs improvement? (Select all that apply)</span>
            <button
              type="button"
              onClick={() => setShowNegativeMenu(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {availableReasons.map((code) => {
              const isSelected = selectedReasons.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => toggleReason(code)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                    isSelected
                      ? "bg-rose-500 text-white border-rose-600"
                      : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-750"
                  }`}
                >
                  {REASON_LABELS[code] || code}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-end gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => setShowNegativeMenu(false)}
              className="px-2 py-1 text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleNegativeSubmit}
              disabled={submitting}
              className="px-3 py-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded text-[11px] font-medium hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Submit Feedback"}
            </button>
          </div>
        </div>
      )}

      {showNoteInput && (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            placeholder="Add specific editorial note (e.g. why this angle fell short)…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
          <button
            type="button"
            onClick={() => setShowNoteInput(false)}
            className="px-2 py-1 text-[11px] text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
