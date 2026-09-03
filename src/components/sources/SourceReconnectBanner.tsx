"use client";

import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { reconnectGuidance } from "@/lib/source-list-display";

export function SourceReconnectBanner({
  provider,
  needsReconnect = true,
  onReconnect,
}: {
  provider?: string;
  needsReconnect?: boolean;
  onReconnect?: () => void;
}) {
  const guidance = reconnectGuidance(provider);
  return (
    <div className="rounded-xl border border-line/80 bg-panel/50 p-5 shadow-xs">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
            needsReconnect
              ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
              : "border-amber-500/30 bg-amber-500/10 text-amber-400",
          )}>
            <AlertCircle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold tracking-tight text-ink">
              {needsReconnect ? guidance.title : "No accounts on this connection"}
            </h4>
            <p className="mt-1 text-xs leading-relaxed text-ink-mute">
              {needsReconnect
                ? guidance.detail
                : "Reconnect to restore access and discover available accounts."}
            </p>
          </div>
        </div>
        {onReconnect ? (
          <button
            type="button"
            onClick={onReconnect}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 transition-all"
          >
            Reconnect
          </button>
        ) : null}
      </div>
    </div>
  );
}
