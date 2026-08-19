"use client";

import { useState } from "react";
import useSWR from "swr";
import { Check, Copy } from "lucide-react";
import { formatRunDiagnostics, type RunRecord } from "@/lib/ingestion/runs";
import { describeNextAction } from "@/lib/ingestion/error-taxonomy";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type Ticket = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  status: string;
  reason: string;
  title: string;
  tag: string | null;
  errorMsg: string | null;
  runId: string | null;
  notes: string | null;
  createdAt: string;
};

export function AdminIncidentsPanel() {
  const { data, mutate, error } = useSWR("/api/admin/incidents", fetcher, { refreshInterval: 20_000 });
  const [busyId, setBusyId] = useState<string | null>(null);

  const summary = data?.summary ?? {
    openTickets: 0,
    acknowledgedTickets: 0,
    failedRuns24h: 0,
    staleSources: 0,
    oldQueuedJobs: 0,
  };
  const tickets = (data?.tickets ?? []) as Ticket[];
  const runs = (data?.runs ?? []) as RunRecord[];

  const updateTicket = async (id: string, status: string, notes?: string) => {
    setBusyId(id);
    try {
      await fetch("/api/admin/incidents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, notes }),
      });
      await mutate();
    } finally {
      setBusyId(null);
    }
  };

  if (error) {
    return <p className="text-sm text-red-600">Could not load incidents.</p>;
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Open tickets" value={summary.openTickets} tone="red" />
        <Stat label="Acknowledged" value={summary.acknowledgedTickets} tone="amber" />
        <Stat label="Failed runs (24h)" value={summary.failedRuns24h} tone="red" />
        <Stat label="Stale sources" value={summary.staleSources} tone="amber" />
        <Stat label="Queued > 15m" value={summary.oldQueuedJobs} tone="slate" />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          Tickets
        </h2>
        {tickets.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-8 text-sm text-ink-mute">
            No tickets yet. Auth failures, exhausted retries, and stale sources open tickets automatically.
          </p>
        ) : (
          <ul className="space-y-2">
            {tickets.map((ticket) => (
              <li
                key={ticket.id}
                className="rounded-lg border border-line bg-panel p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{ticket.title}</span>
                      <Badge status={ticket.status} />
                      {ticket.tag && <span className="font-mono text-[11px] text-slate-500">{ticket.tag}</span>}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {ticket.workspaceName} · {ticket.reason} · {new Date(ticket.createdAt).toLocaleString()}
                    </p>
                    {ticket.errorMsg && (
                      <p className="mt-2 line-clamp-2 font-mono text-xs text-red-600 dark:text-red-300">
                        {ticket.errorMsg}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ticket.status === "open" && (
                      <button
                        type="button"
                        disabled={busyId === ticket.id}
                        onClick={() => void updateTicket(ticket.id, "acknowledged")}
                        className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50"
                      >
                        Acknowledge
                      </button>
                    )}
                    {ticket.status !== "resolved" && (
                      <button
                        type="button"
                        disabled={busyId === ticket.id}
                        onClick={() => void updateTicket(ticket.id, "resolved")}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        Resolve
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  defaultValue={ticket.notes ?? ""}
                  placeholder="Operator notes…"
                  className="mt-3 w-full rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink"
                  rows={2}
                  onBlur={(event) => {
                    if (event.target.value !== (ticket.notes ?? "")) {
                      void updateTicket(ticket.id, ticket.status, event.target.value);
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          Failed and queued runs (24h)
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-500">No failed warehouse or pipeline runs in the last day.</p>
        ) : (
          <ul className="space-y-2">
            {runs.map((run) => (
              <li
                key={`${run.kind}-${run.id}`}
                className="flex items-start justify-between gap-3 rounded-2xl border border-red-100 bg-red-50/40 p-3 dark:border-red-900/40 dark:bg-red-950/20"
              >
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {run.title} <span className="text-xs font-normal uppercase text-slate-500">{run.status}</span>
                    {run.tag ? <span className="ml-2 font-mono text-[11px]">{run.tag}</span> : null}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    workspace {run.workspaceId} · {new Date(run.createdAt).toLocaleString()}
                    {describeNextAction(run.action) ? ` · ${describeNextAction(run.action)}` : ""}
                  </p>
                  {run.errorMsg && (
                    <p className="mt-1 line-clamp-2 font-mono text-xs text-red-700 dark:text-red-300">{run.errorMsg}</p>
                  )}
                </div>
                <CopyButton text={formatRunDiagnostics(run)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "red" | "amber" | "slate" }) {
  const colors = {
    red: "text-red-700 dark:text-red-300",
    amber: "text-amber-700 dark:text-amber-300",
    slate: "text-slate-800 dark:text-slate-200",
  };
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-ink-mute">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold ${colors[tone]}`}>{value}</p>
    </div>
  );
}

function Badge({ status }: { status: string }) {
  const style =
    status === "open"
      ? "border-red-500/30 text-red-300"
      : status === "acknowledged"
        ? "border-amber-500/30 text-amber-300"
        : "border-line text-accent";
  return <span className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium uppercase ${style}`}>{status}</span>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 dark:border-slate-700"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      IDs
    </button>
  );
}
