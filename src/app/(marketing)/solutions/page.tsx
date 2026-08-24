import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, Store } from "lucide-react";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Solutions for teams and agencies",
  description: "Workspace-scoped advertising reporting workflows for growing teams and agencies managing distinct client data.",
  alternates: { canonical: `${PRODUCT_SITE_URL}/solutions` },
};

const SOLUTIONS = [
  { icon: Store, title: "Marketing and commerce teams", description: "Connect a certified source, verify its warehouse rows, and use the result in the reporting tools your team already knows.", href: "/solutions/smes", cta: "Explore the team workflow" },
  { icon: Building2, title: "Agencies", description: "Keep client sources, credentials, metrics, and reporting access separated by workspace while standardizing the operating process.", href: "/solutions/agencies", cta: "Explore the agency workflow" },
] as const;

export default function SolutionsPage() {
  return (
    <div className="min-h-screen bg-canvas px-4 pb-24 pt-24 text-ink sm:px-6 sm:pt-32 lg:px-8">
      <header className="mx-auto max-w-3xl text-center"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute">Solutions</p><h1 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">A clearer operating path from source to report.</h1><p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-ink-mute">Monstera gives teams a workspace-scoped warehouse, visible sync outcomes, and supported delivery paths to Google Sheets and Looker Studio.</p></header>
      <section className="mx-auto mt-14 grid max-w-5xl gap-5 md:grid-cols-2" aria-label="Solutions by audience">
        {SOLUTIONS.map(({ icon: Icon, title, description, href, cta }) => <article key={title} className="rounded-xl border border-line bg-panel p-7"><Icon className="h-6 w-6 text-emerald-400" aria-hidden /><h2 className="mt-7 text-2xl font-semibold">{title}</h2><p className="mt-3 text-sm leading-relaxed text-ink-mute">{description}</p><Link href={href} className="mt-7 inline-flex items-center text-sm font-semibold text-ink hover:text-white">{cta}<ArrowRight className="ml-2 h-4 w-4" aria-hidden /></Link></article>)}
      </section>
      <p className="mx-auto mt-10 max-w-3xl text-center text-xs leading-relaxed text-ink-mute">Available provider coverage varies by source and pilot approval. Review the <Link href="/integrations" className="text-ink underline underline-offset-4">certified integration catalog</Link> before planning a workflow.</p>
    </div>
  );
}
