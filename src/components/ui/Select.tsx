"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, error, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "flex h-10 w-full appearance-none rounded-lg border bg-white px-3 py-2 text-sm",
            "border-gray-200 text-gray-900",
            "focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-slate-600 dark:bg-slate-800 dark:text-white",
            "dark:focus:ring-cyan-500/20 dark:focus:border-cyan-500",
            "pr-8", // Space for chevron
            error && "border-red-500 focus:ring-red-500/20 focus:border-red-500",
            error && "dark:border-red-500 dark:focus:ring-red-500/20 dark:focus:border-red-500",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 pointer-events-none dark:text-slate-500" />
      </div>
    );
  }
);
Select.displayName = "Select";
