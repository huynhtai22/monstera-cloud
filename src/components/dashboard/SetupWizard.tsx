"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { CheckCircle2, Circle, ArrowRight, Sparkles } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import { cn } from "@/lib/utils";

type SetupWizardProps = {
    hasSource: boolean;
    hasDestination: boolean;
    hasSuccessfulSync: boolean;
    onDismiss?: () => void;
};

const steps = [
    {
        key: "source" as const,
        label: "Connect a data source",
        description: "TikTok Ads, Meta Ads, Google Ads, Shopee, Lazada, or Shopify.",
        cta: "Go to Sources",
        href: "/sources",
        eventKey: "source_connect_clicked",
    },
    {
        key: "destination" as const,
        label: "Connect a destination",
        description: "Google Sheets™ or Looker Studio™ — where your reports will land. Skip this if you're using our Google Sheets Add-on or Looker Studio Connector directly.",
        cta: "Go to Destinations",
        href: "/destinations",
        eventKey: "destination_connect_clicked",
    },
    {
        key: "sync" as const,
        label: "Run your first sync",
        description:
            "From Sources, open a source and use Sync now (or run a pipeline from Transformations). Then use Google Sheets with the Monstera add-on, or Looker Studio with the connector + your workspace API key.",
        cta: "Run a sync",
        href: "/sources",
        eventKey: "first_sync_clicked",
    },
];

