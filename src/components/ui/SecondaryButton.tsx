"use client";

import * as React from "react";
import Button from "./Button";

export interface SecondaryButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md" | "lg";
}

export const SecondaryButton = React.forwardRef<HTMLButtonElement, SecondaryButtonProps>(
  ({ className, size = "md", type = "button", ...props }, ref) => {
    return (
      <Button ref={ref} type={type} variant="ghost" size={size} className={className} {...props} />
    );
  }
);
SecondaryButton.displayName = "SecondaryButton";

/** Backwards-compatible class string for links styled like the secondary button. */
export const secondaryButtonLinkClassName =
  "inline-flex items-center justify-center gap-2 rounded-md border border-line bg-panel px-4 py-2.5 text-sm font-medium text-ink hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/15 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas transition-colors cursor-pointer";
