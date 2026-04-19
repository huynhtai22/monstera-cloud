"use client";

import Link from "next/link";
import { ListOrdered } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import { DESTINATION_HELP_PATHS } from "@/lib/destination-help-urls";

function trackHelp(variant: "looker" | "sheets", href: string) {
    trackEvent("destination_help_link_click", { variant, href });
}

export function PostConnectChecklist({ variant }: { variant: "looker" | "sheets" }) {
    if (variant === "looker") {
        return (
            <div className="rounded-xl border border-cyan-100 bg-white/90 p-4 text-left dark:border-cyan-900/50 dark:bg-slate-900/50">
                <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">
                    <ListOrdered className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Next steps in Looker Studio
                </p>
                <ol className="list-decimal space-y-2 pl-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                    <li>Copy your workspace API key above.</li>
                    <li>In Looker Studio, create a data source and choose the Monstera community connector.</li>
                    <li>Paste the key when prompted, then select accounts and metrics.</li>
                </ol>
                <div className="mt-4 flex flex-col gap-2 border-t border-cyan-100/80 pt-3 dark:border-cyan-900/40">
                    <Link
                        href={DESTINATION_HELP_PATHS.lookerStudio}
                        onClick={() => trackHelp("looker", DESTINATION_HELP_PATHS.lookerStudio)}
                        className="text-sm font-semibold text-cyan-700 underline hover:no-underline dark:text-cyan-300"
                    >
                        Open Looker Studio setup guide
                    </Link>
                    <Link
                        href={DESTINATION_HELP_PATHS.docs}
                        onClick={() => trackHelp("looker", DESTINATION_HELP_PATHS.docs)}
                        className="text-xs font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                        Technical documentation
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-sm rounded-xl border border-cyan-100 bg-white/90 p-4 text-left dark:border-cyan-900/50 dark:bg-slate-900/50">
            <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">
                <ListOrdered className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Next steps with Google Sheets
            </p>
            <ol className="list-decimal space-y-2 pl-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                <li>
                    Ensure a{" "}
                    <Link
                        href={DESTINATION_HELP_PATHS.transformations}
                        onClick={() => trackHelp("sheets", DESTINATION_HELP_PATHS.transformations)}
                        className="font-semibold text-cyan-700 underline hover:no-underline dark:text-cyan-300"
                    >
                        pipeline
                    </Link>{" "}
                    links your source to this destination.
                </li>
                <li>
                    Run a sync from{" "}
                    <Link
                        href={DESTINATION_HELP_PATHS.sources}
                        onClick={() => trackHelp("sheets", DESTINATION_HELP_PATHS.sources)}
                        className="font-semibold text-cyan-700 underline hover:no-underline dark:text-cyan-300"
                    >
                        Sources
                    </Link>{" "}
                    (open a source → Sync now).
                </li>
                <li>Install the Monstera Sheets add-on from Google Workspace Marketplace, then open a spreadsheet and run the add-on.</li>
            </ol>
            <div className="mt-4 flex flex-col gap-2 border-t border-cyan-100/80 pt-3 dark:border-cyan-900/40">
                <Link
                    href={DESTINATION_HELP_PATHS.docs}
                    onClick={() => trackHelp("sheets", DESTINATION_HELP_PATHS.docs)}
                    className="text-sm font-semibold text-cyan-700 underline hover:no-underline dark:text-cyan-300"
                >
                    Sheets add-on documentation
                </Link>
                <Link
                    href={DESTINATION_HELP_PATHS.support}
                    onClick={() => trackHelp("sheets", DESTINATION_HELP_PATHS.support)}
                    className="text-xs font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                >
                    Need help? Contact support
                </Link>
            </div>
        </div>
    );
}
