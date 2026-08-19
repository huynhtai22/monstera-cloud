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
                "flex flex-col items-center justify-center overflow-hidden rounded-lg border border-line bg-panel px-6 py-12 text-center sm:py-16",
                className
            )}
        >
            <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md border border-line bg-canvas text-ink [&>svg]:h-5 [&>svg]:w-5">
                {icon}
            </div>
            <h3 className="mb-1 text-lg font-semibold text-ink">{title}</h3>
            <p className="mb-6 max-w-sm text-sm text-ink-mute">{description}</p>
            {(primaryAction || secondaryAction) && (
                <div className="flex flex-wrap items-center justify-center gap-3">
                    {primaryAction}
                    {secondaryAction}
                </div>
            )}
        </div>
    );
}
