import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { DESTINATION_HELP_PATHS } from "@/lib/destination-help-urls";

type PostConnectChecklistProps = {
    variant: "looker" | "sheets";
};

/**
 * Short post-connect steps shown after linking Looker Studio or Google Sheets.
 */
export function PostConnectChecklist({ variant }: PostConnectChecklistProps) {
    if (variant === "looker") {
        return (
            <div className="mt-4 rounded-xl border border-cyan-100/90 bg-cyan-50/50 p-4 text-left dark:border-cyan-900/40 dark:bg-cyan-950/25">
                <p className="text-xs font-bold uppercase tracking-wide text-cyan-900 dark:text-cyan-200">Next steps</p>
                <ul className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300">
                    <li className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden />
                        <span>
                            Copy your workspace API key from{" "}
                            <Link
                                href="/settings?tab=api"
                                className="font-semibold text-cyan-700 underline underline-offset-2 hover:no-underline dark:text-cyan-300"
                            >
                                Settings → API
                            </Link>
                            .
                        </span>
                    </li>
                    <li className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden />
                        <span>
                            Run a sync from{" "}
                            <Link
                                href={DESTINATION_HELP_PATHS.sources}
                                className="font-semibold text-cyan-700 underline underline-offset-2 hover:no-underline dark:text-cyan-300"
                            >
                                Sources
                            </Link>{" "}
                            so warehouse data is fresh before you query it in Looker Studio.
                        </span>
                    </li>
                </ul>
            </div>
        );
    }

    return (
        <div className="mt-4 rounded-xl border border-emerald-100/90 bg-emerald-50/50 p-4 text-left dark:border-emerald-900/40 dark:bg-emerald-950/25">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-900 dark:text-emerald-200">Next steps</p>
            <ul className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300">
                <li className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    <span>
                        Install the Monstera Sheets add-on from the{" "}
                        <Link
                            href={DESTINATION_HELP_PATHS.docs}
                            className="font-semibold text-emerald-800 underline underline-offset-2 hover:no-underline dark:text-emerald-300"
                        >
                            add-on docs
                        </Link>
                        .
                    </span>
                </li>
                <li className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    <span>
                        Run a sync from{" "}
                        <Link
                            href={DESTINATION_HELP_PATHS.sources}
                            className="font-semibold text-emerald-800 underline underline-offset-2 hover:no-underline dark:text-emerald-300"
                        >
                            Sources
                        </Link>{" "}
                        so data lands in the spreadsheets Monstera creates.
                    </span>
                </li>
            </ul>
        </div>
    );
}
