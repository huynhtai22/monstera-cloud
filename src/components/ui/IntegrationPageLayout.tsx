"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const inputFocus =
  "focus:outline-none focus:ring-2 focus:ring-primary-ring/30 dark:focus:ring-primary-ring/40";

export { inputFocus };

export function IntegrationPageLayout({
  title,
  description,
  icon,
  banner,
  leftColumn,
  primaryAction,
  results,
  className,
  resultsHeader,
  resultsClassName,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  banner?: React.ReactNode;
  leftColumn: React.ReactNode;
  /** Omit or pass null to hide the primary CTA slot (e.g. empty state pages). */
  primaryAction?: React.ReactNode;
  results: React.ReactNode;
  className?: string;
  /** Optional title row inside results panel (e.g. export) */
  resultsHeader?: React.ReactNode;
  resultsClassName?: string;
}) {
  return (
    <div
      className={cn(
        "relative w-full max-w-7xl animate-in fade-in duration-300 mx-auto px-6 py-10 md:px-8",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute right-[10%] top-0 h-[40%] w-[40%] rounded-full bg-cyan-200/15 blur-[120px] dark:bg-cyan-900/20" />
        <div className="absolute bottom-[10%] left-0 h-[50%] w-[40%] rounded-full bg-slate-200/20 blur-[120px] dark:bg-[#16181c]/30" />
      </div>

      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-[#2f3336] dark:bg-[#16181c]">
            {icon}
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">{title}</h1>
            <p className="mt-1 max-w-2xl text-base text-gray-600 dark:text-gray-400">{description}</p>
          </div>
        </div>
      </header>

      {banner}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-5 lg:col-span-2">
          {leftColumn}
          {primaryAction != null && primaryAction !== false ? (
            <div className="w-full">{primaryAction}</div>
          ) : null}
        </div>

        <div className="flex min-h-[420px] flex-col lg:col-span-3">
          <div
            className={cn(
              "flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-[#2f3336] dark:bg-[#000000]/80",
              resultsClassName
            )}
          >
            {resultsHeader != null && (
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-[#2f3336]/60">
                {resultsHeader}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto">{results}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
