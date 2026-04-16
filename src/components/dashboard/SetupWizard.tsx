"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { CheckCircle2, Circle } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import { primaryButtonLinkClassName } from "@/components/ui/PrimaryButton";
import { cn } from "@/lib/utils";

type SetupWizardProps = {
    hasSource: boolean;
    hasDestination: boolean;
    hasSuccessfulSync: boolean;
    onDismiss?: () => void;
};

export function SetupWizard({ hasSource, hasDestination, hasSuccessfulSync, onDismiss }: SetupWizardProps) {
    const { data: session } = useSession();
    const firstName = session?.user?.name?.split(/\s+/)[0] ?? "there";

    const step1 = hasSource;
    const step2 = hasDestination;
    const step3 = hasSuccessfulSync;

    return (
        <div className="relative z-10 mb-10 rounded-2xl border border-gray-200/80 bg-white/70 p-8 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/50">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        Hi {firstName}, let&apos;s get your data flowing in 3 steps.
                    </h2>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        Most users finish in under 5 minutes.
                    </p>
                </div>
                {onDismiss ? (
                    <button
                        type="button"
                        onClick={() => {
                            trackEvent("wizard_step_completed", { step: "dismiss", flow: "setup_wizard" });
                            onDismiss();
                        }}
                        className="text-xs font-semibold text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
                    >
                        Dismiss
                    </button>
                ) : null}
            </div>

            <ol className="mt-8 space-y-6">
                <li className="flex gap-4">
                    <div className="mt-0.5 shrink-0">
                        {step1 ? (
                            <CheckCircle2 className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
                        ) : (
                            <Circle className="h-6 w-6 text-gray-300 dark:text-gray-600" />
                        )}
                    </div>
                    <div>
                        <div className="font-semibold text-gray-900 dark:text-white">① Connect a data source</div>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                            TikTok Ads, Meta Ads, Google Ads, Shopee, Lazada, or Shopify.
                        </p>
                        {!step1 ? (
                            <Link
                                href="/sources"
                                className={cn(primaryButtonLinkClassName, "mt-3 inline-flex")}
                                onClick={() => trackEvent("source_connect_clicked", { from: "wizard" })}
                            >
                                See all sources
                            </Link>
                        ) : null}
                    </div>
                </li>

                <li className="flex gap-4">
                    <div className="mt-0.5 shrink-0">
                        {step2 ? (
                            <CheckCircle2 className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
                        ) : (
                            <Circle className={cn("h-6 w-6", step1 ? "text-cyan-500" : "text-gray-300 dark:text-gray-600")} />
                        )}
                    </div>
                    <div>
                        <div className="font-semibold text-gray-900 dark:text-white">② Connect a destination</div>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                            Google Sheets™ or Looker Studio™ — where reports should land.
                        </p>
                        {!step2 ? (
                            <Link href="/destinations" className="mt-3 inline-block text-sm font-semibold text-cyan-700 underline dark:text-cyan-300">
                                Open Destinations
                            </Link>
                        ) : null}
                    </div>
                </li>

                <li className="flex gap-4">
                    <div className="mt-0.5 shrink-0">
                        {step3 ? (
                            <CheckCircle2 className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
                        ) : (
                            <Circle className="h-6 w-6 text-gray-300 dark:text-gray-600" />
                        )}
                    </div>
                    <div>
                        <div className="font-semibold text-gray-900 dark:text-white">③ First sync</div>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                            Run a sync from Sources when your pipeline is ready, then check Reports.
                        </p>
                        {step1 && step2 && !step3 ? (
                            <Link href="/sources" className="mt-3 inline-block text-sm font-semibold text-cyan-700 underline dark:text-cyan-300">
                                Go to Sources to sync
                            </Link>
                        ) : null}
                    </div>
                </li>
            </ol>
        </div>
    );
}
