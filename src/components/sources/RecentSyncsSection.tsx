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
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink-mute">
          Recent Syncs
        </h2>
        <Link
          href="/reports"
          className="text-xs font-semibold text-white hover:text-neutral-300 transition-colors"
        >
          View all logs
        </Link>
      </div>

      <div className="rounded-lg border border-line bg-panel p-4 shadow-xs">
        <div className="space-y-2.5">
          {logs.map((l: any) => (
            <div
              key={l.id}
              className={cn(
                "flex items-start justify-between gap-3 rounded-md border p-3",
                l.status === "success"
                  ? "border-line bg-canvas"
                  : "border-red-900/30 bg-red-950/20"
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {l.status === "success" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                  )}
                  <div className="truncate text-xs font-semibold text-ink">
                    {l.pipeline?.name ?? "Pipeline"}
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-ink-mute">
                  {l.status === "success"
                    ? `Synced ${l.rowsSynced ?? 0} rows`
                    : `Failed: ${String(l.errorMsg ?? "").slice(0, 120)}`}
                </div>
              </div>
              <div className="shrink-0 text-[10px] font-mono text-ink-mute">
                {l.createdAt ? new Date(l.createdAt).toLocaleString() : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
