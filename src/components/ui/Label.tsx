"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, children, required, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          "text-xs font-semibold text-gray-700 dark:text-slate-300",
          className
        )}
        {...props}
      >
        {children}
        {required && (
          <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
        )}
      </label>
    );
  }
);
Label.displayName = "Label";
