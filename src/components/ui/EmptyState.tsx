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
                "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/80 px-6 py-16 text-center dark:border-slate-700 dark:bg-slate-800/40",
                className
            )}
        >
            <div className="mb-4 text-gray-300 dark:text-gray-600 [&>svg]:h-12 [&>svg]:w-12">{icon}</div>
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
