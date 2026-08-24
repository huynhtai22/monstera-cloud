import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleAlert, FileSpreadsheet, LineChart, RefreshCw, ShieldCheck } from "lucide-react";

const sectionClass = "scroll-mt-24 border-t border-line pt-12";

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4 rounded-lg border border-line bg-panel p-5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-canvas font-mono text-xs text-ink">{number}</span>
      <div><h3 className="text-sm font-semibold text-ink">{title}</h3><div className="mt-2 text-sm leading-relaxed text-ink-mute">{children}</div></div>
    </li>
  );
}

function Expected({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 flex gap-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] p-4 text-sm leading-relaxed text-ink-mute">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
      <p><strong className="text-ink">Expected result:</strong> {children}</p>
    </div>
  );
}

export default function DocsPage() {
  return (
    <article className="pb-24 text-ink">
      <header id="introduction" className="scroll-mt-24">
        <div className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Verified first-run guide</div>
        <h1 className="mt-5 text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">From connected source to verified report.</h1>
        <p className="mt-5 max-w-3xl text-pretty text-base leading-relaxed text-ink-mute">This guide is for operators and agencies connecting Meta Ads, Google Ads, TikTok Ads, or Shopee to a Monstera workspace, then reading the imported data in Data Explorer, Google Sheets, or Looker Studio.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-panel p-5"><ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden /><h2 className="mt-3 text-sm font-semibold">Before you begin</h2><p className="mt-2 text-xs leading-relaxed text-ink-mute">You need a Monstera workspace and permission to authorize the source account you intend to report on.</p></div>
          <div className="rounded-lg border border-line bg-panel p-5"><RefreshCw className="h-5 w-5 text-emerald-400" aria-hidden /><h2 className="mt-3 text-sm font-semibold">Pilot behavior</h2><p className="mt-2 text-xs leading-relaxed text-ink-mute">Manual refresh is available subject to your plan limits. Scheduled cadence is shown on the pricing page and in the product.</p></div>
        </div>
      </header>

      <section id="connect-source" className={`${sectionClass} mt-14`}>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute">Step 1</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">Connect one source</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-mute">Start with one certified workflow. Confirm current source coverage and limitations in the <Link href="/integrations" className="text-ink underline underline-offset-4">integration catalog</Link>.</p>
        <ol className="mt-6 space-y-3">
          <Step number={1} title="Open Sources">Sign in, choose the intended workspace, and open <strong className="text-ink">Sources</strong>.</Step>
          <Step number={2} title="Authorize the provider">Choose a supported source and complete its provider authorization. Select only accounts you are allowed to report on.</Step>
          <Step number={3} title="Confirm workspace ownership">After the callback, verify that the connection appears under <strong className="text-ink">Your sources</strong> in the same workspace.</Step>
        </ol>
        <Expected>The source shows as connected in the intended workspace. This confirms authorization; it does not yet prove that metric rows were imported.</Expected>
      </section>

      <section id="first-import" className={`${sectionClass} mt-12`}>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute">Step 2</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">Run the first warehouse import</h2>
        <ol className="mt-6 space-y-3"><Step number={1} title="Choose a practical window">Use a recent date range that contains known activity and stays within the workspace plan limit.</Step><Step number={2} title="Select the exact account">If the connection has multiple ad accounts or shops, select the one with known recent data.</Step><Step number={3} title="Start one refresh">Run a single manual refresh and wait for its final status. Avoid starting overlapping refreshes for the same connection.</Step></ol>
        <Expected>Sync activity records a completed run and reports its outcome. A successful authorization with zero rows can still mean the chosen account or window had no supported activity.</Expected>
      </section>

      <section id="verify-data" className={`${sectionClass} mt-12`}>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute">Step 3</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">Verify before building a report</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-mute">Open <strong className="text-ink">Data Explorer</strong>, select the same workspace, provider, account, and date window, then check:</p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">{["At least one row appears", "The earliest and latest dates match the import window", "Spend and delivery metrics are plausible", "The platform and account labels match your source"].map((item) => <li key={item} className="flex gap-3 rounded-lg border border-line bg-panel p-4 text-sm text-ink-mute"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />{item}</li>)}</ul>
        <Expected>The warehouse view matches a known provider report closely enough to proceed. Investigate material discrepancies before sharing a dashboard.</Expected>
      </section>

      <section id="sheets" className={`${sectionClass} mt-12`}>
        <div className="flex items-center gap-3"><FileSpreadsheet className="h-5 w-5 text-emerald-400" aria-hidden /><h2 className="text-3xl font-semibold tracking-tight">Google Sheets add-on</h2></div>
        <p className="mt-4 text-sm leading-relaxed text-ink-mute">The Sheets add-on signs in with a Google identity token generated by Apps Script. It does <strong className="text-ink">not</strong> require you to paste a workspace API key into the sidebar.</p>
        <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-mute"><li>Open the add-on in the active spreadsheet and complete Google authorization if prompted.</li><li>Use the Google account associated with the Monstera user or permitted pilot workflow.</li><li>Select the workspace and report filters, preview the query, then write the requested rows.</li></ol>
        <div className="mt-5 flex gap-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-4 text-sm leading-relaxed text-ink-mute"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden /><p>Never copy or share the identity token. If the sidebar reports an expired or invalid token, close and reopen it, then reauthorize the add-on. Persistent audience errors require an operator to verify the backend&apos;s exact allowed Google token audience.</p></div>
      </section>

      <section id="looker-studio" className={`${sectionClass} mt-12`}>
        <div className="flex items-center gap-3"><LineChart className="h-5 w-5 text-emerald-400" aria-hidden /><h2 className="text-3xl font-semibold tracking-tight">Looker Studio connector</h2></div>
        <p className="mt-4 text-sm leading-relaxed text-ink-mute">Looker Studio uses a workspace API key. Create or rotate the key under <strong className="text-ink">Settings → API</strong>, then enter it only in the Monstera connector credential prompt.</p>
        <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-mute"><li>Verify warehouse data first.</li><li>Create a workspace API key and store it securely.</li><li>Add the Monstera community connector, authenticate, and choose a date range.</li><li>Confirm the first chart totals against Data Explorer.</li></ol>
        <p className="mt-5"><Link href="/looker-studio" className="inline-flex items-center gap-2 rounded-md border border-line bg-panel px-4 py-2.5 text-xs font-semibold hover:border-white/25">Open the connector guide <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link></p>
      </section>

      <section id="partial-sync" className={`${sectionClass} mt-12`}><h2 className="text-3xl font-semibold tracking-tight">Partial or empty sync</h2><ul className="mt-5 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-mute"><li>Confirm the selected workspace, connection, account, and date window.</li><li>Check provider-side activity in the same window.</li><li>Review the integration limitation notes; not every provider object or metric is supported.</li><li>Read the final sync activity status before retrying. Do not treat “connected” as proof of imported metrics.</li></ul></section>
      <section id="expired-connection" className={`${sectionClass} mt-12`}><h2 className="text-3xl font-semibold tracking-tight">Expired or revoked connection</h2><p className="mt-4 text-sm leading-relaxed text-ink-mute">If the provider revoked access or refresh credentials can no longer be renewed, reconnect that source from its setup page. Confirm the returned connection stays in the intended workspace, then run one bounded verification import.</p></section>
      <section id="limits-support" className={`${sectionClass} mt-12`}><h2 className="text-3xl font-semibold tracking-tight">Limits and support</h2><p className="mt-4 text-sm leading-relaxed text-ink-mute">Connection, seat, pipeline, query, and date-range limits vary by workspace plan. Review the <Link href="/pricing" className="text-ink underline underline-offset-4">configured plan limits</Link>. During the private pilot, connector access and paid entitlements are confirmed with an operator.</p><div className="mt-7 flex flex-col gap-3 sm:flex-row"><Link href="/support" className="inline-flex items-center justify-center rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-neutral-200">Contact support</Link><Link href="/integrations" className="inline-flex items-center justify-center rounded-md border border-line bg-panel px-5 py-2.5 text-sm font-semibold hover:border-white/25">Check integration coverage</Link></div></section>
    </article>
  );
}
