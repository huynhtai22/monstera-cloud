"use client";

import React, { useState, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import {
  Users,
  Search,
  AlertTriangle,
  ArrowRightLeft,
  X,
  Layers,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { DiscoveredAccount } from "@/lib/client-account-assignment";

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to fetch data");
  return data;
};

interface ClientOption {
  id: string;
  name: string;
}

interface ClientAccountsSectionProps {
  workspaceId: string;
  initialClientId?: string | null;
}

export function ClientAccountsSection({
  workspaceId,
  initialClientId,
}: ClientAccountsSectionProps) {
  const { mutate } = useSWRConfig();

  // Filters
  const [selectedClientId, setSelectedClientId] = useState<string>(initialClientId || "all");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Selection state for bulk operations
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Modal states
  const [assignModalTarget, setAssignModalTarget] = useState<DiscoveredAccount | null>(null);
  const [isBulkAssignModalOpen, setIsBulkAssignModalOpen] = useState(false);
  const [switchSourceTarget, setSwitchSourceTarget] = useState<DiscoveredAccount | null>(null);
  const [unassignTarget, setUnassignTarget] = useState<DiscoveredAccount | null>(null);

  // Form selections inside modals
  const [modalClientId, setModalClientId] = useState<string>("");
  const [modalConnectionId, setModalConnectionId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // SWR queries
  const accountsKey = `/api/workspaces/${workspaceId}/client-accounts`;
  const { data: accountsData, error: accountsError, isLoading: accountsLoading } = useSWR<{
    accounts: DiscoveredAccount[];
    total: number;
    unassignedCount: number;
  }>(workspaceId ? accountsKey : null, fetcher);

  const clientsKey = `/api/clients?workspaceId=${workspaceId}`;
  const { data: clientsData } = useSWR<ClientOption[]>(
    workspaceId ? clientsKey : null,
    fetcher
  );

  const clientsList = useMemo(() => (Array.isArray(clientsData) ? clientsData : []), [clientsData]);
  const allAccounts = useMemo(() => accountsData?.accounts ?? [], [accountsData]);

  // Distinct providers in discovered accounts
  const discoveredProviders = useMemo(() => {
    return Array.from(new Set(allAccounts.map((a) => a.provider)));
  }, [allAccounts]);

  // Filtered accounts
  const filteredAccounts = useMemo(() => {
    return allAccounts.filter((account) => {
      // Client filter
      if (selectedClientId === "unassigned") {
        if (account.isAssigned) return false;
      } else if (selectedClientId !== "all") {
        if (account.assignedClient?.id !== selectedClientId) return false;
      }

      // Provider filter
      if (providerFilter !== "all" && account.provider !== providerFilter) {
        return false;
      }

      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchId = account.accountId.toLowerCase().includes(q);
        const matchName = account.accountName.toLowerCase().includes(q);
        const matchClient = account.assignedClient?.name.toLowerCase().includes(q) ?? false;
        const matchConn = account.availableConnections.some((c) =>
          c.name.toLowerCase().includes(q)
        );
        if (!matchId && !matchName && !matchClient && !matchConn) return false;
      }

      return true;
    });
  }, [allAccounts, selectedClientId, providerFilter, searchQuery]);

  // Checkbox helpers
  const allVisibleSelected = useMemo(() => {
    if (filteredAccounts.length === 0) return false;
    return filteredAccounts.every((a) => selectedKeys.has(`${a.provider}:${a.accountId}`));
  }, [filteredAccounts, selectedKeys]);

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedKeys(new Set());
    } else {
      const next = new Set<string>();
      for (const a of filteredAccounts) {
        next.add(`${a.provider}:${a.accountId}`);
      }
      setSelectedKeys(next);
    }
  };

  const toggleSelectOne = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  // Open single assign modal
  const openAssignModal = (account: DiscoveredAccount) => {
    setAssignModalTarget(account);
    setModalClientId(account.assignedClient?.id || clientsList[0]?.id || "");
    setModalConnectionId(account.authoritativeConnectionId || account.availableConnections[0]?.id || "");
  };

  // Open switch source modal
  const openSwitchSourceModal = (account: DiscoveredAccount) => {
    setSwitchSourceTarget(account);
    setModalConnectionId(account.authoritativeConnectionId || account.availableConnections[0]?.id || "");
  };

  // Single assign / reassign submit
  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignModalTarget || !modalClientId || !modalConnectionId) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/client-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: modalClientId,
          provider: assignModalTarget.provider,
          accountId: assignModalTarget.accountId,
          connectionId: modalConnectionId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to assign account");

      toast.success(
        `Assigned account ${assignModalTarget.accountId} to client successfully.`
      );
      setAssignModalTarget(null);
      await Promise.all([
        mutate(accountsKey),
        mutate(clientsKey),
        mutate((key) => typeof key === "string" && key.includes("/api/reports")),
      ]);
    } catch (err: any) {
      toast.error(err?.message || "Failed to assign account");
    } finally {
      setSubmitting(false);
    }
  };

  // Bulk assign submit
  const handleBulkAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalClientId || selectedKeys.size === 0) return;

    const itemsToAssign: Array<{ provider: string; accountId: string; connectionId: string }> = [];

    for (const key of selectedKeys) {
      const [prov, accId] = key.split(":");
      const acc = allAccounts.find((a) => a.provider === prov && a.accountId === accId);
      if (acc && acc.availableConnections.length > 0) {
        itemsToAssign.push({
          provider: acc.provider,
          accountId: acc.accountId,
          connectionId: acc.authoritativeConnectionId || acc.availableConnections[0].id,
        });
      }
    }

    if (itemsToAssign.length === 0) {
      toast.error("No valid connections found for selected accounts");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/client-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: modalClientId,
          items: itemsToAssign,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Bulk assignment failed");

      toast.success(`Successfully assigned ${itemsToAssign.length} accounts.`);
      setIsBulkAssignModalOpen(false);
      setSelectedKeys(new Set());
      await Promise.all([
        mutate(accountsKey),
        mutate(clientsKey),
        mutate((key) => typeof key === "string" && key.includes("/api/reports")),
      ]);
    } catch (err: any) {
      toast.error(err?.message || "Failed to bulk assign accounts");
    } finally {
      setSubmitting(false);
    }
  };

  // Switch authoritative connection submit
  const handleSwitchSourceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!switchSourceTarget || !modalConnectionId) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/client-accounts/switch-source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: switchSourceTarget.provider,
          accountId: switchSourceTarget.accountId,
          newConnectionId: modalConnectionId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to switch source");

      toast.success("Authoritative connection updated.");
      setSwitchSourceTarget(null);
      await Promise.all([
        mutate(accountsKey),
        mutate(clientsKey),
        mutate((key) => typeof key === "string" && key.includes("/api/reports")),
      ]);
    } catch (err: any) {
      toast.error(err?.message || "Failed to switch source");
    } finally {
      setSubmitting(false);
    }
  };

  // Unassign submit
  const handleConfirmUnassign = async () => {
    if (!unassignTarget) return;

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/client-accounts/unassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: unassignTarget.provider,
          accountId: unassignTarget.accountId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to unassign account");

      toast.success(`Unassigned account ${unassignTarget.accountId}.`);
      setUnassignTarget(null);
      await Promise.all([
        mutate(accountsKey),
        mutate(clientsKey),
        mutate((key) => typeof key === "string" && key.includes("/api/reports")),
      ]);
    } catch (err: any) {
      toast.error(err?.message || "Failed to unassign account");
    }
  };

  return (
    <div className="space-y-4">
      {/* ─── FILTERS & CONTROLS ─── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Client Filter Dropdown */}
          <div className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs">
            <Building2 className="h-3.5 w-3.5 text-ink-mute" />
            <span className="text-ink-mute">Client:</span>
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="bg-transparent font-medium text-ink focus:outline-none cursor-pointer"
            >
              <option value="all">All clients ({allAccounts.length})</option>
              <option value="unassigned">
                Unassigned ({accountsData?.unassignedCount ?? 0})
              </option>
              {clientsList.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>

          {/* Provider Filter Dropdown */}
          {discoveredProviders.length > 1 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs">
              <Layers className="h-3.5 w-3.5 text-ink-mute" />
              <span className="text-ink-mute">Provider:</span>
              <select
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                className="bg-transparent font-medium text-ink focus:outline-none cursor-pointer capitalize"
              >
                <option value="all">All providers</option>
                {discoveredProviders.map((p) => (
                  <option key={p} value={p}>
                    {p.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Bulk Action Trigger */}
          {selectedKeys.size > 0 && (
            <button
              type="button"
              onClick={() => {
                setModalClientId(clientsList[0]?.id || "");
                setIsBulkAssignModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-white hover:bg-neutral-200 px-3 py-1.5 text-xs font-semibold text-black shadow-xs transition-colors"
            >
              <Users className="h-3.5 w-3.5" />
              Assign {selectedKeys.size} selected…
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-mute" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search account name or ID…"
            className="w-full rounded-lg border border-line bg-panel pl-8 pr-3 py-1.5 text-xs text-ink placeholder:text-ink-mute focus:border-white focus:outline-none"
          />
        </div>
      </div>

      {/* ─── TABLE ─── */}
      {accountsLoading ? (
        <div className="py-16 text-center text-sm text-ink-mute">
          Discovering provider accounts across workspace sources…
        </div>
      ) : accountsError ? (
        <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-4 text-sm text-red-200">
          Failed to load accounts.
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-line bg-panel py-16 text-center">
          <Users className="w-10 h-10 text-ink-mute mb-3" />
          <h3 className="text-sm font-semibold text-ink mb-1">No provider accounts found</h3>
          <p className="text-xs text-ink-mute max-w-sm">
            {searchQuery || selectedClientId !== "all" || providerFilter !== "all"
              ? "No accounts match the chosen filter."
              : "Connect a source to discover accessible provider accounts."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line bg-canvas/60 text-ink-mute uppercase tracking-wider font-mono text-[10px]">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all visible accounts"
                    className="rounded border-line bg-canvas accent-white cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3">Provider Account</th>
                <th className="px-4 py-3">Assigned Brand</th>
                <th className="px-4 py-3">Root Connection</th>
                <th className="px-4 py-3">Sync Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredAccounts.map((acc) => {
                const key = `${acc.provider}:${acc.accountId}`;
                const isSelected = selectedKeys.has(key);
                const logo = logoPathForConnectionProvider(acc.provider);
                const authConn = acc.availableConnections.find((c) => c.isAuthoritative) || acc.availableConnections[0];

                return (
                  <tr
                    key={key}
                    className={cn(
                      "transition-colors hover:bg-white/[0.02]",
                      isSelected && "bg-white/[0.04]"
                    )}
                  >
                    {/* Checkbox */}
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectOne(key)}
                        aria-label={`Select account ${acc.accountId}`}
                        className="rounded border-line bg-canvas accent-white cursor-pointer"
                      />
                    </td>

                    {/* Account Info */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <IntegrationMark src={logo} size="sm" />
                        <div className="min-w-0">
                          <p className="font-medium text-ink truncate max-w-xs sm:max-w-sm">
                            {acc.accountName}
                          </p>
                          <p className="font-mono text-[11px] text-ink-mute">
                            {acc.accountId}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Assigned Brand */}
                    <td className="px-4 py-3">
                      {acc.assignedClient ? (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded bg-white/[0.06] border border-line px-2 py-0.5 text-xs font-medium text-ink">
                            <Building2 className="h-3 w-3 text-ink-mute" />
                            {acc.assignedClient.name}
                          </span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-950/40 border border-amber-900/40 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                          <AlertTriangle className="h-3 w-3" />
                          Unassigned
                        </span>
                      )}
                    </td>

                    {/* Root Connection / Overlapping Warning */}
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-ink font-mono text-[11px]">
                          {authConn ? (
                            <span>{authConn.name}</span>
                          ) : (
                            <span className="text-ink-mute">None</span>
                          )}
                        </div>

                        {acc.hasMultipleRootConnections && (
                          <div className="flex items-center gap-1 text-[11px] text-amber-300 bg-amber-950/30 border border-amber-900/40 rounded px-1.5 py-0.5 w-fit">
                            <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
                            <span>
                              {acc.availableConnections.length} overlapping roots (MCC)
                            </span>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Sync Status */}
                    <td className="px-4 py-3">
                      {authConn ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                            authConn.status === "connected"
                              ? "bg-emerald-950/60 border border-emerald-800/40 text-emerald-300"
                              : "bg-red-950/60 border border-red-800/40 text-red-300"
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              authConn.status === "connected" ? "bg-emerald-400" : "bg-red-400"
                            )}
                          />
                          {authConn.status}
                        </span>
                      ) : (
                        <span className="text-ink-mute text-[11px]">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {!acc.isAssigned ? (
                          <button
                            type="button"
                            onClick={() => openAssignModal(acc)}
                            className="inline-flex items-center gap-1 rounded border border-line bg-canvas px-2 py-1 text-xs font-medium text-ink hover:bg-white/[0.06] transition-colors"
                          >
                            Assign
                          </button>
                        ) : (
                          <>
                            {acc.hasMultipleRootConnections && (
                              <button
                                type="button"
                                onClick={() => openSwitchSourceModal(acc)}
                                title="Change authoritative root connection"
                                className="inline-flex items-center gap-1 rounded border border-line bg-canvas px-2 py-1 text-xs font-medium text-ink-mute hover:text-ink hover:bg-white/[0.06] transition-colors"
                              >
                                <ArrowRightLeft className="h-3 w-3" />
                                Source
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openAssignModal(acc)}
                              className="inline-flex items-center gap-1 rounded border border-line bg-canvas px-2 py-1 text-xs font-medium text-ink hover:bg-white/[0.06] transition-colors"
                            >
                              Reassign
                            </button>
                            <button
                              type="button"
                              onClick={() => setUnassignTarget(acc)}
                              className="inline-flex items-center gap-1 rounded border border-line bg-canvas px-2 py-1 text-xs font-medium text-ink-mute hover:text-red-400 hover:bg-red-950/20 transition-colors"
                            >
                              Unassign
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── SINGLE ASSIGN / REASSIGN MODAL ─── */}
      {assignModalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-[2px]">
          <div className="relative w-full max-w-md rounded-lg border border-line bg-panel p-6 shadow-xl animate-in fade-in zoom-in-95">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-ink">
                  {assignModalTarget.isAssigned ? "Reassign Account" : "Assign Account"}
                </h2>
                <p className="mt-1 font-mono text-xs text-ink-mute">
                  {assignModalTarget.accountName} ({assignModalTarget.accountId})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssignModalTarget(null)}
                className="rounded p-1 text-ink-mute hover:text-ink hover:bg-white/[0.04]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAssignSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-ink mb-1.5">Target Client Brand</label>
                <select
                  value={modalClientId}
                  onChange={(e) => setModalClientId(e.target.value)}
                  className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-ink focus:border-white focus:outline-none"
                  required
                >
                  <option value="" disabled>Select client brand…</option>
                  {clientsList.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </div>

              {assignModalTarget.availableConnections.length > 1 && (
                <div>
                  <label className="block font-medium text-ink mb-1.5">
                    Authoritative Root Connection
                  </label>
                  <p className="text-[11px] text-ink-mute mb-2 leading-relaxed">
                    This account is visible under multiple root credentials (e.g. multiple MCCs). Select the authoritative root to ingest metrics from:
                  </p>
                  <select
                    value={modalConnectionId}
                    onChange={(e) => setModalConnectionId(e.target.value)}
                    className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-ink focus:border-white focus:outline-none"
                    required
                  >
                    {assignModalTarget.availableConnections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.status})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mt-6 flex justify-end gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  onClick={() => setAssignModalTarget(null)}
                  className="rounded-md border border-line bg-canvas px-3 py-1.5 font-medium text-ink-mute hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-white hover:bg-neutral-200 px-4 py-1.5 font-semibold text-black disabled:opacity-50"
                >
                  {submitting ? "Saving…" : "Confirm Assignment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── BULK ASSIGN MODAL ─── */}
      {isBulkAssignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-[2px]">
          <div className="relative w-full max-w-md rounded-lg border border-line bg-panel p-6 shadow-xl animate-in fade-in zoom-in-95">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-ink">Bulk Assign Accounts</h2>
                <p className="mt-1 text-xs text-ink-mute">
                  Assigning {selectedKeys.size} selected provider accounts to a brand.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsBulkAssignModalOpen(false)}
                className="rounded p-1 text-ink-mute hover:text-ink hover:bg-white/[0.04]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleBulkAssignSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-ink mb-1.5">Target Client Brand</label>
                <select
                  value={modalClientId}
                  onChange={(e) => setModalClientId(e.target.value)}
                  className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-ink focus:border-white focus:outline-none"
                  required
                >
                  <option value="" disabled>Select client brand…</option>
                  {clientsList.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-6 flex justify-end gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  onClick={() => setIsBulkAssignModalOpen(false)}
                  className="rounded-md border border-line bg-canvas px-3 py-1.5 font-medium text-ink-mute hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-white hover:bg-neutral-200 px-4 py-1.5 font-semibold text-black disabled:opacity-50"
                >
                  {submitting ? "Assigning…" : `Assign ${selectedKeys.size} Accounts`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── SWITCH SOURCE MODAL ─── */}
      {switchSourceTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-[2px]">
          <div className="relative w-full max-w-md rounded-lg border border-line bg-panel p-6 shadow-xl animate-in fade-in zoom-in-95">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-ink">
                  Change Authoritative Root Source
                </h2>
                <p className="mt-1 font-mono text-xs text-ink-mute">
                  {switchSourceTarget.accountName} ({switchSourceTarget.accountId})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSwitchSourceTarget(null)}
                className="rounded p-1 text-ink-mute hover:text-ink hover:bg-white/[0.04]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSwitchSourceSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-ink mb-1.5">
                  Select Authoritative Connection
                </label>
                <p className="text-[11px] text-ink-mute mb-2 leading-relaxed">
                  Only metrics synced through the selected connection will be attributed to{" "}
                  <strong>{switchSourceTarget.assignedClient?.name}</strong>.
                </p>
                <select
                  value={modalConnectionId}
                  onChange={(e) => setModalConnectionId(e.target.value)}
                  className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-ink focus:border-white focus:outline-none"
                  required
                >
                  {switchSourceTarget.availableConnections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.status}) {c.isAuthoritative ? "— (Current)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-6 flex justify-end gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  onClick={() => setSwitchSourceTarget(null)}
                  className="rounded-md border border-line bg-canvas px-3 py-1.5 font-medium text-ink-mute hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-white hover:bg-neutral-200 px-4 py-1.5 font-semibold text-black disabled:opacity-50"
                >
                  {submitting ? "Updating…" : "Update Authoritative Root"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── UNASSIGN CONFIRM DIALOG ─── */}
      <ConfirmDialog
        open={unassignTarget !== null}
        title={
          unassignTarget
            ? `Unassign ${unassignTarget.accountName}?`
            : "Unassign Account?"
        }
        description={`This will detach account ${unassignTarget?.accountId} from client "${unassignTarget?.assignedClient?.name}". The account will remain discovered but will no longer contribute to reporting for this client.`}
        confirmLabel="Unassign"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleConfirmUnassign}
        onCancel={() => setUnassignTarget(null)}
      />
    </div>
  );
}
