"use client";

import React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConnectedSourceRowProps {
  integration: any;
  busyActions: Set<string>;
  onSync: (pipelineId: string, integrationId: string) => void;
  onDisconnect: (connectionId: string, displayName: string) => void;
  onFixConnection: (integration: any) => void;
}

export const ConnectedSourceRow = React.memo(function ConnectedSourceRow({
  integration,
  busyActions,
  onSync,
  onDisconnect,
  onFixConnection,
}: ConnectedSourceRowProps) {
  const isSyncing = busyActions.has(`sync:${integration.pipelineId}`);
  const isDisconnecting = busyActions.has(integration.id);
  const isBusy = busyActions.size > 0;
  const isError = integration.status === "error";

  // detect token/auth expiry to show better CTA
  const isAuthError =
    isError &&
    /token|expired|auth|unauthorized|401|permission/i.test(
      integration.errorMsg ?? ""
    );

  // flag if last sync was >48h ago
  const isStale = React.useMemo(() => {
    if (isError || integration.lastSync === "Never" || !integration.lastSync)
      return false;
    try {
      const d = new Date(integration.lastSync);
      return Date.now() - d.getTime() > 48 * 60 * 60 * 1000;
    } catch {
      return false;
    }
  }, [integration.lastSync, isError]);

  const subLabel = (() => {
    if (isError) return integration.errorMsg ?? "Needs attention";
    if (!integration.pipelineId)
      return "Connected · no pipeline yet — create a pipeline to start syncing";
    if (integration.lastSync === "Never") return "Connected · never synced";
    return `Last sync · ${integration.lastSync}`;
  })();

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-xl border bg-white/80 px-3 py-2.5 shadow-sm transition-colors dark:bg-[#000000]/70",
        isError
          ? "border-red-100 dark:border-red-900/40"
          : isStale
            ? "border-amber-100 dark:border-amber-900/40"
            : "border-gray-200/80 hover:border-cyan-200/80 dark:border-[#2f3336]/60 dark:hover:border-cyan-700/50"
      )}
    >
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200/70 bg-white p-1.5 dark:border-[#2f3336]/60 dark:bg-white">
        {isError && (
          <span className="absolute -right-1 -top-1 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500"></span>
          </span>
        )}
        {isStale && !isError && (
          <span className="absolute -right-1 -top-1 flex h-3 w-3">
            <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-400"></span>
          </span>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={integration.logoSrc}
          alt=""
          width={24}
          height={24}
          className="h-6 w-6 object-contain"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/sources/${integration.id}`}
            className="truncate text-sm font-semibold text-gray-900 hover:text-cyan-700 dark:text-white dark:hover:text-cyan-300"
          >
            {integration.name}
          </Link>
          {isError ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-label="Error" />
          ) : isStale ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-label="Stale" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-cyan-500 dark:text-cyan-400" aria-label="Connected" />
          )}
        </div>
        <p
          className={cn(
            "mt-0.5 truncate text-xs",
            isError
              ? "text-red-600 dark:text-red-400"
              : isStale
                ? "text-amber-600 dark:text-amber-400"
                : !integration.pipelineId
                  ? "text-amber-500 dark:text-amber-400"
                  : "text-gray-500 dark:text-slate-400"
          )}
          title={subLabel}
        >
          {subLabel.length > 72 ? subLabel.slice(0, 72) + "…" : subLabel}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isError ? (
          <button
            type="button"
            onClick={() => onFixConnection(integration)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs font-semibold transition-colors",
              isAuthError
                ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200 dark:hover:bg-amber-950/90"
                : "border-red-300 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60"
            )}
          >
            {isAuthError ? "Reconnect" : "Fix"}
          </button>
        ) : (
          <button
            type="button"
            disabled={isBusy || !integration.pipelineId}
            title={
              !integration.pipelineId
                ? "Create a pipeline first to enable sync"
                : undefined
            }
            onClick={() => {
              if (!integration.pipelineId) {
                toast.error(
                  <span>
                    No sync pipeline configured. Create a pipeline in the Dashboard.
                  </span>
                );
                return;
              }
              onSync(integration.pipelineId, integration.id);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-cyan-300/80 bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-800 transition-colors hover:bg-cyan-100 disabled:pointer-events-none disabled:opacity-50 dark:border-cyan-700/60 dark:bg-cyan-900/40 dark:text-cyan-200 dark:hover:bg-cyan-900/70"
          >
            {isSyncing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Syncing…
              </>
            ) : (
              "Sync"
            )}
          </button>
        )}
        <button
          type="button"
          disabled={isBusy}
          onClick={() => onDisconnect(integration.id, integration.name)}
          className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-red-700 disabled:pointer-events-none disabled:opacity-50 dark:text-slate-400 dark:hover:bg-[#16181c] dark:hover:text-red-300"
        >
          {isDisconnecting ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
    </div>
  );
});
