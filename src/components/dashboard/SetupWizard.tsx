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
            <div className="relative z-10 rounded-lg border border-line bg-panel p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-canvas">
                        <Sparkles className="h-5 w-5 text-ink" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h2 className="text-base font-semibold text-ink">
                            You&apos;re all set, {firstName}!
                        </h2>
                        <p className="mt-1 text-sm leading-relaxed text-ink-mute">
                            Your first source sync is complete. Open{" "}
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
                            to use data outside the console. Review Sources for the latest source-sync status.
                        </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-3 sm:ml-auto sm:justify-end">
                        <Link
                            href="/sources"
                            className={primaryButtonLinkClassName + " inline-flex items-center gap-2"}
                            onClick={() => trackEvent("wizard_step_completed", { step: "view_reports" })}
                        >
                            Review sources <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                        {onDismiss && (
                            <button
                                type="button"
                                onClick={() => { trackEvent("wizard_step_completed", { step: "dismiss" }); onDismiss(); }}
                                className="rounded text-xs font-semibold text-ink-mute transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
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
        <div className="relative z-10 rounded-lg border border-line bg-panel p-5 sm:p-6">
            {/* Header + progress */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
                <div>
                    <h2 className="text-base font-semibold text-ink">
                        Hi {firstName}, let&apos;s get your data flowing.
                    </h2>
                    <p className="mt-1 text-sm text-ink-mute">
                        {doneCount} of 2 core steps complete — most users finish in under 5 minutes.
                    </p>
                </div>
                {onDismiss && (
                    <button
                        type="button"
                        onClick={() => { trackEvent("wizard_step_completed", { step: "dismiss" }); onDismiss(); }}
                        className="self-start rounded text-xs font-semibold text-ink-mute transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 sm:self-auto"
                    >
                        Dismiss
                    </button>
                )}
            </div>

            {/* Progress bar */}
            <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-canvas">
                <div
                    className="h-full rounded-full bg-accent motion-safe:transition-[width] motion-safe:duration-500 motion-reduce:transition-none"
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
                                "flex flex-col gap-3 rounded-lg border px-4 py-4 motion-safe:transition-colors sm:flex-row sm:items-start sm:gap-4",
                                done
                                    ? "border-line bg-canvas/70 opacity-70"
                                    : isActive
                                      ? "border-line bg-white/[0.04]"
                                      : "border-line bg-canvas/40 opacity-50"
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
                                    <Circle className="h-5 w-5 text-ink-mute" />
                                )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                                <div className={cn(
                                    "font-semibold text-sm",
                                    done ? "text-ink-mute line-through decoration-ink-mute"
                                        : isActive ? "text-ink"
                                        : "text-ink-mute"
                                )}>
                                    {i + 1}. {step.label}
                                </div>
                                {!done && (
                                    <p className={cn(
                                        "mt-0.5 text-xs",
                                        "leading-relaxed text-ink-mute"
                                    )}>
                                        {step.description}
                                    </p>
                                )}
                            </div>

                            {/* CTA — only on active step */}
                            {isActive && (
                                <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
                                    <Link
                                        href={step.href}
                                        className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
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
                <p className="mt-2 text-xs leading-relaxed text-ink-mute">
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
