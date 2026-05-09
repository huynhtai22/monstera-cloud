"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, RefreshCw, Wrench, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PrimaryButton, SecondaryButton } from "@/components/ui";

type IntegrationRow = {
  id: string;
  provider?: string;
  catalogId?: string;
  name: string;
  description?: string;
  status: "connected" | "error" | "syncing" | string;
  errorMsg?: string;
  lastSync?: string;
  logoSrc?: string;
  pipelineId?: string;
  accountTags?: string[];
};

type SortKey = "name" | "status" | "lastSync";

function statusRank(row: IntegrationRow): number {
  // Lower is better (connected), higher is worse (error)
  if (row.status === "error") return 3;
  // Stale is rendered by card, but list doesn't know stale precisely; treat "connected" as best.
  if (row.status === "connected") return 1;
  if (row.status === "syncing") return 2;
  return 2;
}

function safeTimeValue(s: string | undefined): number {
  if (!s || s === "Never") return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function canDirectSync(provider: string | undefined): boolean {
  return provider != null && ["meta_ads", "google_ads", "tiktok_business"].includes(provider);
}

export function ConnectedSourceList(props: {
  rows: IntegrationRow[];
  busyActions: Set<string>;
  onSync: (pipelineId: string, integrationId: string) => void;
  onDirectSync: (connectionId: string, provider: string) => void;
  onDisconnect: (connectionId: string, displayName: string) => void;
  onFixConnection: (integration: any) => void;
}) {
  const { rows, busyActions, onSync, onDirectSync, onDisconnect, onFixConnection } = props;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sortedRows = useMemo(() => {
    const mul = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name) * mul;
      if (sortKey === "status") return (statusRank(a) - statusRank(b)) * mul || a.name.localeCompare(b.name);
      if (sortKey === "lastSync") return (safeTimeValue(a.lastSync) - safeTimeValue(b.lastSync)) * mul || a.name.localeCompare(b.name);
      return 0;
    });
  }, [rows, sortKey, sortDir]);

  const allSelected = selectedIds.size > 0 && sortedRows.every((r) => selectedIds.has(r.id));
  const anySelected = selectedIds.size > 0;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(sortedRows.map((r) => r.id)));
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runRowSync = useCallback(
    (r: IntegrationRow) => {
      if (r.pipelineId) {
        onSync(r.pipelineId, r.id);
        return;
      }
      if (canDirectSync(r.provider)) {
        onDirectSync(r.id, r.provider!);
        return;
      }
      toast.error(
        <span>
          No sync pipeline configured. Create a pipeline in the Dashboard.
        </span>
      );
    },
    [onSync, onDirectSync],
  );

  const bulkSync = async () => {
    if (!anySelected) return;
    const selected = sortedRows.filter((r) => selectedIds.has(r.id));
    if (selected.length === 0) return;
    toast.message(`Starting sync for ${selected.length} source${selected.length === 1 ? "" : "s"}…`);
    for (const r of selected) {
      runRowSync(r);
    }
  };

  const bulkDisconnect = async () => {
    if (!anySelected) return;
    const selected = sortedRows.filter((r) => selectedIds.has(r.id));
    if (selected.length === 0) return;
    for (const r of selected) {
      onDisconnect(r.id, r.name);
    }
    setSelectedIds(new Set());
  };

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white/70 shadow-sm backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-950/40">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
          <span className="font-semibold text-gray-700 dark:text-slate-200">Connected sources</span>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {rows.length}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {anySelected && (
            <>
              <PrimaryButton type="button" className="h-9 px-3 text-xs" onClick={bulkSync}>
                <RefreshCw className="h-3.5 w-3.5" /> <span className="ml-1.5">Sync selected</span>
              </PrimaryButton>
              <SecondaryButton type="button" className="h-9 px-3 text-xs" onClick={bulkDisconnect}>
                <X className="h-3.5 w-3.5" /> <span className="ml-1.5">Disconnect</span>
              </SecondaryButton>
            </>
          )}
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900/50">
            <span className="text-gray-500 dark:text-slate-400">Sort</span>
            <select
              className="bg-transparent text-xs font-semibold text-gray-800 outline-none dark:text-slate-200"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              <option value="name">Name</option>
              <option value="status">Status</option>
              <option value="lastSync">Last sync</option>
            </select>
            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              title="Toggle sort direction"
            >
              {sortDir === "asc" ? "↑" : "↓"}
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full text-sm">
          <thead className="bg-gray-50/90 dark:bg-slate-900/70">
            <tr>
              <th className="w-10 px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">Connector</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">Accounts</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-slate-400">Last sync</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-slate-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {sortedRows.map((r) => {
              const isExpanded = expandedId === r.id;
              const syncBusy =
                (r.pipelineId && busyActions.has(`sync:${r.pipelineId}`)) || busyActions.has(`direct-sync:${r.id}`);
              const disconnectBusy = busyActions.has(r.id);
              const isError = r.status === "error";
              return (
                <React.Fragment key={r.id}>
                  <tr className="hover:bg-gray-50/70 dark:hover:bg-slate-900/30">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelectOne(r.id)} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {r.logoSrc ? <img src={r.logoSrc} alt="" width={22} height={22} /> : null}
                        </span>
                        <div className="min-w-0">
                          <Link
                            href={`/sources/${r.id}`}
                            className="block truncate font-semibold text-gray-900 hover:text-cyan-700 dark:text-white dark:hover:text-cyan-300"
                          >
                            {r.name}
                          </Link>
                          <p className="mt-0.5 line-clamp-1 text-xs text-gray-500 dark:text-slate-400">
                            {r.description ?? ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(r.accountTags ?? []).slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          >
                            {t}
                          </span>
                        ))}
                        {(r.accountTags?.length ?? 0) > 3 && (
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            +{(r.accountTags?.length ?? 0) - 3} more
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {isError ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-800 dark:bg-red-950/70 dark:text-red-200">
                          <AlertCircle className="h-3.5 w-3.5" /> Error
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-cyan-950/60 px-2 py-1 text-xs font-semibold text-cyan-300 ring-1 ring-cyan-500/25 dark:bg-cyan-950/60">
                          <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400" /> Connected
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-slate-300">{r.lastSync ?? "Never"}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {isError ? (
                          <button
                            type="button"
                            onClick={() => onFixConnection(r)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
                          >
                            <Wrench className="h-3.5 w-3.5" /> Fix
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={syncBusy}
                            onClick={() => runRowSync(r)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                              syncBusy
                                ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                                : "border-cyan-200 bg-cyan-50 text-cyan-900 hover:bg-cyan-100 dark:border-cyan-800/40 dark:bg-cyan-950/30 dark:text-cyan-200 dark:hover:bg-cyan-950/50",
                            )}
                          >
                            {syncBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            Sync
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={disconnectBusy}
                          onClick={() => onDisconnect(r.id, r.name)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                            disconnectBusy
                              ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                              : "border-red-200 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/50",
                          )}
                        >
                          Disconnect
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-slate-900"
                          onClick={() => setExpandedId((prev) => (prev === r.id ? null : r.id))}
                          title="Toggle details"
                        >
                          <ChevronDown className={cn("h-4 w-4 transition-transform", isExpanded ? "rotate-180" : "")} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-white/60 dark:bg-slate-950/30">
                      <td colSpan={6} className="px-4 pb-4">
                        <div className="mt-3 rounded-xl border border-gray-200/80 bg-white/80 p-4 text-sm dark:border-slate-700/70 dark:bg-slate-950/40">
                          {isError && r.errorMsg ? (
                            <p className="mb-2 text-sm font-medium text-red-700 dark:text-red-300">{r.errorMsg}</p>
                          ) : null}
                          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
                            <Link href={`/sources/${r.id}`} className="font-semibold text-cyan-700 hover:underline dark:text-cyan-300">
                              Open details
                            </Link>
                            <span>·</span>
                            <Link href="/explorer" className="font-semibold text-cyan-700 hover:underline dark:text-cyan-300">
                              View warehouse data
                            </Link>
                            {!r.pipelineId ? (
                              <>
                                <span>·</span>
                                <span className="font-medium text-amber-700 dark:text-amber-300">
                                  No pipeline — sync writes to warehouse (CampaignMetric)
                                </span>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

