"use client";

import React, { useMemo } from "react";
import useSWR from "swr";
import { usePathname } from "next/navigation";
import { useWorkspaceStore } from "@/store/workspace";
import { cn } from "@/lib/utils";
import {
  ALL_CLIENTS_TOKEN,
  UNASSIGNED_CLIENT_TOKEN,
  surfaceAllowsAllClients,
  surfaceAllowsUnassigned,
  surfaceForPathname,
} from "@/lib/client-context";
import { useClientContextNavigation } from "./useClientContextNavigation";

const PROVIDER_LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  tiktok_business: "TikTok Ads",
  shopee: "Shopee",
  lazada: "Lazada",
  shopify: "Shopify",
  amazon: "Amazon",
};

type ClientListItem = {
  id: string;
  name: string;
  _count?: { accountAssignments?: number; connections?: number };
  accountAssignments?: Array<{ provider: string }>;
  connections?: Array<{ provider: string }>;
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to load clients");
  return data;
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.replace(/_/g, " ");
}

function uniqueProviders(client: ClientListItem): string[] {
  const fromAssignments = (client.accountAssignments ?? []).map((row) => row.provider);
  const fromConnections = (client.connections ?? []).map((row) => row.provider);
  return [...new Set([...fromAssignments, ...fromConnections].filter(Boolean))];
}

function assignedAccountCount(client: ClientListItem): number | null {
  const assigned = client._count?.accountAssignments;
  if (typeof assigned === "number") return assigned;
  if (Array.isArray(client.accountAssignments)) return client.accountAssignments.length;
  return null;
}

export function ClientContextBar() {
  const pathname = usePathname();
  const surface = surfaceForPathname(pathname ?? "");
  const { activeWorkspaceId } = useWorkspaceStore();
  const { requested, switchClient } = useClientContextNavigation();

  const clientsKey = activeWorkspaceId && surface ? `/api/clients?workspaceId=${activeWorkspaceId}` : null;
  const { data: clientsPayload, isLoading } = useSWR(clientsKey, fetcher);

  const clients = useMemo(() => {
    const raw = Array.isArray(clientsPayload)
      ? clientsPayload
      : Array.isArray(clientsPayload?.clients)
        ? clientsPayload.clients
        : [];
    return raw as ClientListItem[];
  }, [clientsPayload]);

  if (!surface) return null;

  const selected = requested.kind === "id"
    ? clients.find((client) => client.id === requested.raw) ?? null
    : null;
  const unavailable = requested.kind === "id" && !isLoading && !selected
    || requested.kind === "malformed"
    || (requested.kind === "unassigned" && !surfaceAllowsUnassigned(surface));
  const empty = !isLoading && clients.length === 0;
  const viewingUnassigned = requested.kind === "unassigned" && surfaceAllowsUnassigned(surface);

  const selectorValue = viewingUnassigned
    ? UNASSIGNED_CLIENT_TOKEN
    : selected
      ? selected.id
      : ALL_CLIENTS_TOKEN;

  const providers = selected ? uniqueProviders(selected) : [];
  const accountCount = selected ? assignedAccountCount(selected) : null;
  const scope = unavailable
    ? "unavailable"
    : empty
      ? "empty"
      : viewingUnassigned
        ? "unassigned"
        : selected
          ? "one"
          : "all";

  const summaryParts: string[] = [];
  if (selected && accountCount != null) {
    summaryParts.push(`${accountCount} assigned account${accountCount === 1 ? "" : "s"}`);
  }
  if (providers.length > 0) {
    summaryParts.push(providers.map(providerLabel).join(" · "));
  }

  return (
    <div
      data-testid="client-context-bar"
      data-client-scope={scope}
      className="border-b border-line bg-panel px-4 py-3 sm:px-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute">
            Client context
          </p>
          {isLoading ? (
            <p className="mt-1 text-sm text-ink-mute">Loading clients…</p>
          ) : empty ? (
            <p className="mt-1 text-sm text-ink">No clients in this workspace</p>
          ) : unavailable ? (
            <p className="mt-1 text-sm text-ink">This client is no longer available</p>
          ) : viewingUnassigned ? (
            <p className="mt-1 text-sm text-ink">Viewing: Unassigned accounts</p>
          ) : selected ? (
            <>
              <p className="mt-1 truncate text-sm font-semibold text-ink" title={selected.name}>
                Viewing: {selected.name}
              </p>
              {summaryParts.length > 0 ? (
                <p className="mt-0.5 truncate text-xs text-ink-mute" title={summaryParts.join(" · ")}>
                  {summaryParts.join(" · ")}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-1 text-sm font-semibold text-ink">Viewing: All clients</p>
              <p className="mt-0.5 text-xs text-ink-mute">Workspace-wide</p>
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-1 sm:w-64">
          <label htmlFor="client-context-selector" className="text-xs font-medium text-ink-mute">
            Switch client
          </label>
          <select
            id="client-context-selector"
            data-testid="client-context-selector"
            aria-label="Switch client"
            disabled={isLoading || empty}
            value={unavailable ? "" : selectorValue}
            onChange={(event) => {
              const value = event.target.value;
              if (!value) return;
              switchClient(value === ALL_CLIENTS_TOKEN ? ALL_CLIENTS_TOKEN : value);
            }}
            className={cn(
              "h-10 w-full max-w-full truncate rounded-lg border border-line bg-canvas px-3 text-sm text-ink",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {unavailable ? (
              <option value="">Client unavailable</option>
            ) : null}
            {surfaceAllowsAllClients(surface) ? (
              <option value={ALL_CLIENTS_TOKEN}>All clients</option>
            ) : null}
            {surfaceAllowsUnassigned(surface) ? (
              <option value={UNASSIGNED_CLIENT_TOKEN}>Unassigned accounts</option>
            ) : null}
            {clients.map((client) => (
              <option key={client.id} value={client.id} title={client.name}>
                {client.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
