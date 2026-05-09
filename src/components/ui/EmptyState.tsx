"use client";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
    icon: React.ReactNode;
    title: string;
    description: string;
    primaryAction?: React.ReactNode;
    secondaryAction?: React.ReactNode;
    className?: string;
};

export function EmptyState({ icon, title, description, primaryAction, secondaryAction, className }: EmptyStateProps) {
    return (
        <div
            className={cn(
                "flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-cyan-200/30 bg-gradient-to-b from-cyan-50/45 via-white to-white px-6 py-12 text-center shadow-sm ring-1 ring-slate-900/[0.04] dark:from-cyan-950/30 dark:via-slate-900/60 dark:to-slate-900/30 dark:border-cyan-900/20 dark:ring-white/[0.06] sm:py-16",
                className
            )}
        >
            <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-200/50 bg-white/80 text-cyan-600 shadow-sm dark:border-cyan-800/50 dark:bg-[#000000]/40 dark:text-cyan-300 [&>svg]:h-5 [&>svg]:w-5">
                {icon}
            </div>
            <h3 className="mb-1 text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
            <p className="mb-6 max-w-sm text-sm text-gray-600 dark:text-gray-400">{description}</p>
            {(primaryAction || secondaryAction) && (
                <div className="flex flex-wrap items-center justify-center gap-3">
                    {primaryAction}
                    {secondaryAction}
                </div>
            )}
        </div>
    );
}
