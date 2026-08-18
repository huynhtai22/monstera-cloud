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
                "relative w-full px-6 py-8 sm:px-10 sm:py-10 lg:px-12 animate-in fade-in duration-300",
                className
            )}
        >
            {children}
        </div>
    );
}
