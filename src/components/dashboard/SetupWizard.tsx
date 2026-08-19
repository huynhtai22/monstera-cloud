"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { CheckCircle2, Circle, ArrowRight, Sparkles } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import { cn } from "@/lib/utils";
import { primaryButtonLinkClassName } from "@/components/ui/PrimaryButton";

type SetupWizardProps = {
    hasSource: boolean;
    hasSuccessfulSync: boolean;
    onDismiss?: () => void;
};

const steps = [
    {
        key: "source" as const,
        label: "Connect a data source",
        description: "Connect an enabled Meta Ads, Google Ads, TikTok Ads, or Shopee account.",
        cta: "Go to Sources",
        href: "/sources",
        eventKey: "source_connect_clicked",
    },

    {
        key: "sync" as const,
        label: "Run your first sync",
        description:
            "From Sources, open a connection and choose Sync now. Verify the imported rows in Data Explorer, then use Sheets, Looker, or the API.",
        cta: "Run a sync",
        href: "/sources",
        eventKey: "first_sync_clicked",
    },
];

export function SetupWizard({ hasSource, hasSuccessfulSync, onDismiss }: SetupWizardProps) {
    const { data: session } = useSession();
    const firstName = session?.user?.name?.split(/\s+/)[0] ?? "there";

    const completed = [hasSource, hasSuccessfulSync];
    const doneCount = completed.filter(Boolean).length;
    const allDone = doneCount === 2;
    const activeIndex = completed.findIndex((done) => !done);

    if (allDone) {
        return (
            <div className="relative z-10 mb-10 rounded-lg border border-line bg-panel p-8">
                <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-line bg-canvas">
                        <Sparkles className="h-6 w-6 text-ink" strokeWidth={1.5} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                            You&apos;re all set, {firstName}!
                        </h2>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                            Your first sync is complete. Open{" "}
                            <Link
                                    href="/looker-studio"
                                    className="font-semibold text-ink underline hover:no-underline"
                                    onClick={() => trackEvent("wizard_help_link_click", { href: "/looker-studio", step: "all_done" })}
                                >
                                    Looker Studio
                                </Link>{" "}
                            or the{" "}
                            <Link
                                href="/docs"
                                className="font-semibold text-ink underline hover:no-underline"
                                onClick={() => trackEvent("wizard_help_link_click", { href: "/docs", step: "all_done" })}
                            >
                                Sheets add-on docs
                            </Link>{" "}
                            to use data outside the console. Check Sync activity for logs.
                        </p>
                    </div>
                    <div className="ml-auto flex items-center gap-3">
                        <Link
                            href="/reports"
                            className={primaryButtonLinkClassName + " inline-flex items-center gap-2"}
                            onClick={() => trackEvent("wizard_step_completed", { step: "view_reports" })}
                        >
                            View sync activity <ArrowRight className="h-3.5 w-3.5" />
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
        <div className="relative z-10 mb-10 rounded-lg border border-line bg-panel p-6">
            {/* Header + progress */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
                <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                        Hi {firstName}, let&apos;s get your data flowing.
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {doneCount} of 2 core steps complete — most users finish in under 5 minutes.
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
            <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-[#16181c]">
                <div
                    className="h-full rounded-full bg-accent transition-all duration-500"
                    style={{ width: `${(doneCount / 2) * 100}%` }}
                />
            </div>

            {/* Steps */}
            <ol className="space-y-3">
                {steps.map((step, i) => {
                    const done = completed[i];
                    const isActive = i === activeIndex;
                    return (
                        <li
                            key={step.key}
                            className={cn(
                                "flex items-start gap-4 rounded-xl border px-5 py-4 transition-all",
                                done
                                    ? "border-gray-100 bg-gray-50/60 dark:border-[#2f3336] dark:bg-[#16181c]/30 opacity-70"
                                    : isActive
                                      ? "border-line bg-white/[0.04]"
                                      : "border-gray-100 bg-white/40 dark:border-[#2f3336]/60 dark:bg-[#000000]/20 opacity-50"
                            )}
                        >
                            {/* Icon */}
                            <div className="mt-0.5 shrink-0">
                                {done ? (
                                    <CheckCircle2 className="h-5 w-5 text-accent" strokeWidth={1.5} />
                                ) : isActive ? (
                                    <div className="flex h-5 w-5 items-center justify-center rounded-full border border-line">
                                        <div className="h-2 w-2 rounded-full bg-accent" />
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
                                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary-hover transition-colors whitespace-nowrap"
                                        onClick={() => trackEvent(step.eventKey, { from: "wizard" })}
                                    >
                                        {step.cta} <ArrowRight className="h-3 w-3" />
                                    </Link>

                                </div>
                            )}

                            {/* Done badge */}
                            {done && (
                                <span className="shrink-0 text-xs font-medium text-ink-mute">Done</span>
                            )}
                        </li>
                    );
                })}
            </ol>

            <div className="mt-6 rounded-md border border-dashed border-line bg-canvas p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-mute">Use data in Sheets or Looker</p>
                <p className="mt-2 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                    After you sync, use the private pilot Sheets installation or connect Looker Studio with a workspace API key from Settings.
                </p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold">
                    <Link
                        href="/docs"
                        className="text-ink underline hover:no-underline"
                        onClick={() => trackEvent("wizard_help_link_click", { href: "/docs", step: "sheets_looker_hint" })}
                    >
                        Sheets add-on docs
                    </Link>
                    <Link
                        href="/looker-studio"
                        className="text-ink underline hover:no-underline"
                        onClick={() => trackEvent("wizard_help_link_click", { href: "/looker-studio", step: "sheets_looker_hint" })}
                    >
                        Looker Studio guide
                    </Link>
                    <Link
                        href="/exports"
                        className="text-ink underline hover:no-underline"
                        onClick={() => trackEvent("wizard_help_link_click", { href: "/exports", step: "sheets_looker_hint" })}
                    >
                        Exports & API
                    </Link>
                </div>
            </div>
        </div>
    );
}
