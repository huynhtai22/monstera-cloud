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
        <div className="mb-8 rounded-2xl border border-cyan-200/80 bg-gradient-to-br from-cyan-50/90 to-white p-5 shadow-sm dark:border-cyan-900/40 dark:from-cyan-950/30 dark:to-slate-900/40">
            <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">
                    How data moves
                </p>
                <button
                    type="button"
                    onClick={dismiss}
                    className="rounded-md p-1 text-cyan-600/60 transition-colors hover:bg-cyan-100 hover:text-cyan-800 dark:text-cyan-500/60 dark:hover:bg-cyan-900/40 dark:hover:text-cyan-300"
                    aria-label="Dismiss"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
                <div className="flex min-w-0 flex-1 gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-cyan-800 dark:bg-cyan-900/60 dark:text-cyan-100">
                        <Database className="h-4 w-4" aria-hidden />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">1. Sources — ad platforms</p>
                        <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                            Sign in with your <strong>Facebook</strong>, <strong>Google Ads</strong>, or <strong>TikTok</strong>{" "}
                            identity. Monstera reads metrics for <strong>accounts granted in OAuth</strong>.
                        </p>
                    </div>
                </div>
                <div className="hidden items-center justify-center md:flex md:pt-2">
                    <ArrowRight className="h-5 w-5 text-cyan-500/80" aria-hidden />
                </div>
                <div className="flex min-w-0 flex-1 gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                        <Send className="h-4 w-4" aria-hidden />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">2. Destinations — often another Google</p>
                        <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                            <strong>Google Sheets</strong> and <strong>Looker Studio</strong> can be a <strong>different</strong>{" "}
                            Google login from your ads — the pipeline links them inside this workspace.
                        </p>
                    </div>
                </div>
            </div>
            {!isSources ? (
                <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-cyan-100/80 pt-4 text-xs text-gray-500 dark:border-cyan-900/30 dark:text-gray-400">
                    <Unplug className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Connect sources first on the{" "}
                    <Link href="/sources" className="font-semibold text-cyan-700 underline hover:no-underline dark:text-cyan-300">
                        Sources
                    </Link>{" "}
                    page, then add Sheets or Looker here so we can create a pipeline.
                </p>
            ) : (
                <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-cyan-100/80 pt-4 text-xs text-gray-500 dark:border-cyan-900/30 dark:text-gray-400">
                    <Send className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    After sources are connected, open{" "}
                    <Link href="/destinations" className="font-semibold text-cyan-700 underline hover:no-underline dark:text-cyan-300">
                        Destinations
                    </Link>{" "}
                    to choose where rows and dashboards land.
                </p>
            )}
        </div>
    );
}
