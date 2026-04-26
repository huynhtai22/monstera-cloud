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
  "inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-200 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300/80 focus-visible:ring-offset-2 dark:focus-visible:ring-slate-600 transition-all active:scale-[0.97] cursor-pointer";
