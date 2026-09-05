"use client";

import Link from "next/link";
import useSWR from "swr";
import { ReportingConfiguration } from "./ReportingConfiguration";
import { cn } from "@/lib/utils";
import { READINESS_MESSAGES, type ReportReadinessEvaluation, type ReportReadinessStatus } from "@/lib/report-readiness";

const styles: Record<ReportReadinessStatus, string> = {
  READY: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  NOT_READY: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
  WARNING: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  UNKNOWN: "border-line bg-canvas text-ink-mute",
};
const labels: Record<ReportReadinessStatus, string> = { READY: "Ready", NOT_READY: "Not ready", WARNING: "Review needed", UNKNOWN: "Unknown" };
export async function readinessFetcher(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Readiness unavailable");
  return res.json();
}
const time = (value: string | null) => value ? new Date(value).toLocaleString() : "Not recorded";

export function ReportReadinessPanel({ evaluation, loading, error, onRetry, compact = false }: {
  evaluation?: ReportReadinessEvaluation; loading?: boolean; error?: boolean; onRetry?: () => void; compact?: boolean;
}) {
  const configuration = evaluation ? <ReportingConfiguration key={`${evaluation.workspaceId}:${evaluation.clientId}`} workspaceId={evaluation.workspaceId} clientId={evaluation.clientId} onSaved={onRetry} /> : null;
  if (error) return <section aria-label="Report readiness" className="my-3 rounded-lg border border-line bg-canvas p-3 text-xs text-ink-mute">
    <p role="alert">Readiness unavailable. Do not rely on an earlier result.</p>
    {onRetry ? <button type="button" onClick={onRetry} className="mt-2 underline">Retry readiness</button> : null}
    {configuration}
  </section>;
  if (loading) return <section aria-label="Report readiness" aria-busy="true" className="my-3 rounded-lg border border-line p-3 text-xs text-ink-mute">Checking report readiness…{configuration}</section>;
  if (!evaluation) return <section aria-label="Report readiness" className="my-3 rounded-lg border border-line p-3 text-xs text-ink-mute">Readiness unknown. Open this client’s report to evaluate its data.</section>;
  const issue = evaluation.blockers[0] ?? evaluation.warnings[0];
  return <section aria-label="Report readiness" className="my-3 min-w-0 rounded-xl border border-line bg-canvas/50 p-3 sm:p-4" data-readiness={evaluation.status}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-xs font-semibold text-ink">Report readiness</h4>
      <span className={cn("rounded-md border px-2 py-1 text-xs font-medium", styles[evaluation.status])}>{labels[evaluation.status]}</span>
    </div>
    <p className="mt-2 text-xs leading-relaxed text-ink-mute">{issue ? READINESS_MESSAGES[issue.code] : "Saved evidence meets all readiness checks for this window."}</p>
    <p className="mt-2 text-[11px] text-ink-mute">{evaluation.window.start} — {evaluation.window.end} · Evaluated {time(evaluation.evaluatedAt)}</p>
    <details className="mt-3 text-xs text-ink-mute">
      <summary className="cursor-pointer font-medium text-ink">Inspect evidence{evaluation.providers.length ? ` (${evaluation.providers.length} sources)` : ""}</summary>
      <div className="mt-3 space-y-3 break-words">
        <p>Required providers: {evaluation.requiredProviders.join(", ") || "None assigned"}. Scope: {evaluation.requiredProvidersBasis === "assigned_sources" ? "assigned client sources" : "explicit"}.</p>
        <p>Currency: {evaluation.currencies.join(", ") || "unknown"} · Timezone: {evaluation.timezones.join(", ") || "unknown"}</p>
        <p>Destination: {evaluation.destination.state} · {evaluation.destination.configuredCount} configured for this client.</p>
        <p>Required destinations: {evaluation.destination.required?.join(", ") || "Not configured"}</p>
        {evaluation.destination.receipts?.map(r => <p key={r.id}>{r.destination}: {r.current ? "Current retrieval" : "Stale retrieval"} · {time(r.retrievedAt)} · data through {r.dataThroughDate}</p>)}
        {[...evaluation.blockers, ...evaluation.warnings].map((item,index) => <p key={`${item.code}-${item.connectionId}-${index}`}>
          <span className="font-mono text-[10px]">{item.code}</span>{item.provider ? ` (${item.provider})` : ""}: {READINESS_MESSAGES[item.code]}
        </p>)}
        {evaluation.providers.map(provider => <details key={provider.connectionId} className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-ink">{provider.provider.replaceAll("_", " ")} · {labels[provider.status]}</summary>
          <dl className="mt-2 space-y-1">
            <div><dt className="inline">Health: </dt><dd className="inline">{provider.health} · Freshness: {provider.freshness}</dd></div>
            <div><dt className="inline">Latest successful sync: </dt><dd className="inline">{time(provider.latestSuccessfulSyncAt)}</dd></div>
            <div><dt className="inline">Latest warehouse date: </dt><dd className="inline">{provider.latestDataDate ?? "No rows"}</dd></div>
            <div><dt className="inline">Window rows: </dt><dd className="inline">{provider.evidence.rowCount}</dd></div>
          </dl>
          {provider.evidence.accounts.map(account => <p className="mt-2" key={account.accountId}>
            Account {account.accountId}: {account.health}; {account.presentDays}/{provider.evidence.expectedDays} dates.
            {account.missingDates.length ? ` Missing: ${account.missingDates.join(", ")}.` : ""}
          </p>)}
          {provider.evidence.syncs.map((sync,index) => <p className="mt-2" key={`${sync.id}-${index}`}>{sync.kind} · {sync.target} · {sync.status} · {time(sync.at)}</p>)}
          <Link className="mt-2 inline-block underline text-ink" href={`/sources/${encodeURIComponent(provider.connectionId)}`}>Review source</Link>
        </details>)}
        <p>Advisory check only. Retrieval receipts are not live provider certification, reconciliation, or proof of a rendered report.</p>
      </div>
    </details>
    {!compact && onRetry ? <button type="button" onClick={onRetry} className="mt-3 text-xs text-ink underline">Recheck saved evidence</button> : null}
    {configuration}
  </section>;
}

export function ClientReportReadiness({ workspaceId, clientId, start, end }: { workspaceId: string; clientId: string; start: string; end: string }) {
  const key = workspaceId && clientId ? `/api/reports/readiness?${new URLSearchParams({ workspaceId, clientId, start, end })}` : null;
  const { data, error, isLoading, isValidating, mutate } = useSWR<{ evaluation: ReportReadinessEvaluation }>(key, readinessFetcher, { keepPreviousData: false, errorRetryCount: 1 });
  if (!clientId) return null;
  // Never retain another workspace/window's green badge during a request or an error.
  const evaluation = data?.evaluation;
  const scoped = evaluation?.workspaceId === workspaceId && evaluation.clientId === clientId && evaluation.window.start === start && evaluation.window.end === end;
  return <ReportReadinessPanel evaluation={scoped ? evaluation : undefined} error={Boolean(error)} loading={isLoading || isValidating} onRetry={() => void mutate()} />;
}
