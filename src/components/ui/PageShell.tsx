"use client";

import { cn } from "@/lib/utils";

type PageShellProps = {
    children: React.ReactNode;
    className?: string;
    /** Subtle shared background blobs (motion-reduced users skip via parent) */
    withBackdrop?: boolean;
};

export function PageShell({ children, className }: PageShellProps) {
    return (
        <div
            className={cn(
                "relative w-full px-6 py-6 sm:px-8 sm:py-7 lg:px-10 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300 motion-reduce:animate-none",
                className
            )}
        >
            {children}
        </div>
    );
}
