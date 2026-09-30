"use client";

import { useMemo, useState } from "react";
import { SessionContext } from "next-auth/react";
import { SWRConfig } from "swr";
import { AppLayout } from "@/components/AppLayout";
import { ConnectSourceModal } from "@/components/ConnectSourceModal";
import { ConnectedSourceList } from "@/components/sources/ConnectedSourceList";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";
import { toast } from "sonner";
import { ConsoleOverview } from "@/components/dashboard/ConsoleOverview";
import { previewOverview, previewStates, type PreviewState } from "../console/fixtures";

const sampleSession = {
  user: { id: "local-ui-preview", name: "Alex Morgan", email: "preview@example.com", isAdmin: false },
  expires: "2099-01-01T00:00:00.000Z",
};
const previewCache = () => new Map();
const workspace = { ...previewOverview("Overview").workspace, role: "owner", _count: { connections: 4, pipelines: 4, clients: 2 } };

export function UpdatedConsolePreview({ referenceNow }: { referenceNow: number }) {
  const [view, setView] = useState("dashboard");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<PreviewState>("Overview");
  const [updating, setUpdating] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const overview = useMemo(() => {
    const sample = previewOverview(state);
    const offset = referenceNow - new Date("2026-09-30T13:50:00Z").getTime();
    const shift = (value: unknown): unknown => {
      if (typeof value === "string" && /^2026-09-\d{2}/.test(value)) { const date = new Date(new Date(value).getTime() + offset); return value.length === 10 ? date.toISOString().slice(0, 10) : date.toISOString(); }
      if (Array.isArray(value)) return value.map(shift);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shift(item)]));
      return value;
    };
    const current = shift(sample) as typeof sample;
    if (current.warehouseSnapshot.lastRefreshAt) {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(current.warehouseSnapshot.lastRefreshAt));
      current.warehouseSnapshot.dataThroughDate = day;
      current.summaryCards.warehouse.dataThroughDate = day;
      current.pilotActivation.dataThroughDate = day;
    }
    current.summaryCards.syncs.lastSyncTimeAgo = null;
    return current;
  }, [state, referenceNow]);
  return <SessionContext.Provider value={{ data: sampleSession, status: "authenticated", update: async () => sampleSession }}>
    <div onClickCapture={event => {
      const link = (event.target as HTMLElement).closest("a");
      const href = link?.getAttribute("href");
      if (!href?.startsWith("/")) return;
      event.preventDefault(); event.stopPropagation();
      if (href === "/sources" && /Add source|Connect/i.test(link?.textContent ?? "")) setPickerOpen(true);
      else if (href.startsWith("/sources")) setView("sources");
      else if (href.startsWith("/console")) setView("dashboard");
      else toast.message("This local preview covers Dashboard and Sources.");
    }}>
    <SWRConfig value={{ provider: previewCache, isPaused: () => true, fallback: { "/api/workspaces": [workspace] }, revalidateOnMount: false, revalidateOnFocus: false, revalidateOnReconnect: false, refreshInterval: 0 }}>
      <AppLayout visualPreview previewTitle={view === "sources" ? "Sources" : "Dashboard"}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-6 py-3 text-xs text-ink-mute">
          <span>Updated console · Sample data <button className="ml-3 underline" onClick={() => setView("dashboard")}>Dashboard</button> <button className="ml-3 underline" onClick={() => setView("sources")}>Sources</button></span>
          <label className="flex items-center gap-2">View state
            <select aria-label="Console preview state" value={state} onChange={event => setState(event.target.value as PreviewState)} className="rounded-md border border-line bg-canvas px-3 py-2 text-ink">
              {previewStates.map(option => <option key={option}>{option}</option>)}
            </select>
          </label>
        </div>
        <div key={view} className="console-route-enter">{view === "sources" ? <div className="p-6"><div className="mb-6 flex items-center justify-between"><h1 className="text-3xl text-ink">Sources</h1><button className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-canvas" onClick={() => setPickerOpen(true)}>Add source</button></div><ConnectedSourceList rows={overview.sourcesList.map(source => ({ id: source.id, name: source.name, provider: source.provider, catalogId: source.provider, status: source.state, healthState: source.state, managerBadge: source.managerBadge, lastSync: source.lastSyncAt ?? undefined, accountCount: source.accountCount, logoSrc: logoPathForConnectionProvider(source.provider) }))} searchQuery={query} onSearchChange={setQuery} busyActions={new Set()} onSync={() => toast.message("Sample sync requested")} onDirectSync={() => toast.message("Sample sync requested")} onDisconnect={() => toast.message("Preview only — no connection changed")} onFixConnection={() => toast.message("Sample reconnect — no OAuth request sent")} onBulkReconnect={() => toast.message("Sample bulk reconnect — no OAuth request sent")} /></div> : <ConsoleOverview overview={overview} isUpdating={updating} onRefresh={() => { setUpdating(true); setTimeout(() => setUpdating(false), 1400); }} wizardDismissed={dismissed} onWizardDismiss={() => setDismissed(true)} onWizardResume={() => setDismissed(false)} onReconnect={() => setState("Overview")} />}</div>
      <ConnectSourceModal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} integration={null} previewMode />
      </AppLayout>
    </SWRConfig>
    </div>
  </SessionContext.Provider>;
}
