"use client";

import React, { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ChevronDown, Clock, LayoutGrid, List, Loader2, Pencil, Play, RefreshCw, Search, Wrench, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PrimaryButton, SecondaryButton, IntegrationMark } from "@/components/ui";
import { CopyableBadge } from "@/components/ui/CopyableBadge";
import type { SourceHealthState } from "@/lib/source-health";
import {
  PROVIDER_DISPLAY_NAME,
  formatLastSyncLabel,
  sourceStateFor,
  summarizeAccountScope,
  type AccountTagEntry,
  type SourceState,
  type SourceStateKind,
} from "@/lib/source-list-display";

export type { AccountTagEntry, SourceState, SourceStateKind };

type IntegrationRow = {
  id: string;
  provider?: string;
  catalogId?: string;
  name: string;
  description?: string;
  managerBadge?: string | null;
  accountEmail?: string | null;
  accountName?: string | null;
  shortId?: string;
  status: "connected" | "error" | "syncing" | string;
  healthState?: SourceHealthState;
  errorMsg?: string;
  lastSync?: string;
  dataThroughDate?: string | null;
  logoSrc?: string;
  pipelineId?: string;
  accountTags?: AccountTagEntry[];
  accountCount?: number;
};

type SortKey = "name" | "status" | "lastSync";

interface ConnectedSourceListProps {
  rows: IntegrationRow[];
  busyActions: Set<string>;
  onSync: (pipelineId: string, integrationId: string) => void;
  onDirectSync: (connectionId: string, provider: string) => void;
  onDisconnect: (connectionId: string, displayName: string) => void;
  onFixConnection: (integration: any) => void;
  onRenameConnection?: (connectionId: string, newName: string) => Promise<void> | void;
}

function statusRank(row: IntegrationRow): number {
  const s = sourceStateFor(row, false);
  if (s.kind === "auth-required") return 0;
  if (s.kind === "sync-issue" || s.kind === "attention") return 1;
  if (s.kind === "partial") return 2;
  if (s.kind === "stale") return 3;
  if (s.kind === "not-synced") return 4;
  if (s.kind === "syncing") return 5;
  return 6;
}

function safeTimeValue(dateStr?: string): number {
  if (!dateStr || dateStr === "Never") return 0;
  const t = new Date(dateStr).getTime();
  return Number.isFinite(t) ? t : 0;
}

function canDirectSync(provider: string | undefined): boolean {
  return provider != null && ["meta_ads", "google_ads", "tiktok_business", "shopee", "lazada"].includes(provider);
}



function statusBadgeClass(kind: SourceStateKind): string {
  if (kind === "auth-required") return "border-rose-500/30 bg-rose-500/10 text-rose-300";
  if (kind === "sync-issue" || kind === "partial") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  if (kind === "not-synced") return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  if (kind === "syncing") return "border-cyan-500/30 bg-cyan-500/10 text-cyan-300";
  if (kind === "stale") return "border-line/80 bg-panel text-ink-mute";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
}

function StatusIcon({ kind }: { kind: SourceStateKind }) {
  if (kind === "auth-required") return <AlertCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />;
  if (kind === "sync-issue" || kind === "partial") return <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
  if (kind === "syncing") return <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin text-cyan-400 shrink-0" />;
  if (kind === "not-synced") return <span className="h-1.5 w-1.5 rounded-full bg-sky-400 shrink-0" />;
  if (kind === "stale") return <span className="h-1.5 w-1.5 rounded-full bg-amber-400/80 shrink-0" />;
  return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" strokeWidth={2} />;
}

function StatusBadge({ state }: { state: SourceState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium shadow-2xs",
        statusBadgeClass(state.kind),
      )}
      title={state.detail || state.subtext}
    >
      <StatusIcon kind={state.kind} />
      <span>{state.label}</span>
    </span>
  );
}

