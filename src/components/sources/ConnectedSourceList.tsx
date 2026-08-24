"use client";

import React, { useCallback, useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, RefreshCw, Wrench, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PrimaryButton, SecondaryButton, IntegrationMark } from "@/components/ui";

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

type SourceStateKind = "connected" | "not-synced" | "syncing" | "partial" | "attention";

type SourceState = {
  kind: SourceStateKind;
  label: string;
  detail: string;
};

function sourceStateFor(row: IntegrationRow, syncBusy: boolean): SourceState {
  if (syncBusy || row.status === "syncing") {
    return { kind: "syncing", label: "Syncing", detail: "A warehouse sync is currently running." };
  }
  if (row.status === "error") {
    return { kind: "attention", label: "Needs attention", detail: "Authorization or connection setup needs attention." };
  }
  if (row.status === "partial") {
    return { kind: "partial", label: "Partial sync", detail: "Some requested data was imported; review and retry the affected source." };
  }
  if (!row.lastSync || row.lastSync === "Never") {
    return { kind: "not-synced", label: "Connected — not synced", detail: "Authorization is ready, but no successful warehouse sync is recorded yet." };
  }
  return { kind: "connected", label: "Connected", detail: "Authorized and has at least one successful sync." };
}

function statusRank(row: IntegrationRow): number {
  // Lower is better (connected), higher is worse (needs attention).
  if (row.status === "error") return 5;
  if (row.status === "partial") return 4;
  if (row.status === "syncing") return 3;
  if (!row.lastSync || row.lastSync === "Never") return 2;
  if (row.status === "connected") return 1;
  return 3;
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
  onDirectSync: (connectionId: string) => void;
  onDisconnect: (connectionId: string, displayName: string) => void;
  onFixConnection: (integration: any) => void;
}) {
  const { rows, busyActions, onSync, onDirectSync, onDisconnect, onFixConnection } = props;
  const router = useRouter();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [openTagsId, setOpenTagsId] = useState<string | null>(null);

  useEffect(() => {
    if (!openTagsId) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-no-row-click]')) setOpenTagsId(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openTagsId]);

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
        onDirectSync(r.id);
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
    <div className="rounded-lg border border-line bg-panel">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-mute">
          <span className="text-xs font-semibold text-ink-mute uppercase tracking-[0.1em]">Connected sources</span>
          <span className="rounded-md border border-line px-2 py-0.5 font-mono text-[11px] text-ink">
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
          <div className="flex items-center gap-2 rounded-md border border-line bg-canvas px-2 py-1.5 text-xs">
            <span className="text-ink-mute">Sort</span>
            <select
              className="bg-transparent text-xs font-medium text-ink outline-none"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              <option value="name">Name</option>
              <option value="status">Status</option>
              <option value="lastSync">Last sync</option>
            </select>
            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 text-ink-mute hover:text-ink hover:bg-white/[0.04] transition-colors"
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
          <thead className="bg-canvas/80">
            <tr>
              <th className="w-10 px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.1em] text-ink-mute">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} data-no-row-click />
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.1em] text-ink-mute">Connector</th>
              <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.1em] text-ink-mute">Accounts</th>
              <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.1em] text-ink-mute">Status</th>
              <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.1em] text-ink-mute">Last sync</th>
              <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.1em] text-ink-mute">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sortedRows.map((r) => {
              const isExpanded = expandedId === r.id;
              const syncBusy =
                (r.pipelineId && busyActions.has(`sync:${r.pipelineId}`)) || busyActions.has(`direct-sync:${r.id}`);
              const disconnectBusy = busyActions.has(r.id);
              const isError = r.status === "error";
              const sourceState = sourceStateFor(r, syncBusy);
              const syncActionLabel = sourceState.kind === "partial"
                ? "Retry sync"
                : sourceState.kind === "not-synced"
                  ? "Run first sync"
                  : sourceState.kind === "syncing"
                    ? "Syncing"
                    : "Sync";
              return (
                <React.Fragment key={r.id}>
                  <tr 
                    className="cursor-pointer hover:bg-white/[0.03] transition-colors duration-150"
                    onClick={(e) => {
                      if (!(e.target as HTMLElement).closest('[data-no-row-click]')) {
                        router.push(`/sources/${r.id}`);
                      }
                    }}
                  >
                    <td className="px-4 py-3" data-no-row-click>
                      <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelectOne(r.id)} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        {r.logoSrc ? <IntegrationMark src={r.logoSrc} size="md" /> : null}
                        <div className="min-w-0">
                          <Link
                            href={`/sources/${r.id}`}
                            className="block truncate font-semibold text-ink hover:text-white"
                            data-no-row-click
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
                            className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-[#16181c] dark:text-slate-300"
                          >
                            {t}
                          </span>
                        ))}
                        {(r.accountTags?.length ?? 0) > 3 && (
                          <div className="relative" data-no-row-click>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setOpenTagsId(prev => prev === r.id ? null : r.id); }}
                              className="inline-flex items-center rounded-md bg-[#16181c] px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-[#1d2025] hover:text-white transition-colors duration-150 cursor-pointer border border-line"
                            >
                              +{(r.accountTags?.length ?? 0) - 3} more
                            </button>
                            {openTagsId === r.id && (
                              <div className="absolute left-0 top-full z-50 mt-1 min-w-[10rem] rounded-md border border-line bg-panel shadow-elevated p-2 space-y-1">
                                {(r.accountTags ?? []).slice(3).map((t) => (
                                  <div key={t} className="px-2 py-1 rounded text-[11px] text-ink font-medium bg-canvas">{t}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold",
                            sourceState.kind === "attention"
                              ? "bg-red-50 text-red-800 dark:bg-red-950/70 dark:text-red-200"
                              : sourceState.kind === "partial" || sourceState.kind === "not-synced"
                                ? "bg-amber-50 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200"
                                : sourceState.kind === "syncing"
                                  ? "bg-blue-50 text-blue-800 dark:bg-blue-950/70 dark:text-blue-200"
                                  : "border border-line text-ink",
                          )}
                        >
                          {sourceState.kind === "attention" || sourceState.kind === "partial" || sourceState.kind === "not-synced" ? (
                            <AlertCircle className="h-3.5 w-3.5" />
                          ) : sourceState.kind === "syncing" ? (
                            <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin motion-reduce:animate-none" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                          )}
                          {sourceState.label}
                        </span>
                        <p className="mt-1 max-w-[15rem] text-[11px] leading-snug text-ink-mute">{sourceState.detail}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-slate-300">
                      <p>{r.lastSync ?? "Never"}</p>
                      {sourceState.kind === "not-synced" && (
                        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">No successful sync recorded</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {isError ? (
                          <button
                            type="button"
                            onClick={() => onFixConnection(r)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
                            data-no-row-click
                          >
                            <Wrench className="h-3.5 w-3.5" /> Reconnect
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={syncBusy}
                            onClick={() => runRowSync(r)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                              syncBusy
                                ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-500 dark:border-[#2f3336] dark:bg-[#16181c] dark:text-slate-400"
                                : "border-line bg-canvas text-ink hover:bg-white/[0.04]",
                            )}
                            data-no-row-click
                          >
                            {syncBusy ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            {syncActionLabel}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={disconnectBusy}
                          onClick={() => onDisconnect(r.id, r.name)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                            disconnectBusy
                              ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-500 dark:border-[#2f3336] dark:bg-[#16181c] dark:text-slate-400"
                              : "border-red-200 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/50",
                          )}
                          data-no-row-click
                        >
                          Disconnect
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 dark:border-[#2f3336] dark:bg-[#000000]/40 dark:text-slate-200 dark:hover:bg-[#000000]"
                          onClick={() => setExpandedId((prev) => (prev === r.id ? null : r.id))}
                          title="Toggle details"
                          data-no-row-click
                        >
                          <ChevronDown className={cn("h-4 w-4 transition-transform", isExpanded ? "rotate-180" : "")} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-canvas/40">
                      <td colSpan={6} className="px-4 pb-4">
                        <div className="mt-3 rounded-xl border border-line bg-canvas p-4 text-sm">
                          {(sourceState.kind === "attention" || sourceState.kind === "partial") && r.errorMsg ? (
                            <p className="mb-2 text-sm font-medium text-red-700 dark:text-red-300">{r.errorMsg}</p>
                          ) : null}
                          <p className="mb-2 text-xs text-ink-mute">{sourceState.detail}</p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-mute">
                            <Link href={`/sources/${r.id}`} className="font-semibold text-white hover:text-neutral-300">
                              Open details
                            </Link>
                            <span>·</span>
                            <Link href="/explorer" className="font-semibold text-white hover:text-neutral-300">
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
