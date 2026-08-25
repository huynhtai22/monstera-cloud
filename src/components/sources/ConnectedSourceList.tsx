"use client";

import React, { useCallback, useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ChevronDown, Clock, Loader2, Pencil, RefreshCw, Search, Wrench, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PrimaryButton, SecondaryButton, IntegrationMark } from "@/components/ui";
import { CopyableBadge } from "@/components/ui/CopyableBadge";
import { AccountSelector } from "@/components/sources/AccountSelector";
import type { SourceHealthState } from "@/lib/source-health";

export type AccountTagEntry = { id: string; label: string } | string;

type IntegrationRow = {
  id: string;
  provider?: string;
  catalogId?: string;
  name: string;
  description?: string;
  managerBadge?: string | null;
  shortId?: string;
  status: "connected" | "error" | "syncing" | string;
  healthState?: SourceHealthState;
  errorMsg?: string;
  lastSync?: string;
  dataThroughDate?: string | null;
  logoSrc?: string;
  pipelineId?: string;
  accountTags?: AccountTagEntry[];
};

type SortKey = "name" | "status" | "lastSync";

type SourceStateKind = "connected" | "not-synced" | "syncing" | "partial" | "attention";

type SourceState = {
  kind: SourceStateKind;
  label: string;
  detail: string;
};

interface ConnectedSourceListProps {
  rows: IntegrationRow[];
  busyActions: Set<string>;
  onSync: (pipelineId: string, integrationId: string) => void;
  onDirectSync: (connectionId: string, provider: string) => void;
  onDisconnect: (connectionId: string, displayName: string) => void;
  onFixConnection: (integration: any) => void;
  onRenameConnection?: (connectionId: string, newName: string) => Promise<void> | void;
}

function sourceStateFor(row: IntegrationRow, syncBusy: boolean): SourceState {
  if (syncBusy || row.healthState === "syncing" || row.status === "syncing") {
    return { kind: "syncing", label: "Syncing", detail: "A warehouse sync is currently running." };
  }
  const state = row.healthState ?? row.status;
  if (state === "partial") {
    return { kind: "partial", label: "Partial sync", detail: "Some requested data was imported; review and retry the affected source." };
  }
  if (state === "pending") {
    return { kind: "not-synced", label: "Connected — not synced", detail: "Authorization is ready, but no successful warehouse sync is recorded yet." };
  }
  if (state === "stale") {
    return { kind: "attention", label: "Data stale", detail: "The last successful sync is older than the one-day freshness threshold." };
  }
  if (state === "unknown") {
    return { kind: "attention", label: "State needs review", detail: "This source has an unrecognized state and is not treated as healthy." };
  }
  if (state === "error" || state === "disconnected") {
    return { kind: "attention", label: "Needs attention", detail: "Authorization or connection setup needs attention." };
  }
  if (!row.lastSync || row.lastSync === "Never") {
    return { kind: "not-synced", label: "Connected — not synced", detail: "Authorization is ready, but no successful warehouse sync is recorded yet." };
  }
  return { kind: "connected", label: "Connected", detail: "Authorized and has at least one successful sync." };
}

function statusRank(row: IntegrationRow): number {
  const s = sourceStateFor(row, false);
  if (s.kind === "attention") return 0;
  if (s.kind === "partial") return 1;
  if (s.kind === "not-synced") return 2;
  if (s.kind === "syncing") return 3;
  return 4;
}

function safeTimeValue(dateStr?: string): number {
  if (!dateStr || dateStr === "Never") return 0;
  const t = new Date(dateStr).getTime();
  return Number.isFinite(t) ? t : 0;
}

function canDirectSync(provider: string | undefined): boolean {
  return provider != null && ["meta_ads", "google_ads", "tiktok_business", "shopee", "lazada"].includes(provider);
}

const PROVIDER_LABELS: Record<string, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  tiktok_business: "TikTok Ads",
  shopee: "Shopee",
  shopify: "Shopify",
};

