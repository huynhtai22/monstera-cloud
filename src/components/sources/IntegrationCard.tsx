"use client";

import React from "react";
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
import { PrimaryButton } from "@/components/ui";

export function IntegrationCardSkeleton() {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/80 dark:border-slate-600/50 bg-white/40 dark:bg-slate-800/60 p-5 animate-pulse"
      aria-hidden
    >
      <div className="flex items-start justify-between mb-4">
        <div className="h-12 w-12 rounded-xl bg-gray-200/90 dark:bg-slate-700/90" />
        <div className="h-6 w-24 rounded-md bg-gray-200/80 dark:bg-slate-700/80" />
      </div>
      <div className="mb-6 space-y-2">
        <div className="h-4 max-w-[10rem] rounded bg-gray-200/90 dark:bg-slate-700/90" />
        <div className="h-3 w-full rounded bg-gray-100 dark:bg-slate-800/90" />
        <div className="h-3 max-w-[14rem] w-[92%] rounded bg-gray-100 dark:bg-slate-800/90" />
      </div>
      <div className="h-9 w-full rounded-lg bg-gray-200/80 dark:bg-slate-700/80" />
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

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-5 transition-all duration-200 group flex flex-col justify-between bg-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 hover:bg-white/80 dark:bg-slate-800/90 dark:shadow-[0_12px_40px_rgba(0,0,0,0.35)] dark:hover:bg-slate-800 dark:ring-1 dark:ring-white/5
        ${integration.status === "error"
          ? "border-red-200/80 hover:border-red-300 dark:border-red-800/70 dark:hover:border-red-700"
          : integration.status === "available"
            ? "border-cyan-200/80 bg-cyan-50/30 dark:border-cyan-700/50 dark:bg-cyan-950/20 hover:border-cyan-300 dark:hover:border-cyan-600"
            : "border-gray-200/80 dark:border-slate-600/80 hover:border-cyan-200/80 dark:hover:border-cyan-600/50"}`}
    >
      <div className="flex items-start justify-between mb-3 relative z-10">
        <div
          className={`relative w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 transition-colors bg-white/70 dark:bg-slate-900/80 overflow-hidden
            ${integration.status === "connected" ? "border-cyan-100/50 dark:border-cyan-700/40" :
              integration.status === "syncing" ? "border-blue-100/50 dark:border-blue-700/40" :
                integration.status === "error" ? "border-red-100/50 dark:border-red-800/50" :
                  "border-cyan-100/50 dark:border-cyan-700/40"}`}
        >
          <img
            src={integration.logoSrc}
            alt={`${integration.name} logo`}
            width={28}
            height={28}
            className="object-contain"
          />
        </div>

        <div className="flex items-center">
          {integration.status === "connected" && (
            <div className="flex items-center rounded-md bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-800 dark:bg-emerald-950/70 dark:text-emerald-300 dark:ring-1 dark:ring-emerald-800/50">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5 dark:text-emerald-400" />
              Connected
            </div>
          )}
          {integration.status === "syncing" && (
            <div className="flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-950/70 dark:text-blue-200 dark:ring-1 dark:ring-blue-800/50">
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
              className="group/title inline-flex max-w-full items-center gap-1 text-base font-semibold tracking-tight text-gray-900 hover:text-cyan-700 dark:text-white dark:hover:text-cyan-300"
            >
              <span className="truncate">{integration.name}</span>
            </Link>
          ) : (
            <h3 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">
              {integration.name}
            </h3>
          )}
        </div>
        <p className="text-sm leading-relaxed text-gray-600 line-clamp-2 dark:text-slate-300">
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
            <p className="mt-2 text-xs font-medium text-gray-500 dark:text-slate-400">
              Last synced: {integration.lastSync}
            </p>
          )}
        {integration.accountTags && integration.accountTags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
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
        {integration.status === "connected" && !integration.pipelineId ? (
          <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300/90">
            No pipeline yet — connect a destination to enable sync.
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
            className="flex w-full cursor-not-allowed items-center justify-center rounded-lg border border-slate-200 bg-slate-100 py-2 text-sm font-semibold text-slate-500 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-400"
          >
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Syncing...
          </button>
        ) : integration.status === "connected" ? (
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
              loading={isSyncing}
            >
              {isSyncing ? "Syncing…" : "Sync Now"}
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
              className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 py-2 text-sm font-semibold text-slate-500 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-400"
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
