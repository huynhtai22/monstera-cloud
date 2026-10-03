"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { validRecoveryWindow } from "@/lib/console-recovery";
import { ClientReportReadiness } from "./ReportReadinessPanel";

export function ReportReadinessView({ workspaceId, clients, clientId, onClientChange, onWindowChange }: {
  workspaceId: string;
  clients: Array<{ id: string; name: string }>;
  clientId: string;
  onClientChange: (id: string) => void;
  onWindowChange: (changes: Record<string, string | null>) => void;
}) {
  const search = useSearchParams();
  const defaults = useMemo(() => {
    const end = new Date();
    end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }, []);
  const start = search.get("startDate") ?? search.get("since") ?? defaults.start;
  const end = search.get("endDate") ?? search.get("until") ?? defaults.end;
  const window = validRecoveryWindow(start, end);
  return <section aria-label="Reporting window" className="rounded-xl border border-line bg-panel p-4 sm:p-5">
    <div className="flex flex-wrap items-end gap-4">
      <label className="min-w-0 text-xs text-ink-mute">Reporting client
        <select aria-label="Reporting client" value={clientId} onChange={event => onClientChange(event.target.value)} className="mt-1 block max-w-full rounded-md border border-line bg-canvas p-2 text-ink">
          <option value="">Choose a client</option>
          {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
      </label>
      <label className="text-xs text-ink-mute">From<input aria-label="Readiness start date" type="date" value={start} onChange={event => onWindowChange({ startDate: event.target.value, endDate: end, since: null, until: null })} className="mt-1 block rounded-md border border-line bg-canvas p-2 text-ink" /></label>
      <label className="text-xs text-ink-mute">Through<input aria-label="Readiness end date" type="date" value={end} onChange={event => onWindowChange({ startDate: start, endDate: event.target.value, since: null, until: null })} className="mt-1 block rounded-md border border-line bg-canvas p-2 text-ink" /></label>
    </div>
    {!window ? <p role="alert" className="mt-4 text-sm text-ink-mute">Choose valid dates with the start on or before the end.</p> : !clientId ? <p className="mt-4 text-sm text-ink-mute">Choose a client to check account coverage and reporting evidence.</p> : <ClientReportReadiness workspaceId={workspaceId} clientId={clientId} start={window.start} end={window.end} />}
  </section>;
}
