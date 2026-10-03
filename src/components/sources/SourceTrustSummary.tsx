import Link from "next/link";
import type { SourceState } from "@/lib/source-list-display";
import { sourceTrustFacts } from "@/lib/console-recovery";

export function SourceTrustSummary({ state, lastSync, dataThrough, reportsHref, compact = false }: {
  state: SourceState; lastSync?: string | null; dataThrough?: string | null; reportsHref: string; compact?: boolean;
}) {
  const facts = sourceTrustFacts(state, lastSync, dataThrough);
  return <div className="min-w-0 text-xs" aria-label="Source data checks">
    <dl className={compact ? "mt-2 space-y-1 text-[11px]" : "grid gap-4 sm:grid-cols-2 xl:grid-cols-4"}>
      <div><dt className="text-ink-mute">Authorization</dt><dd className="mt-1 text-ink">{facts.authorization}</dd></div>
      <div><dt className="text-ink-mute">Latest successful import</dt><dd className="mt-1 text-ink">{facts.latestSuccessfulImport ? <time dateTime={facts.latestSuccessfulImport}>{new Date(facts.latestSuccessfulImport).toLocaleString()}</time> : "Not confirmed"}</dd></div>
      <div><dt className="text-ink-mute">Data through</dt><dd className="mt-1 text-ink">{facts.dataThrough ?? "Not confirmed"}</dd></div>
      <div><dt className="text-ink-mute">Report readiness</dt><dd className="mt-1"><Link className="text-ink underline underline-offset-4" href={reportsHref}>Check client and date window</Link></dd></div>
    </dl>
    {!compact && <p className="mt-3 text-[11px] leading-relaxed text-ink-mute">Source-wide saved evidence. The latest data date does not establish complete coverage for every account or date. Report checks evaluate the selected client and reporting window.</p>}
  </div>;
}
