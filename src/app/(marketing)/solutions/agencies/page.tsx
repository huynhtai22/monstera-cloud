import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, Database, ShieldCheck } from "lucide-react";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Workspace-scoped reporting for agencies",
  description: "Keep client advertising sources, warehouse metrics, and reporting credentials separated by Monstera workspace.",
  alternates: { canonical: `${PRODUCT_SITE_URL}/solutions/agencies` },
};

const STEPS = [
  ["Create the client boundary", "Use a distinct workspace for each client or brand and confirm the correct members before connecting a source."],
  ["Connect and verify", "Authorize one certified provider workflow, run a bounded import, and validate its rows in Data Explorer."],
  ["Deliver the report", "Use the Sheets add-on identity flow or a workspace API key for Looker Studio, then reconcile the first report."],
] as const;

export default function AgenciesSolutionPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <section className="border-b border-line px-4 pb-20 pt-28 text-center sm:px-6 sm:pb-24 sm:pt-36 lg:px-8"><div className="mx-auto max-w-4xl"><div className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute"><Building2 className="h-3.5 w-3.5" aria-hidden /> Agency workflow</div><h1 className="mt-6 text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">Separate client data. Standardize the reporting process.</h1><p className="mx-auto mt-5 max-w-3xl text-base leading-relaxed text-ink-mute">Monstera workspaces keep source connections, warehouse metrics, API keys, and sync activity scoped to the intended client boundary.</p><div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><Link href="/support?pilot=1&audience=agency" className="inline-flex items-center justify-center rounded-md bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-neutral-200">Request agency pilot access <ArrowRight className="ml-2 h-4 w-4" aria-hidden /></Link><Link href="/pricing" className="inline-flex items-center justify-center rounded-md border border-line bg-panel px-5 py-3 text-sm font-semibold hover:border-white/25">Compare workspace plans</Link></div></div></section>
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8"><div className="grid gap-5 md:grid-cols-3"><article className="rounded-xl border border-line bg-panel p-6"><ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden /><h2 className="mt-5 text-lg font-semibold">Workspace boundaries</h2><p className="mt-3 text-sm leading-relaxed text-ink-mute">Keep each client&apos;s connections and reporting credentials in its own workspace and assign only the required members.</p></article><article className="rounded-xl border border-line bg-panel p-6"><Database className="h-5 w-5 text-emerald-400" aria-hidden /><h2 className="mt-5 text-lg font-semibold">Normalized warehouse</h2><p className="mt-3 text-sm leading-relaxed text-ink-mute">Use consistent campaign dimensions for supported provider data while retaining source and account context.</p></article><article className="rounded-xl border border-line bg-panel p-6"><CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden /><h2 className="mt-5 text-lg font-semibold">Visible verification</h2><p className="mt-3 text-sm leading-relaxed text-ink-mute">Check sync outcome, date coverage, and row-level plausibility before a client report is refreshed or shared.</p></article></div></section>
      <section className="border-y border-line bg-panel/30 px-4 py-20 sm:px-6 lg:px-8"><div className="mx-auto max-w-5xl"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute">Recommended operating sequence</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">One repeatable handoff for every client.</h2><ol className="mt-8 grid gap-4 md:grid-cols-3">{STEPS.map(([title, description], index) => <li key={title} className="rounded-xl border border-line bg-canvas p-6"><span className="font-mono text-xs text-emerald-400">0{index + 1}</span><h3 className="mt-5 text-base font-semibold">{title}</h3><p className="mt-3 text-sm leading-relaxed text-ink-mute">{description}</p></li>)}</ol><p className="mt-8 text-xs leading-relaxed text-ink-mute">Pilot access, provider coverage, workspace capacity, and support expectations are confirmed before rollout.</p></div></section>
      <section className="px-4 py-20 text-center sm:px-6 lg:px-8"><h2 className="text-3xl font-semibold tracking-tight">Validate one client workflow first.</h2><p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-ink-mute">Use the first-run guide to connect, import, verify, and reconcile before expanding the pilot.</p><Link href="/docs" className="mt-7 inline-flex items-center justify-center rounded-md border border-line bg-panel px-5 py-2.5 text-sm font-semibold hover:border-white/25">Read the verification guide <ArrowRight className="ml-2 h-4 w-4" aria-hidden /></Link></section>
    </div>
  );
}
