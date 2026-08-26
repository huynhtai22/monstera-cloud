"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace";

type TurnResponse = {
  turnId?: string;
  status?: "answered" | "refused" | "queued";
  answer?: string;
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

function analystEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_GOVERNED_ANALYST === "1";
}

export function AnalystPane() {
  const enabled = analystEnabled();
  const { activeWorkspaceId } = useWorkspaceStore();
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId")?.trim() || undefined;

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TurnResponse | null>(null);

  const sheetsHref = useMemo(() => {
    const params = new URLSearchParams();
    if (activeWorkspaceId) params.set("workspaceId", activeWorkspaceId);
    return `/exports?${params.toString()}`;
  }, [activeWorkspaceId]);

  if (!enabled) return null;

  const evidence = result?.evidence;
  const exportable = result?.status === "answered" && !result.blockers?.length;

  const ask = async () => {
    if (!activeWorkspaceId || !question.trim() || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/ai/analyst/turns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          clientId,
          question: question.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as TurnResponse;
      if (res.status === 402) {
        setResult({ status: "refused", answer: data.error || "AI budget exceeded.", blockers: ["budget"] });
        return;
      }
      if (res.status === 404) {
        setResult({ status: "refused", answer: "Governed analyst is not enabled.", blockers: ["flag"] });
        return;
      }
      if (!res.ok) {
        setResult({ status: "refused", answer: data.error || "Request failed.", blockers: ["error"] });
        return;
      }
      setResult(data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-lg border border-line bg-panel p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 mt-0.5 text-ink" />
        <div>
          <h2 className="text-sm font-semibold text-ink">Talk to your warehouse</h2>
          <p className="text-xs text-ink-mute">
            Answers only from this workspace. {QUEUED_COPY}
            {clientId ? ` Client filter: ${clientId}.` : ""}
          </p>
        </div>
      </div>

      {evidence ? (
        <div className="grid gap-1 rounded-md border border-line bg-canvas px-3 py-2 text-[11px] text-ink-mute">
          <div>Freshness: {evidence.freshness ?? "unknown"}</div>
          <div>
            Currency: {(evidence.currencies ?? []).join(", ") || "unknown"}
            {(evidence.currencies?.length ?? 0) > 1 ? " (per-currency totals only; not blended)" : ""}
          </div>
          <div>
            Attribution: {evidence.attribution?.model === "time_decay"
              ? `UTM time-decay (match rate ${evidence.attribution.matchRate ?? "unknown"})`
              : "platform-reported conversions (CampaignMetric.conversions / revenue)"}
          </div>
          <div>
            Completeness: {evidence.completeness?.sourceCount ?? 0} sources
            {evidence.completeness?.partialCount ? ` · ${evidence.completeness.partialCount} partial` : ""}
            {evidence.lastDataThrough ? ` · data through ${evidence.lastDataThrough.slice(0, 10)}` : ""}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void ask();
          }}
          placeholder="Why did Meta ROAS drop last week?"
          className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink"
        />
        <button
          type="button"
          onClick={() => void ask()}
          disabled={loading || !activeWorkspaceId || !question.trim()}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-md bg-white px-3 py-2 text-xs font-semibold text-neutral-900 shadow-xs disabled:opacity-50",
          )}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ask"}
        </button>
      </div>

      {result?.status === "queued" ? (
        <p className="text-xs text-ink-mute">{result.queuedCopy || QUEUED_COPY}</p>
      ) : null}

      {result?.status === "refused" ? (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <div>
            <div>{result.answer}</div>
            {result.blockers?.length ? (
              <div className="mt-1 text-[11px] opacity-80">Blockers: {result.blockers.join(", ")}</div>
            ) : null}
            <div className="mt-1 text-[11px] opacity-80">Best-effort answers are not exportable as client briefs.</div>
          </div>
        </div>
      ) : null}

      {result?.status === "answered" && result.answer ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-canvas px-3 py-2 text-[11px] text-ink">
          {result.answer}
        </pre>
      ) : null}

      {exportable ? (
        <a href={sheetsHref} className="inline-flex text-xs font-semibold text-ink underline">
          Open in Sheets
        </a>
      ) : result?.status === "answered" ? (
        <p className="text-[11px] text-ink-mute">Not exportable — dataset is not report-ready.</p>
      ) : null}
    </section>
  );
}
