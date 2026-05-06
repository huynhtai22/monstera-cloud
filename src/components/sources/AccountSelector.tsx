"use client";

import React, { useState, useCallback } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, ChevronDown, Building2, Layers, Users } from "lucide-react";
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

export function AccountSelector({ connectionId, provider }: AccountSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data, error, isLoading, mutate } = useSWR(
    `/api/connections/${connectionId}/accounts`,
    fetcher,
    { refreshInterval: 0 }
  );

  const accounts: Account[] = data?.accounts || [];
  const selectedCount = accounts.filter((a) => a.selected).length;

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

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
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

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-slate-800/50"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400">
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
        <div className="border-t border-gray-200 p-4 dark:border-slate-700">
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
                className="text-xs text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
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

          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-slate-700 dark:bg-slate-800">
            {accounts.map((account) => (
              <label
                key={account.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 transition-colors",
                  "hover:bg-white dark:hover:bg-slate-700",
                  account.selected && "bg-white dark:bg-slate-700"
                )}
              >
                <div
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded border transition-colors",
                    account.selected
                      ? "border-cyan-500 bg-cyan-500 text-white"
                      : "border-gray-300 bg-white dark:border-slate-600 dark:bg-slate-800"
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
              onClick={() => setIsOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              onClick={saveSelection}
              disabled={saving}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Selection"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
