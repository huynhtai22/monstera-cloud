"use client";

import React, { useState, useCallback, useMemo } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, ChevronDown, Building2, Copy, Layers, Search, Users } from "lucide-react";
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
    icon: <Building2 className="h-5 w-5" />,
    title: "Ad Accounts",
    typeLabel: "Ad Account",
  },
  google_ads: {
    icon: <Layers className="h-5 w-5" />,
    title: "Customer Accounts",
    typeLabel: "Customer",
  },
  tiktok_business: {
    icon: <Users className="h-5 w-5" />,
    title: "Advertisers",
    typeLabel: "Advertiser",
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
        const err = await res.json();
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
      toast.success("Account ID copied");
    } catch {
      toast.error("Could not copy account ID");
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-[#2f3336] dark:bg-[#000000]">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-ink" />
          Loading accounts...
        </div>
      </div>
    );
  }

  if (error || accounts.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {error?.message || "No accounts found. Try reconnecting the source."}
        </p>
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <section className="overflow-hidden rounded-lg border border-line bg-canvas" aria-label={`${config.title} sync selection`}>
        <div className="flex flex-col gap-3 border-b border-line px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              {config.icon}
              <span>{config.title}</span>
              <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-mute">{selectedCount}/{accounts.length} active</span>
            </div>
            <p className="mt-1 text-xs text-ink-mute">Paused accounts stay connected but are excluded from future syncs. Existing warehouse data stays intact.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-panel px-2 text-xs text-ink-mute sm:w-64">
              <Search className="h-3.5 w-3.5" />
              <input aria-label="Search accounts" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or account ID" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute" />
            </label>
            <button type="button" onClick={() => setVisibleSelection(true)} className="text-xs font-medium text-ink-mute hover:text-ink">Include shown</button>
            <span className="text-line">|</span>
            <button type="button" onClick={() => setVisibleSelection(false)} className="text-xs font-medium text-ink-mute hover:text-ink">Pause shown</button>
          </div>
        </div>

        <div className="max-h-72 overflow-auto">
          <div className="min-w-[42rem] divide-y divide-line">
            <div className="grid grid-cols-[minmax(16rem,1fr)_minmax(14rem,0.7fr)_7rem] gap-3 bg-panel/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-mute">
              <span>Account</span><span>Account ID</span><span className="text-right">Sync</span>
            </div>
            {visibleAccounts.map((account) => (
              <div key={account.id} className="grid grid-cols-[minmax(16rem,1fr)_minmax(14rem,0.7fr)_7rem] items-center gap-3 px-3 py-2.5 text-sm hover:bg-white/[0.025]">
                <span className="truncate font-medium text-ink" title={account.name}>{account.name}</span>
                <div className="flex min-w-0 items-center gap-1.5">
                  <code className="truncate font-mono text-xs text-ink-mute" title={account.id}>{account.id}</code>
                  <button type="button" onClick={() => copyAccountId(account.id)} className="shrink-0 rounded p-1 text-ink-mute hover:bg-white/[0.06] hover:text-ink" title="Copy account ID"><Copy className="h-3.5 w-3.5" /></button>
                </div>
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs font-medium text-ink">
                  <input type="checkbox" checked={account.selected} onChange={() => toggleAccount(account.id)} className="h-4 w-4 rounded border-line accent-white" />
                  <span>{account.selected ? "Active" : "Paused"}</span>
                </label>
              </div>
            ))}
          </div>
          {visibleAccounts.length === 0 ? <p className="px-3 py-8 text-center text-sm text-ink-mute">No matching accounts.</p> : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line bg-panel/50 px-3 py-3">
          <p className="text-xs text-ink-mute">{selectedCount === 0 ? "No accounts will sync until you include one." : `${selectedCount} account${selectedCount === 1 ? "" : "s"} will sync.`}</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => mutate()} className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-mute hover:bg-white/[0.05] hover:text-ink">Reset</button>
            <button type="button" onClick={saveSelection} disabled={saving} className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-neutral-200 disabled:opacity-50">{saving ? "Saving…" : "Save sync selection"}</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-[#2f3336] dark:bg-[#000000]">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-[#16181c]/50"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-panel text-ink">
            {config.icon}
          </div>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white">{config.title}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {selectedCount} of {accounts.length} selected for sync
            </p>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-5 w-5 text-gray-400 transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="border-t border-gray-200 p-4 dark:border-[#2f3336]">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              Select accounts to sync
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const allSelected = accounts.map((a) => ({ ...a, selected: true }));
                  mutate({ ...data, accounts: allSelected }, false);
                }}
                className="text-xs text-ink-mute hover:text-ink"
              >
                Select all
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={() => {
                  const noneSelected = accounts.map((a) => ({ ...a, selected: false }));
                  mutate({ ...data, accounts: noneSelected }, false);
                }}
                className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-[#2f3336] dark:bg-[#16181c]">
            {accounts.map((account) => (
              <label
                key={account.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 transition-colors",
                  "hover:bg-white dark:hover:bg-[#1d1f23]",
                  account.selected && "bg-white dark:bg-[#1d1f23]"
                )}
              >
                <div
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded border transition-colors",
                    account.selected
                      ? "border-ink bg-primary text-primary-foreground"
                      : "border-gray-300 bg-white dark:border-[#2f3336] dark:bg-[#16181c]"
                  )}
                  onClick={() => toggleAccount(account.id)}
                >
                  {account.selected && <Check className="h-3.5 w-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                    {account.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {config.typeLabel}: {account.id}
                  </p>
                </div>
              </label>
            ))}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => {
                mutate();
                setIsOpen(false);
              }}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-[#16181c]"
            >
              Cancel
            </button>
            <button
              onClick={saveSelection}
              disabled={saving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Selection"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