export function SetupWizard({ hasSource, hasDestination, hasSuccessfulSync, onDismiss }: SetupWizardProps) {
    const { data: session } = useSession();
    const firstName = session?.user?.name?.split(/\s+/)[0] ?? "there";

    const completed = [hasSource, hasDestination, hasSuccessfulSync];
    const doneCount = completed.filter(Boolean).length;
    const allDone = doneCount === 3;
    const activeIndex = completed.findIndex((done) => !done);

    if (allDone) {
        return (
            <div className="relative z-10 mb-10 rounded-2xl border border-cyan-200/80 bg-cyan-50/60 p-8 shadow-sm dark:border-cyan-800/50 dark:bg-cyan-950/30">
                <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cyan-100 dark:bg-cyan-900/60">
                        <Sparkles className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                            You&apos;re all set, {firstName}!
                        </h2>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                            Your first sync is complete. Open{" "}
                            <Link
                                href="/looker-studio"
                                className="font-semibold text-cyan-700 underline hover:no-underline dark:text-cyan-300"
                                onClick={() => trackEvent("wizard_help_link_click", { href: "/looker-studio", step: "all_done" })}
                            >
                                Looker Studio
                            </Link>{" "}
                            or the{" "}
                            <Link
                                href="/docs"
                                className="font-semibold text-cyan-700 underline hover:no-underline dark:text-cyan-300"
                                onClick={() => trackEvent("wizard_help_link_click", { href: "/docs", step: "all_done" })}
                            >
                                Sheets add-on docs
                            </Link>{" "}
                            to use data outside the console. Check Reports for logs.
                        </p>
                    </div>
                    <div className="ml-auto flex items-center gap-3">
                        <Link
                            href="/reports"
                            className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700 transition-colors"
                            onClick={() => trackEvent("wizard_step_completed", { step: "view_reports" })}
                        >
                            View Reports <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                        {onDismiss && (
                            <button
                                type="button"
                                onClick={() => { trackEvent("wizard_step_completed", { step: "dismiss" }); onDismiss(); }}
                                className="text-xs font-semibold text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
                            >
                                Dismiss
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="relative z-10 mb-10 rounded-2xl border border-gray-200/80 bg-white/70 p-6 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/50">
            {/* Header + progress */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
                <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                        Hi {firstName}, let&apos;s get your data flowing.
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {doneCount} of 3 core steps complete — most users finish in under 5 minutes.
                    </p>
                </div>
                {onDismiss && (
                    <button
                        type="button"
                        onClick={() => { trackEvent("wizard_step_completed", { step: "dismiss" }); onDismiss(); }}
                        className="self-start sm:self-auto text-xs font-semibold text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200 transition-colors"
                    >
                        Dismiss
                    </button>
                )}
            </div>

            {/* Progress bar */}
            <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
                <div
                    className="h-full rounded-full bg-cyan-500 transition-all duration-500"
                    style={{ width: `${(doneCount / 3) * 100}%` }}
                />
            </div>

            {/* Steps */}
            <ol className="space-y-3">
                {steps.map((step, i) => {
                    const done = completed[i];
                    const isActive = i === activeIndex;
                    const isLocked = !done && i > activeIndex;

                    return (
                        <li
                            key={step.key}
                            className={cn(
                                "flex items-start gap-4 rounded-xl border px-5 py-4 transition-all",
                                done
                                    ? "border-gray-100 bg-gray-50/60 dark:border-slate-800 dark:bg-slate-800/30 opacity-70"
                                    : isActive
                                      ? "border-cyan-200 bg-cyan-50/70 shadow-sm dark:border-cyan-700/60 dark:bg-cyan-950/30"
                                      : "border-gray-100 bg-white/40 dark:border-slate-800/60 dark:bg-slate-900/20 opacity-50"
                            )}
                        >
                            {/* Icon */}
                            <div className="mt-0.5 shrink-0">
                                {done ? (
                                    <CheckCircle2 className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                                ) : isActive ? (
                                    <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-cyan-500">
                                        <div className="h-2 w-2 rounded-full bg-cyan-500" />
                                    </div>
                                ) : (
                                    <Circle className="h-5 w-5 text-gray-300 dark:text-gray-600" />
                                )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                                <div className={cn(
                                    "font-semibold text-sm",
                                    done ? "text-gray-500 dark:text-gray-400 line-through decoration-gray-300 dark:decoration-gray-600"
                                        : isActive ? "text-gray-900 dark:text-white"
                                        : "text-gray-400 dark:text-gray-600"
                                )}>
                                    {i + 1}. {step.label}
                                </div>
                                {!done && (
                                    <p className={cn(
                                        "mt-0.5 text-xs",
                                        isActive ? "text-gray-600 dark:text-gray-400" : "text-gray-400 dark:text-gray-600"
                                    )}>
                                        {step.description}
                                    </p>
                                )}
                            </div>

                            {/* CTA — only on active step */}
                            {isActive && (
                                <div className="flex shrink-0 flex-col items-end gap-1.5">
                                    <Link
                                        href={step.href}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 transition-colors whitespace-nowrap"
                                        onClick={() => trackEvent(step.eventKey, { from: "wizard" })}
                                    >
                                        {step.cta} <ArrowRight className="h-3 w-3" />
                                    </Link>
                                    {/* Skip path for connector-first users on the destination step */}
                                    {step.key === "destination" && onDismiss && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                trackEvent("wizard_addon_skip", { step: "destination" });
                                                onDismiss();
                                            }}
                                            className="text-[11px] font-medium text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300 whitespace-nowrap"
                                        >
                                            Using the Add-on? Skip this →
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Done badge */}
                            {done && (
                                <span className="shrink-0 text-xs font-medium text-cyan-600 dark:text-cyan-400">Done</span>
                            )}
                        </li>
                    );
                })}
            </ol>

            <div className="mt-6 rounded-xl border border-dashed border-cyan-200/90 bg-cyan-50/50 p-4 dark:border-cyan-800/50 dark:bg-cyan-950/25">
                <p className="text-xs font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">Use data in Sheets or Looker</p>
                <p className="mt-2 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                    After you sync, install the Monstera Google Sheets add-on (Workspace Marketplace) or connect Looker Studio with your API key from Settings.
                </p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold">
                    <Link
                        href="/docs"
                        className="text-cyan-700 underline hover:no-underline dark:text-cyan-300"
                        onClick={() => trackEvent("wizard_help_link_click", { href: "/docs", step: "sheets_looker_hint" })}
                    >
                        Sheets add-on docs
                    </Link>
                    <Link
                        href="/looker-studio"
                        className="text-cyan-700 underline hover:no-underline dark:text-cyan-300"
                        onClick={() => trackEvent("wizard_help_link_click", { href: "/looker-studio", step: "sheets_looker_hint" })}
                    >
                        Looker Studio guide
                    </Link>
                    <Link
                        href="/destinations"
                        className="text-cyan-700 underline hover:no-underline dark:text-cyan-300"
                        onClick={() => trackEvent("wizard_help_link_click", { href: "/destinations", step: "sheets_looker_hint" })}
                    >
                        Destinations
                    </Link>
                </div>
            </div>
        </div>
    );
}
