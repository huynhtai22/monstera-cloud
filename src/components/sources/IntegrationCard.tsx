"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CloudOff,
  Loader2,
  Unplug,
} from "lucide-react";
import { PrimaryButton, IntegrationMark } from "@/components/ui";

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

export function IntegrationCardSkeleton() {
  return (
    <div
      className="relative overflow-hidden rounded-lg border border-line bg-panel p-5 animate-pulse"
      aria-hidden
    >
      <div className="flex items-start justify-between mb-4">
        <div className="h-12 w-12 rounded-xl bg-gray-200/90 dark:bg-[#1d1f23]/90" />
        <div className="h-6 w-24 rounded-md bg-gray-200/80 dark:bg-[#1d1f23]/80" />
      </div>
      <div className="mb-6 space-y-2">
        <div className="h-4 max-w-[10rem] rounded bg-gray-200/90 dark:bg-[#1d1f23]/90" />
        <div className="h-3 w-full rounded bg-gray-100 dark:bg-[#16181c]/90" />
        <div className="h-3 max-w-[14rem] w-[92%] rounded bg-gray-100 dark:bg-[#16181c]/90" />
      </div>
      <div className="h-9 w-full rounded-lg bg-gray-200/80 dark:bg-[#1d1f23]/80" />
    </div>
  );
}

export interface IntegrationCardProps {
  integration: any;
  busyActions: Set<string>;
  onSync: (pipelineId: string, integrationId: string) => void;
  onDisconnect: (connectionId: string, displayName: string) => void;
  onFixConnection: (integration: any) => void;
  onConnect: (integration: any) => void;
}

export const IntegrationCard = React.memo(function IntegrationCard({
  integration,
  busyActions,
  onSync,
  onDisconnect,
  onFixConnection,
  onConnect,
}: IntegrationCardProps) {
  const isSyncing = busyActions.has(`sync:${integration.pipelineId}`);
  const isDisconnecting = busyActions.has(integration.id);
  const isBusy = busyActions.size > 0;
  const syncPhrase = useSyncPhrase(isSyncing);

  return (
    <div
      className={`glass-card governed-hover relative overflow-hidden rounded-lg p-5 group flex flex-col justify-between
        ${integration.status === "error"
          ? "!border-red-500/40 hover:!border-red-400/60"
          : ""}`}
    >
      <div className="flex items-start justify-between mb-3 relative z-10">
        <IntegrationMark src={integration.logoSrc} alt={`${integration.name} logo`} size="lg" />

        <div className="flex items-center">
          {integration.status === "connected" && (
            <div className="flex items-center rounded border border-line px-2 py-1 text-[11px] font-medium text-accent">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" strokeWidth={1.5} />
              Connected
            </div>
          )}
          {integration.status === "syncing" && (
            <div className="flex items-center rounded-md border border-line px-2 py-1 text-xs font-medium text-ink">
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin dark:text-blue-300" />
              Syncing
            </div>
          )}
          {integration.status === "error" && (
            <div className="flex items-center rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-800 dark:bg-red-950/70 dark:text-red-200 dark:ring-1 dark:ring-red-800/50">
              <AlertCircle className="mr-1 h-3.5 w-3.5 dark:text-red-400" />
              Error
            </div>
          )}
        </div>
      </div>

      <div className="mb-5 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          {integration.status !== "available" ? (
            <Link
              href={`/sources/${integration.id}`}
              onClick={(e) => e.stopPropagation()}
              className="group/title inline-flex max-w-full items-center gap-1 text-base font-semibold tracking-tight text-ink hover:text-white"
            >
              <span className="truncate">{integration.name}</span>
            </Link>
          ) : (
            <h3 className="text-base font-semibold tracking-tight text-ink">
              {integration.name}
            </h3>
          )}
        </div>
        <p className="text-sm leading-relaxed text-ink-mute line-clamp-2">
          {integration.description}
        </p>

        {integration.status === "error" && (
          <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-2 flex items-start gap-1">
            <CloudOff className="w-3 h-3 mr-1 shrink-0 mt-0.5" />
            <span>
              {integration.errorMsg ||
                "Connection issue. Try Fix Connection or disconnect and add this source again."}
            </span>
          </p>
        )}
        {integration.status !== "available" &&
          integration.status !== "error" && (
            <p className="mt-2 text-xs font-medium text-gray-500 dark:text-slate-300">
              Last synced: {integration.lastSync}
            </p>
          )}
        {integration.accountTags && integration.accountTags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {(integration.accountTags as string[]).slice(0, 3).map((tag: string) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-[#1d1f23]/80 dark:text-slate-300"
              >
                {tag}
              </span>
            ))}
            {integration.accountTags.length > 3 && (
              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-[#1d1f23]/80 dark:text-slate-400">
                +{integration.accountTags.length - 3} more
              </span>
            )}
          </div>
        )}
        {integration.status === "connected" && !integration.pipelineId ? (
          <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300/90">
            No pipeline yet — create a pipeline to enable sync.
          </p>
        ) : null}
      </div>

      <div className="relative z-10">
        {integration.status === "error" ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFixConnection(integration);
            }}
            className="w-full rounded-lg border border-red-300 bg-red-50 py-2 text-sm font-semibold text-red-800 shadow-sm transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 dark:hover:bg-red-950/90"
          >
            Fix Connection
          </button>
        ) : integration.status === "syncing" ? (
          <button
            disabled
            className="flex w-full cursor-not-allowed items-center justify-center rounded-lg border border-slate-200 bg-slate-100 py-2 text-sm font-semibold text-slate-500 dark:border-[#2f3336] dark:bg-[#16181c]/80 dark:text-slate-400"
          >
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> {syncPhrase}
          </button>
        ) : integration.status === "connected" ? (
          <div className="flex flex-col gap-2">
            <PrimaryButton
              onClick={(e) => {
                e.stopPropagation();
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
              className="w-full"
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
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-300/90 bg-red-50/90 py-2 text-sm font-medium text-red-800 transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200 dark:hover:bg-red-950/80 disabled:pointer-events-none disabled:opacity-50"
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
        ) : integration.status === "available" &&
          integration.envConnectReady === false ? (
          <div className="space-y-2">
            <button
              type="button"
              disabled
              className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 py-2 text-sm font-semibold text-slate-500 dark:border-[#2f3336] dark:bg-[#16181c]/80 dark:text-slate-400"
            >
              Connect unavailable
            </button>
            <p className="text-center text-xs leading-snug text-slate-500 dark:text-slate-400">
              OAuth for this connector is not enabled on this deployment
              (missing server env vars). With credentials set, Connect uses the
              standard OAuth flow.
            </p>
          </div>
        ) : (
          <PrimaryButton
            onClick={(e) => {
              e.stopPropagation();
              onConnect(integration);
            }}
            className="w-full"
          >
            Connect <ArrowRight className="h-3.5 w-3.5" />
          </PrimaryButton>
        )}
      </div>
    </div>
  );
});
