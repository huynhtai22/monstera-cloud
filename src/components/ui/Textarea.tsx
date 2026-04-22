"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex w-full rounded-lg border bg-white px-3 py-2 text-sm",
          "border-gray-200 text-gray-900 placeholder:text-gray-400",
          "focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "min-h-[80px] resize-y",
          "dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-400",
          "dark:focus:ring-cyan-500/20 dark:focus:border-cyan-500",
          error && "border-red-500 focus:ring-red-500/20 focus:border-red-500",
          error && "dark:border-red-500 dark:focus:ring-red-500/20 dark:focus:border-red-500",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";
