"use client";

import { useState } from "react";
import useSWR from "swr";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { describeNextAction } from "@/lib/ingestion/error-taxonomy";
import { formatRunDiagnostics, type RunRecord } from "@/lib/ingestion/runs";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function statusLabel(status: RunRecord["status"]) {
  if (status === "success" || status === "completed") return "success";
  if (status === "partial") return "partial";
  if (status === "queued" || status === "running") return status;
  return "failed";
}

export function RunsView({
  workspaceId,
  connectionId,
  title = "Recent runs",
}: {
  workspaceId: string | null | undefined;
  connectionId?: string;
  title?: string;
}) {
  const params = new URLSearchParams();
  if (workspaceId) params.set("workspaceId", workspaceId);
  if (connectionId) params.set("connectionId", connectionId);
  const { data, error } = useSWR(
    workspaceId ? `/api/runs?${params.toString()}` : null,
    fetcher,
    { refreshInterval: 15_000 },
  );
  const runs = (data?.runs ?? []) as RunRecord[];

  if (!workspaceId) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">
          {title}
        </h2>
        <span className="text-xs text-gray-400">Last {runs.length} events</span>
      </div>
      {error ? (
        <p className="text-sm text-red-600">Could not load runs.</p>
      ) : runs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500 dark:border-[#2f3336] dark:text-slate-400">
          No warehouse or pipeline runs yet. Refresh a source to see history here.
        </p>
      ) : (
        <ul className="space-y-2">
          {runs.map((run) => (
            <RunRow key={`${run.kind}-${run.id}`} run={run} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RunRow({ run }: { run: RunRecord }) {
  const [copied, setCopied] = useState(false);
  const tone = statusLabel(run.status);
  const action = describeNextAction(run.action);

  const copy = async () => {
    await navigator.clipboard.writeText(formatRunDiagnostics(run));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <li
      className={cn(
        "rounded-xl border p-3 text-sm",
        tone === "success" && "border-line bg-panel",
        tone === "partial" && "border-amber-900/40 bg-amber-950/20 text-amber-200",
        tone === "queued" && "border-line bg-canvas text-ink-mute",
        tone === "running" && "border-line bg-canvas text-white",
        tone === "failed" && "border-red-900/40 bg-red-950/20 text-red-200",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-900 dark:text-white">{run.title}</span>
            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-600 dark:bg-black/30 dark:text-slate-300">
              {tone}
            </span>
            {run.tag && (
              <span className="font-mono text-[11px] text-gray-500 dark:text-slate-400">{run.tag}</span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            {run.rows.toLocaleString()} rows · {run.durationMs >= 1000 ? `${(run.durationMs / 1000).toFixed(1)}s` : `${run.durationMs}ms`}
            {run.retryCount > 0 ? ` · retry ${run.retryCount}/${run.maxRetries || "?"}` : ""}
            {` · ${new Date(run.createdAt).toLocaleString()}`}
          </p>
          {run.errorMsg && (
            <p className="mt-1 line-clamp-2 font-mono text-xs text-red-700 dark:text-red-300">
              {run.errorMsg}
            </p>
          )}
          {action && tone !== "success" && (
            <p className="mt-1 text-xs font-medium text-gray-700 dark:text-slate-200">{action}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-white dark:border-slate-700 dark:text-slate-300"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy IDs"}
        </button>
      </div>
    </li>
  );
}
