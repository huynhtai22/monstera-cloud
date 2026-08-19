"use client";

import * as React from "react";
import Button from "./Button";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Backwards-compatible class string for links styled like the primary button. */
export const primaryButtonLinkClassName = cn(
  "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold text-primary-foreground",
  "bg-primary hover:bg-primary-hover",
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
  "transition-colors cursor-pointer"
);

export interface PrimaryButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  size?: "sm" | "md" | "lg";
}

export const PrimaryButton = React.forwardRef<HTMLButtonElement, PrimaryButtonProps>(
  ({ className, children, disabled, loading, size = "md", type = "button", ...props }, ref) => {
    return (
      <Button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        variant="primary"
        size={size}
        className={className}
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
      </Button>
    );
  }
);
PrimaryButton.displayName = "PrimaryButton";