function AccountsCell({
  provider,
  tags,
  accountCount,
  align = "start",
}: {
  provider?: string;
  tags?: AccountTagEntry[];
  accountCount?: number;
  align?: "start" | "end";
}) {
  const summary = summarizeAccountScope(provider, tags, accountCount);
  if (summary.chips.length === 0) {
    return (
      <span className={cn("text-xs text-ink-mute", align === "end" && "text-right")}>
        {summary.countLabel}
      </span>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", align === "end" && "justify-end")}>
      {summary.chips.map((chip, idx) => (
        <CopyableBadge
          key={`${chip.id}-${idx}`}
          text={chip.label}
          copyValue={chip.id}
          title={`Click to copy account ID "${chip.id}"`}
          className="text-[11px] text-ink-mute font-mono py-0 px-1.5"
        />
      ))}
      {summary.moreCount > 0 && (
        <span className="rounded-md border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-ink-mute">
          +{summary.moreCount} more
        </span>
      )}
    </div>
  );
}

function LastSyncCell({ lastSync }: { lastSync?: string }) {
  const formatted = formatLastSyncLabel(lastSync);
  return (
    <div className="flex items-center gap-1.5 text-xs text-ink-mute" title={formatted.title}>
      <Clock className="h-3 w-3 text-ink-mute/70 shrink-0" />
      <span className="font-medium text-ink">{formatted.text}</span>
    </div>
  );
}

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
  const [renamingRow, setRenamingRow] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"detailed" | "lite">("lite");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("monstera_sources_view_mode");
      if (saved === "detailed" || saved === "lite") {
        setViewMode(saved);
      }
    } catch {}
  }, []);

  const handleViewModeChange = (mode: "detailed" | "lite") => {
    setViewMode(mode);
    try {
      localStorage.setItem("monstera_sources_view_mode", mode);
    } catch {}
  };

  const availablePlatforms = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (r.provider) {
        counts[r.provider] = (counts[r.provider] || 0) + 1;
      }
    }
    return Object.entries(counts).map(([id, count]) => ({
      id,
      label: PROVIDER_DISPLAY_NAME[id] || id,
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
        const emailMatch = (r.accountEmail || "").toLowerCase().includes(q) || (r.accountName || "").toLowerCase().includes(q);
        const descMatch = (r.description || "").toLowerCase().includes(q);
        const idMatch = (r.id || "").toLowerCase().includes(q) || (r.shortId || "").toLowerCase().includes(q);
        const tagMatch = (r.accountTags || []).some((t) =>
          (typeof t === "object" ? `${t.id} ${t.label}` : t).toLowerCase().includes(q)
        );
        return nameMatch || badgeMatch || emailMatch || descMatch || idMatch || tagMatch;
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

  const renderRowAction = (r: IntegrationRow, sourceState: SourceState, syncBusy: boolean) => {
    if (sourceState.needsReconnect) {
      return (
        <button
          type="button"
          onClick={() => onFixConnection(r)}
          className="inline-flex items-center gap-1.5 h-8.5 px-3.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 hover:border-rose-500/50 transition-all cursor-pointer shadow-xs"
          data-no-row-click
          data-no-card-click
          title="Re-authenticate OAuth credentials"
        >
          <Wrench className="h-3.5 w-3.5 text-rose-400" />
          <span>Reconnect</span>
        </button>
      );
    }
    if (sourceState.kind === "not-synced") {
      return (
        <button
          type="button"
          disabled={syncBusy}
          onClick={() => runRowSync(r)}
          className="inline-flex items-center gap-1.5 h-8.5 px-3.5 rounded-lg border border-sky-500/30 bg-sky-500/10 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 hover:border-sky-500/50 transition-all cursor-pointer shadow-xs"
          data-no-row-click
          data-no-card-click
          title="Trigger initial warehouse sync"
        >
          {syncBusy ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" /> : <Play className="h-3.5 w-3.5 text-sky-400 fill-sky-400/30" />}
          <span>{syncBusy ? "Syncing" : "First sync"}</span>
        </button>
      );
    }
    if (sourceState.kind === "sync-issue" || sourceState.kind === "partial") {
      return (
        <button
          type="button"
          disabled={syncBusy}
          onClick={() => runRowSync(r)}
          className="inline-flex items-center gap-1.5 h-8.5 px-3.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/50 transition-all cursor-pointer shadow-xs"
          data-no-row-click
          data-no-card-click
          title="Retry failed sync directly"
        >
          {syncBusy ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 text-amber-400" />}
          <span>{syncBusy ? "Syncing" : "Retry sync"}</span>
        </button>
      );
    }
    return (
      <button
        type="button"
        disabled={syncBusy || !sourceState.canSync}
        onClick={() => runRowSync(r)}
        className={cn(
          "inline-flex items-center gap-1.5 h-8.5 px-3.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer shadow-xs",
          syncBusy || !sourceState.canSync
            ? "cursor-not-allowed border-line bg-panel text-ink-mute"
            : "border-line bg-canvas text-ink hover:bg-white/[0.06] hover:border-white/20",
        )}
        data-no-row-click
        data-no-card-click
        title={sourceState.kind === "syncing" ? sourceState.detail : "Trigger warehouse sync"}
      >
        {syncBusy || sourceState.kind === "syncing" ? (
          <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        <span>{syncBusy || sourceState.kind === "syncing" ? "Syncing" : "Sync"}</span>
      </button>
    );
  };

  return (
    <div className="rounded-xl border border-line bg-panel shadow-xs overflow-hidden">
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

            <div className="flex items-center rounded-lg border border-line bg-canvas p-0.5 text-xs">
              <button
                type="button"
                onClick={() => handleViewModeChange("detailed")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all cursor-pointer",
                  viewMode === "detailed"
                    ? "bg-white text-black font-semibold shadow-2xs"
                    : "text-ink-mute hover:text-ink hover:bg-white/[0.04]"
                )}
                title="Detailed cards view with full health details and actions"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>Detailed</span>
              </button>
              <button
                type="button"
                onClick={() => handleViewModeChange("lite")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all cursor-pointer",
                  viewMode === "lite"
                    ? "bg-white text-black font-semibold shadow-2xs"
                    : "text-ink-mute hover:text-ink hover:bg-white/[0.04]"
                )}
                title="Lite compact table view for dense scanning"
              >
                <List className="h-3.5 w-3.5" />
                <span>Lite</span>
              </button>
            </div>

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

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-line/50">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by MCC, account ID, Gmail, or name…"
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

      {filteredAndSortedRows.length === 0 ? (
        <div className="px-5 py-12 text-center text-xs text-ink-mute">
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
        </div>
      ) : viewMode === "detailed" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 p-4 sm:p-6 bg-panel/30">
          {filteredAndSortedRows.map((r) => {
            const syncBusy =
              (r.pipelineId && busyActions.has(`sync:${r.pipelineId}`)) || busyActions.has(`direct-sync:${r.id}`);
            const disconnectBusy = busyActions.has(r.id);
            const sourceState = sourceStateFor(r, Boolean(syncBusy));
            const showDiagnostic = sourceState.kind === "auth-required" || sourceState.kind === "sync-issue" || sourceState.kind === "partial" || sourceState.kind === "syncing";

            return (
              <div
                key={r.id}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest("[data-no-card-click]")) {
                    router.push(`/sources/${r.id}`);
                  }
                }}
                className={cn(
                  "glass-card governed-hover relative flex flex-col justify-between h-full rounded-2xl border p-5 sm:p-5.5 transition-all duration-200 cursor-pointer group shadow-xs",
                  sourceState.kind === "auth-required"
                    ? "border-rose-500/30 bg-rose-950/10 hover:border-rose-500/50"
                    : sourceState.kind === "sync-issue" || sourceState.kind === "partial"
                      ? "border-amber-500/30 bg-amber-950/10 hover:border-amber-500/50"
                      : sourceState.kind === "not-synced" || sourceState.kind === "syncing"
                        ? "border-sky-500/30 bg-sky-950/10 hover:border-sky-500/50"
                        : "border-line/70 bg-panel/75 hover:border-white/20 hover:bg-panel"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3.5 min-w-0">
                    {r.logoSrc ? (
                      <div className="p-2 rounded-xl border border-white/[0.08] bg-white/[0.03] shrink-0 shadow-2xs">
                        <IntegrationMark src={r.logoSrc} size="md" />
                      </div>
                    ) : null}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5 group/name">
                        <Link
                          href={`/sources/${r.id}`}
                          className="truncate text-sm font-semibold tracking-tight text-ink hover:text-white transition-colors"
                          data-no-card-click
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
                          data-no-card-click
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                      {r.managerBadge && (
                        <CopyableBadge
                          text={r.managerBadge}
                          copyValue={r.managerBadge.replace(/^\[|\]$/g, "").replace(/^(MCC|BM|BC|Shop|Store|CID|Adv|act_):\s*/, "")}
                          title={r.accountEmail ? `${r.managerBadge} · ${r.accountEmail}` : `Click to copy ${r.managerBadge}`}
                          className="text-[10px] text-ink-mute border-line/70 bg-canvas/80"
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0" data-no-card-click onClick={(e) => e.stopPropagation()}>
                    <StatusBadge state={sourceState} />
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.id)}
                      onChange={() => toggleSelectOne(r.id)}
                      className="cursor-pointer h-4 w-4 rounded border-line bg-canvas accent-white"
                    />
                  </div>
                </div>

                <div className="my-4 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2 text-xs py-1 border-t border-line/40">
                    <span className="text-ink-mute shrink-0">Accounts:</span>
                    <AccountsCell provider={r.provider} tags={r.accountTags} accountCount={r.accountCount} align="end" />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs py-1 border-t border-line/40">
                    <span className="text-ink-mute shrink-0">Last sync:</span>
                    <LastSyncCell lastSync={r.lastSync} />
                  </div>
                  {showDiagnostic && sourceState.detail && (
                    <div className={cn(
                      "rounded-xl p-3 text-xs leading-relaxed border flex items-start gap-2.5 mt-2",
                      sourceState.kind === "auth-required"
                        ? "border-rose-500/25 bg-rose-500/[0.08] text-rose-300"
                        : sourceState.kind === "syncing"
                          ? "border-cyan-500/25 bg-cyan-500/[0.08] text-cyan-200"
                          : "border-amber-500/25 bg-amber-500/[0.08] text-amber-300"
                    )}>
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <p className="text-xs break-words opacity-90">{sourceState.detail}</p>
                    </div>
                  )}
                </div>

                <div className="pt-3.5 mt-auto border-t border-line/50 flex items-center justify-between gap-2" data-no-card-click>
                  <Link
                    href={`/sources/${r.id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-mute hover:text-ink transition-colors py-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canDirectSync(r.provider) ? "Manage accounts" : "Open details"}
                  </Link>
                  <div className="flex items-center gap-1.5">
                    {renderRowAction(r, sourceState, Boolean(syncBusy))}
                    <button
                      type="button"
                      disabled={disconnectBusy}
                      onClick={() => onDisconnect(r.id, r.name)}
                      className="h-8.5 w-8.5 rounded-lg border border-line bg-canvas text-ink-mute hover:text-rose-400 hover:border-rose-500/30 hover:bg-rose-500/10 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                      title="Disconnect source"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="max-lg:overflow-x-auto">
          <table className="min-w-[960px] w-full text-sm">
            <colgroup>
              <col className="w-12" />
              <col className="w-[320px]" />
              <col className="w-[220px]" />
              <col className="w-[140px]" />
              <col className="w-[140px]" />
              <col className="w-[150px]" />
            </colgroup>
            <thead className="border-b border-line bg-panel lg:sticky lg:top-[41px] lg:z-[15]">
              <tr>
                <th className="w-12 px-5 py-3 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-ink-mute bg-panel">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} data-no-row-click />
                </th>
                <th className="px-5 py-3 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-ink-mute bg-panel">Connector</th>
                <th className="px-5 py-3 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-ink-mute bg-panel">Accounts</th>
                <th className="px-5 py-3 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-ink-mute bg-panel">Status</th>
                <th className="px-5 py-3 text-left text-[11px] font-mono font-medium uppercase tracking-wider text-ink-mute bg-panel">Last sync</th>
                <th className="px-5 py-3 text-right text-[11px] font-mono font-medium uppercase tracking-wider text-ink-mute bg-panel">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filteredAndSortedRows.map((r) => {
                const isExpanded = expandedId === r.id;
                const syncBusy =
                  (r.pipelineId && busyActions.has(`sync:${r.pipelineId}`)) || busyActions.has(`direct-sync:${r.id}`);
                const sourceState = sourceStateFor(r, Boolean(syncBusy));
                const showDiagnostic = sourceState.kind === "auth-required" || sourceState.kind === "sync-issue" || sourceState.kind === "partial" || (sourceState.kind === "syncing" && Boolean(r.errorMsg));
                return (
                  <React.Fragment key={r.id}>
                    <tr
                      className="cursor-pointer hover:bg-white/[0.025] transition-colors duration-150 border-b border-line/40 last:border-0"
                      onClick={(e) => {
                        if (!(e.target as HTMLElement).closest("[data-no-row-click]")) {
                          router.push(`/sources/${r.id}`);
                        }
                      }}
                    >
                      <td className="px-5 py-3.5" data-no-row-click>
                        <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelectOne(r.id)} />
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3.5">
                          {r.logoSrc ? (
                            <div className="p-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] shrink-0 shadow-2xs">
                              <IntegrationMark src={r.logoSrc} size="md" />
                            </div>
                          ) : null}
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
                            {r.managerBadge && (
                              <CopyableBadge
                                text={r.managerBadge}
                                copyValue={r.managerBadge.replace(/^\[|\]$/g, "").replace(/^(MCC|BM|BC|Shop|Store|CID|Adv|act_):\s*/, "")}
                                title={r.accountEmail ? `${r.managerBadge} · ${r.accountEmail}` : `Click to copy ${r.managerBadge}`}
                                className="text-[10px] text-ink-mute border-line/70 bg-canvas/80"
                              />
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <AccountsCell provider={r.provider} tags={r.accountTags} accountCount={r.accountCount} />
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge state={sourceState} />
                      </td>
                      <td className="px-5 py-3.5">
                        <LastSyncCell lastSync={r.lastSync} />
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-2">
                          {renderRowAction(r, sourceState, Boolean(syncBusy))}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedId(isExpanded ? null : r.id);
                            }}
                            className={cn(
                              "rounded-lg p-1.5 text-ink-mute hover:text-ink hover:bg-white/[0.06] transition-all cursor-pointer",
                              isExpanded && "bg-white/[0.06] text-ink rotate-180"
                            )}
                            title={isExpanded ? "Collapse" : "Show diagnostic"}
                            data-no-row-click
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-canvas/50 border-b border-line/60">
                        <td colSpan={6} className="px-6 py-3.5" data-no-row-click>
                          <div className="space-y-3">
                            {showDiagnostic && (
                              <div className={cn(
                                "flex items-start gap-3 rounded-xl border p-3.5",
                                sourceState.kind === "auth-required"
                                  ? "border-rose-500/30 bg-rose-500/10"
                                  : sourceState.kind === "syncing"
                                    ? "border-cyan-500/30 bg-cyan-500/10"
                                    : "border-amber-500/30 bg-amber-500/10",
                              )}>
                                <AlertCircle className={cn(
                                  "h-4 w-4 shrink-0 mt-0.5",
                                  sourceState.kind === "auth-required" ? "text-rose-400" : sourceState.kind === "syncing" ? "text-cyan-400" : "text-amber-400",
                                )} />
                                <div className="min-w-0">
                                  <h4 className={cn(
                                    "text-sm font-semibold",
                                    sourceState.kind === "auth-required" ? "text-rose-200" : sourceState.kind === "syncing" ? "text-cyan-200" : "text-amber-200",
                                  )}>
                                    {sourceState.kind === "auth-required" ? "Needs re-auth" : sourceState.kind === "syncing" ? "Still processing" : "Sync diagnostic"}
                                  </h4>
                                  <p className={cn(
                                    "mt-0.5 text-xs leading-relaxed",
                                    sourceState.kind === "auth-required" ? "text-rose-300/90" : sourceState.kind === "syncing" ? "text-cyan-200/90" : "text-amber-300/90",
                                  )}>
                                    {sourceState.detail}
                                  </p>
                                </div>
                              </div>
                            )}
                            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-mute">
                              <div className="flex flex-wrap items-center gap-3">
                                <Link href={`/sources/${r.id}`} className="font-semibold text-ink hover:text-white transition-colors">
                                  Open source details →
                                </Link>
                                <span className="text-line">·</span>
                                <Link href="/explorer" className="font-semibold text-ink hover:text-white transition-colors">
                                  View warehouse data →
                                </Link>
                              </div>
                              <span className="font-mono text-[11px] text-ink-mute">
                                Account scope is managed on the source page
                              </span>
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
      )}

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
