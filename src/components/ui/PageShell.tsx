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
        <div
            className={cn(
                "relative mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-10 animate-in fade-in duration-300",
                className
            )}
        >
            {withBackdrop ? (
                <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
                    <div className="absolute left-[6%] top-[-18%] h-[55%] w-[60%] rounded-full bg-cyan-200/25 blur-[120px] dark:bg-cyan-900/20" />
                    <div className="absolute right-[-4%] top-[18%] h-[60%] w-[52%] rounded-full bg-blue-200/20 blur-[120px] dark:bg-blue-900/18" />
                    <div className="absolute bottom-[-25%] left-[18%] h-[60%] w-[70%] rounded-full bg-cyan-100/25 blur-[140px] dark:bg-cyan-900/10" />
                </div>
            ) : null}
            {children}
        </div>
    );
}
