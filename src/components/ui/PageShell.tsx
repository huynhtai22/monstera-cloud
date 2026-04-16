"use client";

import { cn } from "@/lib/utils";

type PageShellProps = {
    children: React.ReactNode;
    className?: string;
    /** Subtle shared background blobs (motion-reduced users skip via parent) */
    withBackdrop?: boolean;
};

export function PageShell({ children, className, withBackdrop = true }: PageShellProps) {
    return (
        <div className={cn("relative mx-auto w-full max-w-7xl px-8 py-10 animate-in fade-in duration-300", className)}>
            {withBackdrop ? (
                <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
                    <div className="absolute left-[10%] top-[-10%] h-[50%] w-[50%] rounded-full bg-cyan-200/20 blur-[120px] dark:bg-cyan-900/20" />
                    <div className="absolute right-[0%] top-[30%] h-[60%] w-[40%] rounded-full bg-blue-200/20 blur-[120px] dark:bg-blue-900/20" />
                </div>
            ) : null}
            {children}
        </div>
    );
}
