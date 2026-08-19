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
import { IntegrationMark } from "@/components/ui/IntegrationMark";

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
        "group flex items-center gap-3 rounded-lg border bg-panel px-3 py-2.5 shadow-xs transition-colors",
        isError
          ? "border-red-500/40"
          : isStale
            ? "border-amber-500/40"
            : "border-line hover:border-[#333]"
      )}
    >
      <div className="relative shrink-0">
        {isError && (
          <span className="absolute -right-1 -top-1 z-10 flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500"></span>
          </span>
        )}
        {isStale && !isError && (
          <span className="absolute -right-1 -top-1 z-10 flex h-2.5 w-2.5">
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400"></span>
          </span>
        )}
        <IntegrationMark
          src={integration.logoSrc}
          alt={integration.name}
          size="md"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/sources/${integration.id}`}
            className="truncate text-xs font-semibold text-ink hover:text-accent transition-colors"
          >
            {integration.name}
          </Link>
          {isError ? (
            <AlertCircle className="h-3 w-3 shrink-0 text-red-500" aria-label="Error" />
          ) : isStale ? (
            <AlertCircle className="h-3 w-3 shrink-0 text-amber-400" aria-label="Stale" />
          ) : (
            <CheckCircle2 className="h-3 w-3 shrink-0 text-accent" aria-label="Connected" />
          )}
        </div>
        <p
          className={cn(
            "mt-0.5 truncate text-[11px]",
            isError
              ? "text-red-400"
              : isStale
                ? "text-amber-400"
                : !integration.pipelineId
                  ? "text-amber-400"
                  : "text-ink-mute"
          )}
          title={subLabel}
        >
          {subLabel.length > 72 ? subLabel.slice(0, 72) + "…" : subLabel}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {isError ? (
          <button
            type="button"
            onClick={() => onFixConnection(integration)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
              isAuthError
                ? "border-amber-700 bg-amber-950/60 text-amber-200 hover:bg-amber-950/90"
                : "border-red-800/60 bg-red-950/40 text-red-300 hover:bg-red-950/60"
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
            className="inline-flex items-center gap-1 rounded-md border border-line bg-canvas px-2.5 py-1 text-xs font-semibold text-ink transition-colors hover:bg-panel disabled:pointer-events-none disabled:opacity-50"
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
          className="rounded-md px-2 py-1 text-xs font-medium text-ink-mute transition-colors hover:text-red-400 disabled:pointer-events-none disabled:opacity-50"
        >
          {isDisconnecting ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
    </div>
  );
});
