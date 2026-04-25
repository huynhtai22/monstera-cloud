"use client";

import React from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const RecentSyncsSection = React.memo(function RecentSyncsSection({
  logs,
}: {
  logs: Array<any>;
}) {
  if (logs.length === 0) return null;

  return (
    <div className="mt-10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">
          Recent Syncs
        </h2>
        <Link
          href="/reports"
          className="text-xs font-semibold text-cyan-700 hover:underline dark:text-cyan-300"
        >
          View all logs
        </Link>
      </div>

      <div className="rounded-2xl border border-gray-200/80 bg-white/60 p-5 shadow-sm dark:border-slate-600/70 dark:bg-slate-800/90 dark:ring-1 dark:ring-white/5">
        <div className="space-y-3">
          {logs.map((l: any) => (
            <div
              key={l.id}
              className={cn(
                "flex items-start justify-between gap-3 rounded-xl border p-3",
                l.status === "success"
                  ? "border-cyan-100 bg-cyan-50/40 dark:border-cyan-900/30 dark:bg-cyan-950/20"
                  : "border-red-100 bg-red-50/40 dark:border-red-900/30 dark:bg-red-950/20"
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {l.status === "success" ? (
                    <CheckCircle2 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-300" />
                  )}
                  <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                    {l.pipeline?.name ?? "Pipeline"}
                  </div>
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {l.status === "success"
                    ? `Synced ${l.rowsSynced ?? 0} rows`
                    : `Failed: ${String(l.errorMsg ?? "").slice(0, 120)}`}
                </div>
              </div>
              <div className="shrink-0 text-xs font-medium text-gray-400 dark:text-gray-500">
                {l.createdAt ? new Date(l.createdAt).toLocaleString() : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
