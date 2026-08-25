"use client";

import React, { useState, useCallback, useMemo } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, ChevronDown, Building2, Copy, Layers, Search, Users, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Account {
  id: string;
  name: string;
  type: string;
  selected: boolean;
}

interface AccountSelectorProps {
  connectionId: string;
  provider: string;
  variant?: "panel" | "compact";
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to load");
  return data;
};

const PROVIDER_CONFIG: Record<string, { icon: React.ReactNode; title: string; typeLabel: string }> = {
  meta_ads: {
    icon: <Building2 className="h-4 w-4" />,
    title: "Meta Ad Accounts",
    typeLabel: "Ad Account",
  },
  google_ads: {
    icon: <Layers className="h-4 w-4" />,
    title: "Google Ads Customers",
    typeLabel: "Customer ID",
  },
  tiktok_business: {
    icon: <Users className="h-4 w-4" />,
    title: "TikTok Advertisers",
    typeLabel: "Advertiser ID",
  },
};

export function AccountSelector({ connectionId, provider, variant = "panel" }: AccountSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  const { data, error, isLoading, mutate } = useSWR(
    `/api/connections/${connectionId}/accounts`,
    fetcher,
    { refreshInterval: 0 }
  );

  const accounts: Account[] = useMemo(() => data?.accounts || [], [data?.accounts]);
  const selectedCount = accounts.filter((a) => a.selected).length;
  const unavailableCount = Number.isInteger(data?.unavailableCount) ? data.unavailableCount : 0;
  const visibleAccounts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter((account) =>
      account.name.toLowerCase().includes(needle) || account.id.toLowerCase().includes(needle),
    );
  }, [accounts, query]);

  const toggleAccount = useCallback((accountId: string) => {
    if (!data?.accounts) return;
    
    const newAccounts = accounts.map((a) =>
      a.id === accountId ? { ...a, selected: !a.selected } : a
    );
    
    // Optimistic update
    mutate({ ...data, accounts: newAccounts }, false);
  }, [accounts, data, mutate]);

  const saveSelection = useCallback(async () => {
    const selectedIds = accounts.filter((a) => a.selected).map((a) => a.id);
    
    setSaving(true);
    try {
      const res = await fetch(`/api/connections/${connectionId}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedIds }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save");
      }

      toast.success(`Saved ${selectedIds.length} selected accounts`);
      mutate(); // Revalidate
      setIsOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to save selection");
    } finally {
      setSaving(false);
    }
  }, [accounts, connectionId, mutate]);

  const config = PROVIDER_CONFIG[provider];
  if (!config) return null;

  const setVisibleSelection = (selected: boolean) => {
    const visibleIds = new Set(visibleAccounts.map((account) => account.id));
    mutate({
      ...data,
      accounts: accounts.map((account) => visibleIds.has(account.id) ? { ...account, selected } : account),
    }, false);
  };

  const copyAccountId = async (accountId: string) => {
    try {
      await navigator.clipboard.writeText(accountId);
      toast.success("Account ID copied to clipboard");
    } catch {
      toast.error("Could not copy account ID");
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-line/80 bg-panel/50 p-5 shadow-xs">
        <div className="flex items-center gap-3 text-xs text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin text-ink-mute" />
          <span>Loading ad account scopes…</span>
        </div>
      </div>
    );
  }

  if (error || accounts.length === 0) {
    return (
      <div className="rounded-xl border border-line/80 bg-panel/50 p-5 shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
            <AlertCircle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold tracking-tight text-ink">No ad accounts discovered</h4>
            <p className="mt-1 text-xs leading-relaxed text-ink-mute">
              {error?.message || "Monstera could not find ad accounts attached to this connection. Reconnecting will re-authorize OAuth access and discover available ad accounts."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <section className="overflow-hidden rounded-xl border border-line bg-canvas shadow-xs" aria-label={`${config.title} sync selection`}>
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-line bg-panel/60 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-panel text-ink shadow-xs">
                {config.icon}
              </div>
              <h3 className="text-sm font-semibold tracking-tight text-ink">{config.title}</h3>
              <span className="inline-flex items-center rounded-md border border-line/80 bg-panel px-2 py-0.5 font-mono text-[11px] font-medium text-ink-mute">
                {selectedCount} / {accounts.length} active
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-mute">
              Paused accounts stay connected but are excluded from future syncs. Existing warehouse history is retained.
            </p>
            {provider === "google_ads" && unavailableCount > 0 ? (
              <p className="mt-1 text-xs text-amber-400">
                {unavailableCount} unavailable account{unavailableCount === 1 ? "" : "s"} excluded from this source.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute" />
              <input
                aria-label="Search accounts"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name or ID…"
                className="h-8 w-full sm:w-56 rounded-lg border border-line bg-canvas pl-8 pr-3 text-xs text-ink placeholder:text-ink-mute focus:border-white/30 focus:outline-none transition-colors"
              />
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-line/80 bg-panel/80 p-0.5">
              <button
                type="button"
                onClick={() => setVisibleSelection(true)}
                className="rounded-md px-2.5 py-1 text-xs font-medium text-ink-mute hover:bg-white/[0.06] hover:text-ink transition-colors"
              >
                Include shown
              </button>
              <span className="text-line">|</span>
              <button
                type="button"
                onClick={() => setVisibleSelection(false)}
                className="rounded-md px-2.5 py-1 text-xs font-medium text-ink-mute hover:bg-white/[0.06] hover:text-ink transition-colors"
              >
                Pause shown
              </button>
            </div>
          </div>
        </div>

        {/* Account Table */}
        <div className="max-h-72 overflow-x-auto overflow-y-auto overscroll-contain">
          <div className="min-w-[38rem] divide-y divide-line/40">
            <div className="sticky top-0 z-10 grid grid-cols-[minmax(16rem,1fr)_minmax(12rem,0.8fr)_7rem] gap-4 bg-panel/90 px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-ink-mute backdrop-blur-sm border-b border-line">
              <span>Account</span>
              <span>Account ID</span>
              <span className="text-right">Sync Status</span>
            </div>
            {visibleAccounts.map((account) => (
              <div
                key={account.id}
                onClick={() => toggleAccount(account.id)}
                className="grid grid-cols-[minmax(16rem,1fr)_minmax(12rem,0.8fr)_7rem] items-center gap-4 px-4 py-3 text-xs hover:bg-white/[0.025] transition-colors cursor-pointer"
              >
                <span className="truncate font-medium text-ink" title={account.name}>
                  {account.name}
                </span>
                <div className="flex min-w-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <code className="truncate rounded border border-line/60 bg-panel px-2 py-0.5 font-mono text-[11px] text-ink-mute" title={account.id}>
                    {account.id}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyAccountId(account.id)}
                    className="shrink-0 rounded p-1 text-ink-mute hover:bg-white/[0.08] hover:text-ink transition-colors"
                    title="Copy account ID"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex justify-end">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                      account.selected
                        ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        : "border border-line bg-panel text-ink-mute",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        account.selected ? "bg-emerald-400" : "bg-neutral-500",
                      )}
                    />
                    {account.selected ? "Active" : "Paused"}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {visibleAccounts.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-ink-mute">
              No matching accounts found for &ldquo;{query}&rdquo;.
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-line bg-panel/50 p-4">
          <p className="text-xs text-ink-mute">
            {selectedCount === 0
              ? "No accounts will sync until at least one is included."
              : `${selectedCount} of ${accounts.length} account${accounts.length === 1 ? "" : "s"} enabled for warehouse sync.`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => mutate()}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-mute hover:bg-white/[0.06] hover:text-ink transition-colors"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={saveSelection}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-1.5 text-xs font-semibold text-black hover:bg-neutral-200 disabled:opacity-50 transition-all shadow-xs"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              <span>{saving ? "Saving…" : "Save sync selection"}</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-panel shadow-xs overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-canvas text-ink">
            {config.icon}
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-ink">{config.title}</h3>
            <p className="text-xs text-ink-mute">
              {selectedCount} of {accounts.length} selected for sync
            </p>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-ink-mute transition-transform duration-200",
            isOpen && "rotate-180 text-ink"
          )}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="border-t border-line p-4 sm:p-5 bg-canvas/40">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
              Select accounts to sync
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const allSelected = accounts.map((a) => ({ ...a, selected: true }));
                  mutate({ ...data, accounts: allSelected }, false);
                }}
                className="text-xs font-medium text-ink-mute hover:text-ink transition-colors"
              >
                Select all
              </button>
              <span className="text-line">|</span>
              <button
                onClick={() => {
                  const noneSelected = accounts.map((a) => ({ ...a, selected: false }));
                  mutate({ ...data, accounts: noneSelected }, false);
                }}
                className="text-xs font-medium text-ink-mute hover:text-ink transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="max-h-64 space-y-1.5 overflow-y-auto overscroll-contain rounded-lg border border-line bg-panel p-2">
            {accounts.map((account) => (
              <label
                key={account.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 transition-colors",
                  "hover:bg-white/[0.04]",
                  account.selected && "bg-white/[0.03]"
                )}
              >
                <div
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                    account.selected
                      ? "border-white bg-white text-black"
                      : "border-line bg-canvas text-transparent"
                  )}
                  onClick={() => toggleAccount(account.id)}
                >
                  {account.selected && <Check className="h-3 w-3" strokeWidth={3} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-medium text-ink">
                    {account.name}
                  </p>
                  <p className="font-mono text-[11px] text-ink-mute">
                    {config.typeLabel}: {account.id}
                  </p>
                </div>
              </label>
            ))}
          </div>

          <div className="mt-4 flex justify-end gap-2.5">
            <button
              onClick={() => {
                mutate();
                setIsOpen(false);
              }}
              className="rounded-lg px-3.5 py-1.5 text-xs font-medium text-ink-mute hover:bg-white/[0.05] hover:text-ink transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveSelection}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-neutral-200 disabled:opacity-50 transition-all shadow-xs"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              <span>{saving ? "Saving…" : "Save Selection"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
