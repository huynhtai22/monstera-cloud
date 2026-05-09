"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border bg-white px-3 py-2 text-sm",
          "border-gray-200 text-gray-900 placeholder:text-gray-400",
          "focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "dark:border-[#2f3336] dark:bg-[#16181c] dark:text-white dark:placeholder:text-slate-400",
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
Input.displayName = "Input";
