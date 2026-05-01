"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  CloudOff,
  Loader2,
  Unplug,
} from "lucide-react";
import { PrimaryButton } from "@/components/ui";

const SYNC_PHRASES = [
  "Fetching campaigns…",
  "Reading impressions…",
  "Pulling spend data…",
  "Loading ROAS metrics…",
  "Writing rows…",
  "Syncing ad accounts…",
  "Processing metrics…",
];

function useSyncPhrase(active: boolean) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!active) { setIdx(0); return; }
    const t = setInterval(() => setIdx((i) => (i + 1) % SYNC_PHRASES.length), 1800);
    return () => clearInterval(t);
  }, [active]);
  return SYNC_PHRASES[idx];
}

export interface ConnectedSourceCardProps {
  integration: any;
  busyActions: Set<string>;
  onSync: (pipelineId: string, integrationId: string) => void;
  onDisconnect: (connectionId: string, displayName: string) => void;
  onFixConnection: (integration: any) => void;
}

export const ConnectedSourceCard = React.memo(function ConnectedSourceCard({
  integration,
  busyActions,
  onSync,
  onDisconnect,
  onFixConnection,
}: ConnectedSourceCardProps) {
  const isSyncing = busyActions.has(`sync:${integration.pipelineId}`);
  const isDisconnecting = busyActions.has(integration.id);
  const isBusy = busyActions.size > 0;
  const isError = integration.status === "error";
  const syncPhrase = useSyncPhrase(isSyncing);

  // Detect token/auth expiry to show better CTA
  const isAuthError =
    isError &&
    /token|expired|auth|unauthorized|401|permission/i.test(
      integration.errorMsg ?? ""
    );

  // Flag if last sync was >48h ago
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

  return (
    <div
      className={`glass-card bento-hover relative overflow-hidden rounded-2xl p-5 group flex flex-col justify-between
        ${isError
          ? "!border !border-red-200/70 hover:!border-red-300/80 dark:!border-red-700/40 dark:hover:!border-red-600/60"
          : isStale
            ? "!border !border-amber-200/70 hover:!border-amber-300/80 dark:!border-amber-700/40 dark:hover:!border-amber-600/60"
            : ""}`}
    >
      {/* Background accent on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/0 to-cyan-500/0 group-hover:from-cyan-400/5 group-hover:to-cyan-500/5 transition-all duration-300 pointer-events-none" />

      <div className="flex items-start justify-between mb-3 relative z-10">
        <div
          className={`relative w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 bg-white/10 dark:bg-slate-900/60 overflow-hidden
            ${isError
              ? "border-red-400/20 dark:border-red-700/30"
              : isStale
                ? "border-amber-400/20 dark:border-amber-700/30"
                : "border-white/10 dark:border-white/10"}`}
        >
          <img
            src={integration.logoSrc}
            alt={`${integration.name} logo`}
            width={28}
            height={28}
            className="object-contain"
            style={{ filter: 'drop-shadow(0 0 8px rgba(0,0,0,0.5))' }}
          />
        </div>

        <div className="flex items-center">
          {isError ? (
            <div className="flex items-center rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-800 dark:bg-red-950/70 dark:text-red-200 dark:ring-1 dark:ring-red-800/50">
              <AlertCircle className="mr-1 h-3.5 w-3.5 dark:text-red-400" />
              Error
            </div>
          ) : isStale ? (
            <div className="flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/70 dark:text-amber-200 dark:ring-1 dark:ring-amber-800/50">
              <AlertCircle className="mr-1 h-3.5 w-3.5 dark:text-amber-400" />
              Stale
            </div>
          ) : (
            <div className="flex items-center rounded-md bg-cyan-950/60 px-2 py-1 text-xs font-semibold text-cyan-300 ring-1 ring-cyan-500/30 shadow-[0_0_10px_rgba(34,211,238,0.4)] dark:bg-cyan-950/60 dark:text-cyan-300 dark:ring-cyan-500/30">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-cyan-400" />
              Connected
            </div>
          )}
        </div>
      </div>

      <div className="mb-5 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Link
            href={`/sources/${integration.id}`}
            onClick={(e) => e.stopPropagation()}
            className="group/title inline-flex max-w-full items-center gap-1 text-base font-semibold tracking-tight text-gray-900 hover:text-cyan-700 dark:text-white dark:hover:text-cyan-300"
          >
            <span className="truncate">{integration.name}</span>
          </Link>
        </div>
        <p className="text-sm leading-relaxed text-gray-500 line-clamp-2 dark:text-slate-300">
          {integration.description}
        </p>

        {isError && (
          <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-2 flex items-start gap-1">
            <CloudOff className="w-3 h-3 shrink-0 mt-0.5" />
            <span className="line-clamp-2">
              {integration.errorMsg ||
                "Connection issue. Try Fix Connection or disconnect and add this source again."}
            </span>
          </p>
        )}

        {!isError && (
          <>
            <p className="mt-2 text-xs font-medium text-gray-500 dark:text-slate-300">
              Last synced:{" "}
              <span
                className={
                  isStale
                    ? "text-amber-500 dark:text-amber-400 font-semibold"
                    : "text-gray-600 dark:text-slate-200"
                }
              >
                {integration.lastSync}
              </span>
            </p>
          </>
        )}

        {integration.accountTags && integration.accountTags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {(integration.accountTags as string[]).slice(0, 3).map((tag: string) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700/80 dark:text-slate-300"
              >
                {tag}
              </span>
            ))}
            {integration.accountTags.length > 3 && (
              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700/80 dark:text-slate-400">
                +{integration.accountTags.length - 3} more
              </span>
            )}
          </div>
        )}

        {!isError && !integration.pipelineId ? (
          <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300/90 flex items-start gap-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            No pipeline yet — add a destination to enable sync.
          </p>
        ) : null}
      </div>

      <div className="relative z-10">
        {isError ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFixConnection(integration);
            }}
            className="w-full rounded-lg border border-red-300 bg-red-50 py-2.5 text-sm font-semibold text-red-800 shadow-sm transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 dark:hover:bg-red-950/90"
          >
            {isAuthError ? "Reconnect" : "Fix Connection"}
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <PrimaryButton
              onClick={(e) => {
                e.stopPropagation();
                if (!integration.pipelineId) {
                  toast.error(
                    <span>
                      Add a destination (like Google Sheets) to start syncing.{" "}
                      <a href="/destinations" className="underline font-medium">
                        Open Destinations
                      </a>
                    </span>
                  );
                  return;
                }
                onSync(integration.pipelineId, integration.id);
              }}
              className="w-full"
              disabled={isSyncing || isBusy}
              loading={isSyncing}
            >
              {isSyncing ? syncPhrase : "Sync Now"}
            </PrimaryButton>
            <button
              type="button"
              disabled={isBusy}
              onClick={(e) => {
                e.stopPropagation();
                onDisconnect(integration.id, integration.name);
              }}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-300/90 bg-red-50/90 py-2.5 text-sm font-medium text-red-800 transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200 dark:hover:bg-red-950/80 disabled:pointer-events-none disabled:opacity-50"
            >
              {isDisconnecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Disconnecting…
                </>
              ) : (
                <>
                  <Unplug className="h-4 w-4" />
                  Disconnect
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
