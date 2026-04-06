"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function IntegrationSectionCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/50 rounded-xl",
        className
      )}
    >
      <h2 className="mb-4 text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h2>
      {children}
    </div>
  );
}
