"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared classes for `<Link>` that should look like a primary button (avoid nesting `<button>` inside `<a>`). */
export const primaryButtonLinkClassName = cn(
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white",
  "bg-primary hover:bg-primary-hover",
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0f172a]",
  "transition-colors"
);

export interface PrimaryButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
}

export const PrimaryButton = React.forwardRef<HTMLButtonElement, PrimaryButtonProps>(
  ({ className, children, disabled, loading, type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={cn(
          primaryButtonLinkClassName,
          "disabled:pointer-events-none disabled:opacity-60",
          className
        )}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            <span>{children}</span>
          </>
        ) : (
          children
        )}
      </button>
    );
  }
);
PrimaryButton.displayName = "PrimaryButton";
