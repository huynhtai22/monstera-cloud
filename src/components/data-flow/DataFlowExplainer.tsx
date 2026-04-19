import Link from "next/link";
import { ArrowRight, Database, Send, Unplug } from "lucide-react";

type Variant = "sources" | "destinations";

/**
 * Short, consistent copy so users understand:
 * - Sources use each platform’s marketing login (Meta BM, Google Ads / MCC, TikTok Ads).
 * - Destinations (Sheets, Looker) often use a *different* Google account — that is OK.
 */
export function DataFlowExplainer({ variant }: { variant: Variant }) {
    const isSources = variant === "sources";

    return (
        <div className="mb-8 rounded-2xl border border-cyan-200/80 bg-gradient-to-br from-cyan-50/90 to-white p-5 shadow-sm dark:border-cyan-900/40 dark:from-cyan-950/30 dark:to-slate-900/40">
            <p className="text-xs font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">
                How data moves
            </p>
            <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
                <div className="flex min-w-0 flex-1 gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-cyan-800 dark:bg-cyan-900/60 dark:text-cyan-100">
                        <Database className="h-5 w-5" aria-hidden />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">1. Sources — ad platforms</p>
                        <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                            You sign in with the <strong>Facebook</strong>, <strong>Google Ads</strong>, or <strong>TikTok</strong>{" "}
                            identity that owns those ad accounts (BM / MCC / advertiser). Monstera reads metrics for the{" "}
                            <strong>accounts granted in OAuth</strong> — see each source&apos;s detail page for the list.
                        </p>
                    </div>
                </div>
                <div className="hidden items-center justify-center md:flex md:pt-2">
                    <ArrowRight className="h-5 w-5 text-cyan-500/80" aria-hidden />
                </div>
                <div className="flex min-w-0 flex-1 gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                        <Send className="h-5 w-5" aria-hidden />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">2. Destinations — often another Google</p>
                        <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                            <strong>Google Sheets</strong> and <strong>Looker Studio</strong> use whichever Google account you
                            pick when you connect here. That can be <strong>Gmail B</strong> while your ads stay on{" "}
                            <strong>Gmail A</strong> — the pipeline links them inside this workspace.
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
                    <Link
                        href="/destinations"
                        className="font-semibold text-cyan-700 underline hover:no-underline dark:text-cyan-300"
                    >
                        Destinations
                    </Link>{" "}
                    to choose where rows and dashboards land (can be a different Google login).
                </p>
            )}
        </div>
    );
}
