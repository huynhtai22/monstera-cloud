"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, Database, Send, Unplug, X, Info } from "lucide-react";

type Variant = "sources" | "destinations";

/**
 * Short, consistent copy so users understand:
 * - Sources use each platform's marketing login (Meta BM, Google Ads / MCC, TikTok Ads).
 * - Destinations (Sheets, Looker) often use a *different* Google account — that is OK.
 * Dismissible — persisted in localStorage so it only shows until the user closes it.
 */
export function DataFlowExplainer({ variant }: { variant: Variant }) {
    const isSources = variant === "sources";
    const storageKey = `mc_dataflow_dismissed_${variant}`;
    const [dismissed, setDismissed] = useState(true);

    useEffect(() => {
        try {
            setDismissed(!!localStorage.getItem(storageKey));
        } catch { /* ignore */ }
    }, [storageKey]);

    const dismiss = () => {
        try { localStorage.setItem(storageKey, "1"); } catch { /* ignore */ }
        setDismissed(true);
    };

    if (dismissed) {
        return (
            <button
                type="button"
                onClick={() => setDismissed(false)}
                className="mb-6 inline-flex items-center gap-1.5 rounded-lg border border-cyan-200/60 bg-cyan-50/60 px-3 py-1.5 text-xs font-medium text-cyan-700 transition-all hover:bg-cyan-100/80 dark:border-cyan-900/40 dark:bg-cyan-950/30 dark:text-cyan-400 dark:hover:bg-cyan-950/50"
                aria-label="Show how data moves"
            >
                <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
                How data moves
            </button>
        );
    }

    return (
        <div className="mb-6 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Info className="h-3.5 w-3.5 text-cyan-500" aria-hidden />
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                        How data moves
                    </p>
                </div>
                <button
                    type="button"
                    onClick={dismiss}
                    className="rounded-md p-1 text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-500 dark:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-400"
                    aria-label="Dismiss"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            {/* Steps row */}
            <div className="flex items-center gap-2">
                {/* Step 1 */}
                <div className="flex min-w-0 flex-1 items-start gap-3 rounded-xl border border-cyan-100 bg-cyan-50/60 p-3 dark:border-cyan-900/40 dark:bg-cyan-950/20">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-500 text-[10px] font-bold text-white">
                        1
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <Database className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden />
                            <p className="text-xs font-semibold text-gray-900 dark:text-white">Sources</p>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                            Sign in with <strong className="text-gray-700 dark:text-gray-200">Facebook</strong>,{" "}
                            <strong className="text-gray-700 dark:text-gray-200">Google Ads</strong>, or{" "}
                            <strong className="text-gray-700 dark:text-gray-200">TikTok</strong>. Monstera reads metrics for accounts granted in OAuth.
                        </p>
                    </div>
                </div>

                {/* Connector */}
                <div className="flex shrink-0 flex-col items-center gap-1" aria-hidden>
                    <div className="h-px w-8 border-t-2 border-dashed border-cyan-300 dark:border-cyan-700" />
                    <ArrowRight className="h-3.5 w-3.5 text-cyan-400 dark:text-cyan-600" />
                </div>

                {/* Step 2 */}
                <div className="flex min-w-0 flex-1 items-start gap-3 rounded-xl border border-gray-200/80 bg-gray-50/60 p-3 dark:border-slate-700/60 dark:bg-slate-800/40">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-400 text-[10px] font-bold text-white dark:bg-slate-600">
                        2
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <Send className="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-slate-400" aria-hidden />
                            <p className="text-xs font-semibold text-gray-900 dark:text-white">Destinations</p>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                            <strong className="text-gray-700 dark:text-gray-200">Google Sheets</strong> and{" "}
                            <strong className="text-gray-700 dark:text-gray-200">Looker Studio</strong> can use a{" "}
                            <strong className="text-gray-700 dark:text-gray-200">different</strong> Google login — the pipeline links them inside this workspace.
                        </p>
                    </div>
                </div>
            </div>

            {/* Footer hint */}
            <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                {!isSources ? (
                    <>
                        <Unplug className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        Connect sources first on the{" "}
                        <Link href="/sources" className="font-semibold text-cyan-600 hover:underline dark:text-cyan-400">
                            Sources
                        </Link>{" "}
                        page, then add Sheets or Looker here to create a pipeline.
                    </>
                ) : (
                    <>
                        <Send className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        After connecting sources, open{" "}
                        <Link href="/destinations" className="font-semibold text-cyan-600 hover:underline dark:text-cyan-400">
                            Destinations
                        </Link>{" "}
                        to choose where your data lands.
                    </>
                )}
            </p>
        </div>
    );
}
