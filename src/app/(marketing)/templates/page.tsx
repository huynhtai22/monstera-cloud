import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BarChart3, CheckCircle2, ClipboardCheck, Layers3 } from "lucide-react";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Reporting workflow examples",
  description: "Practical reporting patterns you can build from verified Monstera warehouse data in Google Sheets or Looker Studio.",
  alternates: { canonical: `${PRODUCT_SITE_URL}/templates` },
};

const EXAMPLES = [
  { icon: Layers3, title: "Cross-channel performance review", goal: "Compare campaign delivery across certified ad sources without mixing unsupported provider metrics.", fields: ["Date, platform, account, campaign", "Spend, impressions, clicks, conversions", "Source freshness and selected window"] },
  { icon: ClipboardCheck, title: "Data freshness checklist", goal: "Give an operator a repeatable way to verify a refresh before sharing the report.", fields: ["Last completed sync", "Earliest and latest metric dates", "Expected account and platform labels"] },
  { icon: BarChart3, title: "Client reporting handoff", goal: "Keep each client workspace and credential boundary clear while delivering a familiar report surface.", fields: ["One client workspace", "One verified source window", "Sheets or Looker Studio destination"] },
] as const;

export default function TemplatesPage() {
  return (
    <div className="min-h-screen bg-canvas px-4 pb-24 pt-24 text-ink sm:px-6 sm:pt-32 lg:px-8">
      <header className="mx-auto max-w-3xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Workflow examples</div>
        <h1 className="mt-5 text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">Start with a report you can verify.</h1>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-ink-mute">These are implementation patterns—not one-click downloadable templates. Build them after your source import passes the verification steps in the documentation.</p>
      </header>

      <section className="mx-auto mt-14 grid max-w-6xl gap-5 md:grid-cols-3" aria-label="Reporting workflow examples">
        {EXAMPLES.map(({ icon: Icon, title, goal, fields }) => (
          <article key={title} className="flex h-full flex-col rounded-xl border border-line bg-panel p-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-canvas"><Icon className="h-5 w-5 text-emerald-400" aria-hidden /></span>
            <h2 className="mt-6 text-lg font-semibold">{title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-mute">{goal}</p>
            <ul className="mt-6 space-y-3 border-t border-line pt-5 text-xs leading-relaxed text-ink-mute">{fields.map((field) => <li key={field} className="flex gap-2.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />{field}</li>)}</ul>
          </article>
        ))}
      </section>

      <section className="mx-auto mt-16 max-w-4xl rounded-2xl border border-line bg-panel p-8 text-center sm:p-12">
        <h2 className="text-2xl font-semibold tracking-tight">Build from known-good data.</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-ink-mute">Connect one certified source, run a bounded import, verify its rows, then choose the destination that fits your team.</p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row"><Link href="/docs" className="inline-flex items-center justify-center rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-neutral-200">Follow the first-run guide <ArrowRight className="ml-2 h-4 w-4" aria-hidden /></Link><Link href="/integrations" className="inline-flex items-center justify-center rounded-md border border-line bg-canvas px-5 py-2.5 text-sm font-semibold hover:border-white/25">Check integration coverage</Link></div>
      </section>
    </div>
  );
}