export function ConnectedSourceList({
  rows,
  busyActions,
  onSync,
  onDirectSync,
  onDisconnect,
  onFixConnection,
  onRenameConnection,
}: ConnectedSourceListProps) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openTagsId, setOpenTagsId] = useState<string | null>(null);
  const [renamingRow, setRenamingRow] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");

  useEffect(() => {
    const close = () => setOpenTagsId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openTagsId]);

  const availablePlatforms = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (r.provider) {
        counts[r.provider] = (counts[r.provider] || 0) + 1;
      }
    }
    return Object.entries(counts).map(([id, count]) => ({
      id,
      label: PROVIDER_LABELS[id] || id,
      count,
    }));
  }, [rows]);

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingRow || !renameValue.trim()) return;
    setRenameBusy(true);
    try {
      if (onRenameConnection) {
        await onRenameConnection(renamingRow.id, renameValue.trim());
      } else {
        const res = await fetch(`/api/connections/${renamingRow.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: renameValue.trim() }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to rename connection");
        }
        toast.success(`Connection renamed to "${renameValue.trim()}"`);
        await Promise.all([
          mutate((key: unknown) => typeof key === "string" && key.includes("/api/workspaces")),
          mutate((key: unknown) => typeof key === "string" && key.includes("/api/connections")),
        ]);
        router.refresh();
      }
      setRenamingRow(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to rename connection");
    } finally {
      setRenameBusy(false);
    }
  };

  const allSelected = rows.length > 0 && selectedIds.size === rows.length;
  const anySelected = selectedIds.size > 0;

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(rows.map((r) => r.id)));
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredAndSortedRows = useMemo(() => {
    const list = rows.filter((r) => {
      if (selectedPlatform !== "all" && r.provider !== selectedPlatform) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const nameMatch = (r.name || "").toLowerCase().includes(q);
        const badgeMatch = (r.managerBadge || "").toLowerCase().includes(q);
        const descMatch = (r.description || "").toLowerCase().includes(q);
        const idMatch = (r.id || "").toLowerCase().includes(q) || (r.shortId || "").toLowerCase().includes(q);
        const tagMatch = (r.accountTags || []).some((t) =>
          (typeof t === "object" ? `${t.id} ${t.label}` : t).toLowerCase().includes(q)
        );
        return nameMatch || badgeMatch || descMatch || idMatch || tagMatch;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sortKey === "name") {
        const cmp = (a.name || "").localeCompare(b.name || "");
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "status") {
        const diff = statusRank(a) - statusRank(b);
        return sortDir === "asc" ? diff : -diff;
      }
      if (sortKey === "lastSync") {
        const diff = safeTimeValue(a.lastSync) - safeTimeValue(b.lastSync);
        return sortDir === "asc" ? diff : -diff;
      }
      return 0;
    });
    return list;
  }, [rows, selectedPlatform, searchQuery, sortKey, sortDir]);

  const bulkSync = () => {
    for (const r of rows) {
      if (!selectedIds.has(r.id)) continue;
      if (r.pipelineId) {
        onSync(r.pipelineId, r.id);
      } else if (canDirectSync(r.provider)) {
        onDirectSync(r.id, r.provider!);
      } else {
        toast.error(`No sync pipeline configured for ${r.name}.`);
      }
    }
  };

  const bulkDisconnect = () => {
    for (const r of rows) {
      if (!selectedIds.has(r.id)) continue;
      onDisconnect(r.id, r.name);
    }
  };

  const runRowSync = (r: IntegrationRow) => {
    if (r.pipelineId) {
      onSync(r.pipelineId, r.id);
    } else if (canDirectSync(r.provider)) {
      onDirectSync(r.id, r.provider!);
    } else {
      toast.error(`No sync pipeline configured for ${r.name}.`);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-panel shadow-xs overflow-hidden">
      {/* Header & Controls */}
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:p-5 bg-panel/70">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 text-xs text-ink-mute">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-mute">Connected sources</span>
            <span className="rounded-md border border-line/80 bg-canvas px-2 py-0.5 font-mono text-[11px] text-ink">
              {filteredAndSortedRows.length}{filteredAndSortedRows.length !== rows.length ? ` of ${rows.length}` : ""}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {anySelected && (
              <>
                <PrimaryButton type="button" className="h-8 px-3 text-xs" onClick={bulkSync}>
                  <RefreshCw className="h-3.5 w-3.5" /> <span className="ml-1.5">Sync selected</span>
                </PrimaryButton>
                <SecondaryButton type="button" className="h-8 px-3 text-xs" onClick={bulkDisconnect}>
                  <X className="h-3.5 w-3.5" /> <span className="ml-1.5">Disconnect</span>
                </SecondaryButton>
              </>
            )}

            <div className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-1 text-xs">
              <span className="text-ink-mute">Sort:</span>
              <select
                className="bg-transparent text-xs font-medium text-ink outline-none cursor-pointer"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
              >
                <option value="name" className="bg-panel text-ink">Name</option>
                <option value="status" className="bg-panel text-ink">Status</option>
                <option value="lastSync" className="bg-panel text-ink">Last sync</option>
              </select>
              <button
                type="button"
                className="rounded px-1 py-0.5 text-ink-mute hover:text-ink hover:bg-white/[0.06] transition-colors"
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                title="Toggle sort direction"
              >
                {sortDir === "asc" ? "↑" : "↓"}
              </button>
            </div>
          </div>
        </div>

        {/* Real-time Search & Platform Tabs for 20+ MCCs/BMs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-line/50">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by MCC, account ID, or name…"
              className="h-8.5 w-full rounded-lg border border-line bg-canvas pl-8.5 pr-8 text-xs text-ink placeholder:text-ink-mute focus:border-white/30 focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-mute hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {availablePlatforms.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedPlatform("all")}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                  selectedPlatform === "all"
                    ? "bg-white text-black font-semibold shadow-xs"
                    : "border border-line/80 bg-canvas text-ink-mute hover:text-ink hover:bg-white/[0.04]"
                )}
              >
                All ({rows.length})
              </button>
              {availablePlatforms.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPlatform(p.id)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                    selectedPlatform === p.id
                      ? "bg-white text-black font-semibold shadow-xs"
                      : "border border-line/80 bg-canvas text-ink-mute hover:text-ink hover:bg-white/[0.04]"
                  )}
                >
                  {p.label} ({p.count})
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[960px] w-full text-sm">
          <colgroup>
            <col className="w-12" />
            <col className="w-[320px]" />
            <col className="w-[240px]" />
            <col className="w-[140px]" />
            <col className="w-[180px]" />
            <col className="w-[160px]" />
          </colgroup>
          <thead className="bg-panel/40 border-b border-line">
            <tr>
              <th className="w-12 px-5 py-3.5 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-ink-mute">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} data-no-row-click />
              </th>
              <th className="px-5 py-3.5 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-ink-mute">Connector</th>
              <th className="px-5 py-3.5 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-ink-mute">Accounts</th>
              <th className="px-5 py-3.5 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-ink-mute">Status</th>
              <th className="px-5 py-3.5 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-ink-mute">Last sync</th>
              <th className="px-5 py-3.5 text-right text-[11px] font-mono font-medium uppercase tracking-wider text-ink-mute">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filteredAndSortedRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-xs text-ink-mute">
                  <p className="font-medium text-ink text-sm">No connections found</p>
                  <p className="mt-1 text-ink-mute">
                    {searchQuery ? `No sources match "${searchQuery}".` : "No sources match the selected filter."}
                  </p>
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="mt-3 inline-flex items-center rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/[0.05] transition-colors cursor-pointer"
                    >
                      Clear search
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              filteredAndSortedRows.map((r) => {
                const isExpanded = expandedId === r.id;
                const syncBusy =
                  (r.pipelineId && busyActions.has(`sync:${r.pipelineId}`)) || busyActions.has(`direct-sync:${r.id}`);
                const disconnectBusy = busyActions.has(r.id);
                const sourceState = sourceStateFor(r, syncBusy);
                const needsReconnect = ["error", "disconnected"].includes(r.healthState ?? r.status);
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
                      className="cursor-pointer hover:bg-white/[0.025] transition-colors duration-150"
                      onClick={(e) => {
                        if (!(e.target as HTMLElement).closest('[data-no-row-click]')) {
                          router.push(`/sources/${r.id}`);
                        }
                      }}
                    >
                      <td className="px-5 py-4" data-no-row-click>
                        <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelectOne(r.id)} />
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3.5">
                          {r.logoSrc ? <IntegrationMark src={r.logoSrc} size="md" className="shrink-0" /> : null}
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-1.5 group/name">
                              <Link
                                href={`/sources/${r.id}`}
                                className="truncate text-sm font-semibold tracking-tight text-ink hover:text-white transition-colors"
                                data-no-row-click
                              >
                                {r.name}
                              </Link>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenamingRow({ id: r.id, name: r.name });
                                  setRenameValue(r.name);
                                }}
                                className="opacity-0 group-hover/name:opacity-100 p-0.5 text-ink-mute hover:text-ink transition-opacity rounded cursor-pointer shrink-0"
                                title="Rename connection / add nickname"
                                data-no-row-click
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-mute">
                              {r.managerBadge && (
                                <CopyableBadge
                                  text={r.managerBadge}
                                  copyValue={r.managerBadge.replace(/^\[|\]$/g, "").replace(/^(MCC|BM|BC):\s*/, "")}
                                  title={`Click to copy ${r.managerBadge}`}
                                  className="text-[10px] text-ink-mute border-line/70 bg-canvas"
                                />
                              )}
                              {r.shortId && (
                                <CopyableBadge
                                  text={`#${r.shortId}`}
                                  copyValue={r.id}
                                  title={`Click to copy full Connection ID (${r.id})`}
                                  className="text-[10px] text-ink-mute/70 border-line/40 bg-transparent hover:bg-canvas"
                                />
                              )}
                              {r.description && (
                                <span className="truncate text-[11px] text-ink-mute/80">
                                  {r.description}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-1.5 max-w-[240px]">
                        {(r.accountTags ?? []).slice(0, 3).map((item, idx) => {
                          const label = typeof item === "object" ? item.label : item;
                          const copyVal = typeof item === "object" ? item.id : item;
                          return (
                            <CopyableBadge
                              key={`${copyVal}-${idx}`}
                              text={label}
                              copyValue={copyVal}
                              title={`Click to copy account ID "${copyVal}"`}
                              className="text-[11px] text-ink-mute font-mono"
                            />
                          );
                        })}
                        {(r.accountTags?.length ?? 0) > 3 && (
                          <div className="relative shrink-0" data-no-row-click>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setOpenTagsId(prev => prev === r.id ? null : r.id); }}
                              className="inline-flex items-center rounded-md border border-line bg-panel px-2 py-0.5 font-mono text-[11px] font-medium text-ink-mute hover:bg-white/[0.06] hover:text-white transition-colors duration-150 cursor-pointer"
                            >
                              +{(r.accountTags?.length ?? 0) - 3} more
                            </button>
                            {openTagsId === r.id && (
                              <div className="absolute left-0 top-full z-50 mt-1.5 min-w-[14rem] max-h-60 overflow-y-auto rounded-xl border border-line bg-panel shadow-elevated p-2 space-y-1.5">
                                <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-ink-mute border-b border-line/50">
                                  Scoped Accounts ({(r.accountTags?.length ?? 0)})
                                </div>
                                {(r.accountTags ?? []).slice(3).map((item, idx) => {
                                  const label = typeof item === "object" ? item.label : item;
                                  const copyVal = typeof item === "object" ? item.id : item;
                                  return (
                                    <div key={`${copyVal}-${idx}`} className="px-2.5 py-1.5 rounded-lg text-xs font-mono text-ink font-medium bg-canvas border border-line/60 truncate flex items-center justify-between" title={label}>
                                      <span className="truncate mr-2">{label}</span>
                                      <CopyableBadge text={copyVal} copyValue={copyVal} className="text-[10px]" />
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                        {(!r.accountTags || r.accountTags.length === 0) && (
                          <span className="text-xs text-ink-mute/70 italic font-mono">
                            All manager accounts
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                            sourceState.kind === "attention"
                              ? "border border-rose-500/30 bg-rose-500/10 text-rose-300"
                              : sourceState.kind === "partial" || sourceState.kind === "not-synced"
                                ? "border border-amber-500/30 bg-amber-500/10 text-amber-300"
                                : sourceState.kind === "syncing"
                                  ? "border border-sky-500/30 bg-sky-500/10 text-sky-300"
                                  : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                          )}
                        >
                          {sourceState.kind === "attention" || sourceState.kind === "partial" || sourceState.kind === "not-synced" ? (
                            <AlertCircle className="h-3.5 w-3.5" />
                          ) : sourceState.kind === "syncing" ? (
                            <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin motion-reduce:animate-none" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2} />
                          )}
                          {sourceState.label}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-xs text-ink-mute">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-ink-mute/70 shrink-0" />
                        <span className="font-medium text-ink">{r.lastSync ?? "Never"}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-ink-mute border border-line/60">
                          <span className="h-1 w-1 rounded-full bg-emerald-400" />
                          Hourly auto-sync
                        </span>
                      </div>
                      {r.dataThroughDate ? (
                        <p className="mt-1 text-[11px] text-ink-mute font-mono">
                          Data through {new Date(r.dataThroughDate).toLocaleDateString()}
                        </p>
                      ) : null}
                      {sourceState.kind === "not-synced" && !r.dataThroughDate && (
                        <p className="mt-1 text-[11px] text-amber-400/90 font-mono">Pending initial sync</p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {needsReconnect ? (
                          <button
                            type="button"
                            onClick={() => onFixConnection(r)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-all"
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
                              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all",
                              syncBusy
                                ? "cursor-not-allowed border-line bg-panel text-ink-mute"
                                : "border-line bg-canvas text-ink hover:bg-white/[0.06] hover:border-white/20",
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
                            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all",
                            disconnectBusy
                              ? "cursor-not-allowed border-line bg-panel text-ink-mute"
                              : "border-line/70 bg-panel text-ink-mute hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300",
                          )}
                          data-no-row-click
                        >
                          Disconnect
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-line bg-panel p-1.5 text-xs text-ink-mute hover:bg-white/[0.06] hover:text-ink transition-colors"
                          onClick={() => setExpandedId((prev) => (prev === r.id ? null : r.id))}
                          title="Toggle details"
                          data-no-row-click
                        >
                          <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", isExpanded ? "rotate-180 text-ink" : "")} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-canvas/40">
                      <td colSpan={6} className="px-5 pb-5 pt-1">
                        <div className="rounded-xl border border-line/80 bg-panel/70 p-5 shadow-card backdrop-blur-sm space-y-4">
                          {(sourceState.kind === "attention" || sourceState.kind === "partial") && (
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
                              <div className="flex items-start gap-3">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/15 text-rose-400">
                                  <AlertCircle className="h-4 w-4" />
                                </div>
                                <div>
                                  <h4 className="text-sm font-semibold text-rose-200">Re-authentication Required</h4>
                                  <p className="mt-0.5 text-xs text-rose-300/90 leading-relaxed">
                                    {r.errorMsg || sourceState.detail}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => onFixConnection(r)}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-600 transition-all shadow-xs shrink-0"
                              >
                                <Wrench className="h-3.5 w-3.5" /> Reconnect source
                              </button>
                            </div>
                          )}

                          {canDirectSync(r.provider) ? (
                            <AccountSelector
                              connectionId={r.id}
                              provider={r.provider!}
                              connectionName={r.name}
                              managerBadge={r.managerBadge}
                              variant="compact"
                            />
                          ) : null}

                          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-ink-mute border-t border-line/60">
                            <div className="flex flex-wrap items-center gap-3">
                              <Link href={`/sources/${r.id}`} className="font-semibold text-ink hover:text-white transition-colors">
                                Open source details →
                              </Link>
                              <span className="text-line">·</span>
                              <Link href="/explorer" className="font-semibold text-ink hover:text-white transition-colors">
                                View warehouse data →
                              </Link>
                            </div>
                            {!r.pipelineId ? (
                              <span className="font-mono text-[11px] text-ink-mute">
                                Sync writes directly to warehouse
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
          )}
          </tbody>
        </table>
      </div>

      {renamingRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          onClick={() => setRenamingRow(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 shadow-elevated animate-in fade-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <h3 className="text-base font-semibold text-ink">Rename Connection</h3>
              <button
                type="button"
                onClick={() => setRenamingRow(null)}
                className="text-ink-mute hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-xs text-ink-mute leading-relaxed">
              Give this connection a custom nickname (e.g. &quot;US Marketing BM&quot; or &quot;Agency Client MCC&quot;) to easily differentiate multiple ad accounts and managers.
            </p>
            <form onSubmit={handleRenameSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-[11px] font-mono uppercase tracking-wider text-ink-mute mb-1.5">
                  Connection Name
                </label>
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  placeholder="e.g. Brand Alpha TikTok"
                  maxLength={100}
                  className="w-full h-10 rounded-xl border border-line bg-canvas px-3.5 text-sm text-ink outline-none focus:border-white/40 transition-colors"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRenamingRow(null)}
                  className="rounded-xl border border-line px-4 py-2 text-xs font-semibold text-ink-mute hover:text-ink hover:bg-white/[0.05] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={renameBusy || !renameValue.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
                >
                  {renameBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save Name"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
