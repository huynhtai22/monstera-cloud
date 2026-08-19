"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, Database, Send, Unplug, X, Info } from "lucide-react";

type Variant = "sources" | "exports";

/**
 * Short, consistent copy so users understand:
 * - Sources use each platform's marketing login (Meta BM, Google Ads / MCC, TikTok Ads).
 * - Exports (Sheets, Looker) use the Monstera Cloud Add-on or Looker Studio connector to pull data.
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
                className="mb-6 inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-xs font-medium text-ink-mute hover:text-ink"
                aria-label="Show how data moves"
            >
                <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
                How data moves
            </button>
        );
    }

    return (
        <div className="mb-6 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-[#2f3336]/60 dark:bg-[#000000]/60">
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Info className="h-3.5 w-3.5 text-ink-mute" aria-hidden />
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                        How data moves
                    </p>
                </div>
                <button
                    type="button"
                    onClick={dismiss}
                    className="rounded-md p-1 text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-500 dark:text-slate-600 dark:hover:bg-[#16181c] dark:hover:text-slate-400"
                    aria-label="Dismiss"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            {/* Steps row */}
            <div className="flex items-center gap-2">
                {/* Step 1 */}
                <div className="flex min-w-0 flex-1 items-start gap-3 rounded-md border border-line bg-canvas p-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-panel font-mono text-[10px] font-medium text-ink">
                        1
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <Database className="h-3.5 w-3.5 shrink-0 text-ink-mute" strokeWidth={1.5} aria-hidden />
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
                    <div className="h-px w-8 border-t border-dashed border-line" />
                    <ArrowRight className="h-3.5 w-3.5 text-ink-mute" strokeWidth={1.5} />
                </div>

                {/* Step 2 */}
                <div className="flex min-w-0 flex-1 items-start gap-3 rounded-xl border border-gray-200/80 bg-gray-50/60 p-3 dark:border-[#2f3336]/60 dark:bg-[#16181c]/40">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-400 text-[10px] font-bold text-white dark:bg-[#2f3336]">
                        2
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <Send className="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-slate-400" aria-hidden />
                            <p className="text-xs font-semibold text-gray-900 dark:text-white">Exports</p>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                            Use the <strong className="text-gray-700 dark:text-gray-200">Google Sheets Add-on</strong> or{" "}
                            <strong className="text-gray-700 dark:text-gray-200">Looker Studio connector</strong> to pull your data on-demand. No extra destination setup required.
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
                        <Link href="/sources" className="font-semibold text-ink underline">
                            Sources
                        </Link>{" "}
                        page, then use your data in Sheets or Looker.
                    </>
                ) : (
                    <>
                        <Send className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        After connecting sources, open{" "}
                        <Link href="/exports" className="font-semibold text-ink underline">
                            Exports
                        </Link>{" "}
                        to learn how to pull your data.
                    </>
                )}
            </p>
        </div>
    );
}
