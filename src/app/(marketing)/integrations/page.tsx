import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { PUBLIC_INTEGRATIONS } from "@/lib/public-integrations";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Advertising data integrations",
  description:
    "Certified Monstera Cloud workflows for Meta Ads, Google Ads, TikTok Ads, and Shopee with Google Sheets and Looker Studio.",
  alternates: { canonical: `${PRODUCT_SITE_URL}/integrations` },
  openGraph: {
    title: "Advertising data integrations",
    description:
      "Compare certified source-to-destination reporting workflows in Monstera Cloud.",
    url: `${PRODUCT_SITE_URL}/integrations`,
  },
};

const SOURCE_SUMMARIES = [
  {
    name: "Meta Ads",
    summary: "Campaign and ad-set reporting with provider-defined attribution metrics.",
    slugs: ["meta-ads-to-google-sheets", "meta-ads-to-looker-studio"],
  },
  {
    name: "Google Ads",
    summary: "Campaign and ad-group performance for accessible customer accounts.",
    slugs: ["google-ads-to-google-sheets", "google-ads-to-looker-studio"],
  },
  {
    name: "TikTok Ads",
    summary: "Standard TikTok for Business campaign and ad-group reporting.",
    slugs: ["tiktok-ads-to-google-sheets", "tiktok-ads-to-looker-studio"],
  },
  {
    name: "Shopee",
    summary: "Daily order and revenue rollups, with best-effort Ads data when approved.",
    slugs: ["shopee-to-google-sheets", "shopee-to-looker-studio"],
  },
] as const;

export default function IntegrationsPage() {
  return (
    <div className="px-4 pb-24 pt-20 sm:px-6 sm:pt-24 lg:px-8">
      <section className="mx-auto max-w-4xl text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 font-mono text-[11px] text-ink-mute">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Pilot-certified workflows
        </div>
        <h1 className="text-balance text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl">
          Connect advertising data to the reporting tools your team already uses.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-sm leading-relaxed text-ink-mute sm:text-base">
          Monstera currently certifies four source connectors for pilot use. Choose a workflow to review its data coverage,
          setup requirements, and limitations before connecting an account.
        </p>
      </section>

      <section className="mx-auto mt-14 max-w-5xl" aria-labelledby="certified-integrations">
        <h2 id="certified-integrations" className="sr-only">Certified integrations</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {SOURCE_SUMMARIES.map((source) => {
            const workflows = source.slugs
              .map((slug) => PUBLIC_INTEGRATIONS.find((entry) => entry.slug === slug))
              .filter((entry): entry is (typeof PUBLIC_INTEGRATIONS)[number] => Boolean(entry));
            return (
              <article key={source.name} className="rounded-xl border border-line bg-panel p-6">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-lg font-semibold text-ink">{source.name}</h3>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-2.5 py-1 font-mono text-[10px] text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" aria-hidden />
                    Pilot certified
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-ink-mute">{source.summary}</p>
                <div className="mt-6 space-y-2 border-t border-line pt-5">
                  {workflows.map((workflow) => (
                    <Link
                      key={workflow.slug}
                      href={`/integrations/${workflow.slug}`}
                      className="group flex items-center justify-between rounded-md border border-line bg-canvas px-4 py-3 text-sm text-ink transition-colors hover:border-white/25 hover:bg-white/[0.03]"
                    >
                      <span>{workflow.destination}</span>
                      <ArrowRight className="h-4 w-4 text-ink-mute transition-transform group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
                    </Link>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
        <div className="mt-8 rounded-xl border border-amber-300/20 bg-amber-300/[0.04] p-5 text-sm leading-relaxed text-ink-mute">
          TikTok Shop, Lazada, Shopify, and Amazon are not listed here because their product flags remain uncertified or
          disabled by default. They will only appear publicly after the corresponding live-account workflow is verified.
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-4xl rounded-2xl border border-line bg-panel px-6 py-10 text-center sm:px-10">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">Not sure which workflow to start with?</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-ink-mute">
          Review the setup guide, then request pilot access with the sources and destination you need.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/docs" className="rounded-md border border-line bg-canvas px-5 py-2.5 text-sm font-medium text-ink hover:border-white/25">
            Read setup documentation
          </Link>
          <Link href="/support?pilot=1" className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-neutral-200">
            Request pilot access
          </Link>
        </div>
      </section>
    </div>
  );
}
