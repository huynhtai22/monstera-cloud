"use client";

import React from "react";
import { Sparkles, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
    workspaceId: string | null;
};

export function AiPerformanceSummary({ workspaceId }: Props) {
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [summary, setSummary] = React.useState<string | null>(null);
    const [bullets, setBullets] = React.useState<string[]>([]);
    const [configured, setConfigured] = React.useState<boolean | null>(null);

    React.useEffect(() => {
        setSummary(null);
        setBullets([]);
        setError(null);
        setConfigured(null);
    }, [workspaceId]);

    const run = async () => {
        if (!workspaceId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/ai/performance-summary", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workspaceId }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 503) {
                setConfigured(false);
                setError(typeof data.hint === "string" ? data.hint : data.error || "AI not configured");
                setSummary(null);
                setBullets([]);
                return;
            }
            if (!res.ok) {
                throw new Error(typeof data.error === "string" ? data.error : "Request failed");
            }
            setConfigured(true);
            setSummary(typeof data.summary === "string" ? data.summary : null);
            setBullets(Array.isArray(data.bullets) ? data.bullets : []);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to generate summary");
            setSummary(null);
            setBullets([]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="rounded-3xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/95 via-white to-white p-6 shadow-sm ring-1 ring-indigo-500/10 dark:border-indigo-800/50 dark:from-indigo-950/40 dark:via-slate-900 dark:to-slate-950 dark:ring-indigo-400/10 sm:p-7">
            <div className="mb-5 flex flex-col gap-4 border-b border-indigo-100/80 pb-5 dark:border-indigo-900/40 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-4">
                    <div className="rounded-2xl bg-gradient-to-br from-indigo-100 to-indigo-50 p-2.5 shadow-inner dark:from-indigo-500/25 dark:to-indigo-950/80">
                        <Sparkles className="h-6 w-6 text-indigo-600 dark:text-indigo-200" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">AI digest (last 7 days)</h2>
                        <p className="mt-1 max-w-xl text-sm text-gray-500 dark:text-gray-400">
                            Short summary from your sync, pipeline, and attribution metrics. Uses a small, cost-efficient
                            model — no raw credentials are sent.
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => void run()}
                    disabled={loading || !workspaceId}
                    className={cn(
                        "inline-flex shrink-0 items-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 py-2 text-xs font-semibold text-indigo-900 shadow-sm transition hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:bg-[#000000] dark:text-indigo-100 dark:hover:bg-indigo-950/60"
                    )}
                >
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {summary || bullets.length ? "Regenerate" : "Generate summary"}
                </button>
            </div>

            {configured === false && error ? (
                <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                </div>
            ) : null}

            {error && configured !== false ? (
                <div className="mb-3 flex gap-2 text-xs text-red-600 dark:text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                </div>
            ) : null}

            {summary || bullets.length > 0 ? (
                <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
                    {summary ? <p className="leading-relaxed">{summary}</p> : null}
                    {bullets.length > 0 ? (
                        <ul className="list-inside list-disc space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
                            {bullets.map((b, i) => (
                                <li key={i}>{b}</li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            ) : !loading && configured !== false && !error ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                    Click Generate to produce a summary from the last week of data.
                </p>
            ) : null}
        </div>
    );
}
