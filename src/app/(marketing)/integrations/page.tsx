import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleAlert,
  Database,
  FileSpreadsheet,
  ShieldCheck,
} from "lucide-react";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { PUBLIC_INTEGRATIONS } from "@/lib/public-integrations";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Advertising data integrations",
  description:
    "Choose a verified Monstera Cloud route from Meta Ads, Google Ads, TikTok Ads, or Shopee to Google Sheets or Looker Studio.",
  alternates: { canonical: `${PRODUCT_SITE_URL}/integrations` },
  openGraph: {
    title: "Advertising data integrations",
    description:
      "Four pilot-ready sources, two reporting destinations, and one verifiable data path.",
    url: `${PRODUCT_SITE_URL}/integrations`,
  },
};

const SOURCES = [
  {
    name: "Meta Ads",
    logo: INTEGRATION_LOGOS.meta,
    coverage: "Daily campaign and ad-set reporting",
    note: "Attribution remains provider-defined",
    sheetsSlug: "meta-ads-to-google-sheets",
    lookerSlug: "meta-ads-to-looker-studio",
    status: "Pilot ready",
    statusTone: "ready",
  },
  {
    name: "Google Ads",
    logo: INTEGRATION_LOGOS.googleAds,
    coverage: "Daily campaign and ad-group reporting",
    note: "Requires access to the selected customer account",
    sheetsSlug: "google-ads-to-google-sheets",
    lookerSlug: "google-ads-to-looker-studio",
    status: "Pilot ready",
    statusTone: "ready",
  },
  {
    name: "TikTok Ads",
    logo: INTEGRATION_LOGOS.tiktok,
    coverage: "Standard campaign and ad-group reporting",
    note: "GMV Max remains outside the certified route",
    sheetsSlug: "tiktok-ads-to-google-sheets",
    lookerSlug: "tiktok-ads-to-looker-studio",
    status: "Standard reports",
    statusTone: "ready",
  },
  {
    name: "Shopee",
    logo: INTEGRATION_LOGOS.shopee,
    coverage: "Daily order count and revenue rollups",
    note: "Ads metrics depend on Partner Center approval",
    sheetsSlug: "shopee-to-google-sheets",
    lookerSlug: "shopee-to-looker-studio",
    status: "Ads conditional",
    statusTone: "conditional",
  },
] as const;

const DESTINATIONS = [
  {
    name: "Google Sheets™",
    logo: INTEGRATION_LOGOS.googleSheets,
    icon: FileSpreadsheet,
    label: "Hands-on workflow",
    outcome: "Best when the team needs flexible analysis, recurring client exports, and spreadsheet modeling.",
  },
  {
    name: "Looker Studio™",
    logo: INTEGRATION_LOGOS.looker,
    icon: BarChart3,
    label: "Dashboard workflow",
    outcome: "Best when clients and stakeholders need a shared dashboard over synchronized workspace data.",
  },
] as const;

function integrationPath(slug: string) {
  return PUBLIC_INTEGRATIONS.some((entry) => entry.slug === slug)
    ? `/integrations/${slug}`
    : "/integrations";
}

export default function IntegrationsPage() {
  return (
    <div className="pb-24 pt-20">
      <section className="relative overflow-hidden border-b border-line px-4 pb-16 pt-12 sm:px-6 sm:pb-20 sm:pt-16 lg:px-8">
        <div className="pointer-events-none absolute left-1/2 top-16 h-80 w-80 -translate-x-1/2 rounded-full bg-white/[0.035] blur-3xl" />
        <div className="relative mx-auto max-w-5xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 font-mono text-[11px] text-ink-mute">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            8 verified pilot routes
          </div>
          <h1 className="text-balance text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl md:text-6xl">
            Four sources. Two destinations.
            <span className="block text-neutral-400">One data path you can verify.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-sm leading-relaxed text-ink-mute sm:text-base">
            Choose where your data starts and where your team needs it. Monstera handles the workspace-scoped import in between, with visible outcomes before you report on it.
          </p>
        </div>

        <div className="relative mx-auto mt-12 grid max-w-5xl items-stretch gap-3 md:grid-cols-[1fr_1.15fr_1fr]">
          <div className="rounded-xl border border-line bg-panel p-5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-mute">01 · Choose a source</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {SOURCES.map((source) => (
                <div key={source.name} className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2.5">
                  <IntegrationMark src={source.logo} alt="" size="sm" />
                  <span className="text-xs font-medium text-ink">{source.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative rounded-xl border border-white/20 bg-panel p-5 shadow-xl shadow-black/20 ring-1 ring-white/5">
            <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-mute">02 · Verify in Monstera</p>
                <h2 className="mt-3 text-lg font-semibold tracking-tight text-ink">A reporting workspace between APIs and dashboards</h2>
              </div>
              <span className="rounded-lg border border-line bg-canvas p-2.5"><Database className="h-5 w-5 text-neutral-300" /></span>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
              {["Import outcome", "Metric dates", "Row count"].map((label) => (
                <div key={label} className="bg-canvas px-2 py-3 text-center font-mono text-[9px] text-ink-mute sm:text-[10px]">{label}</div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-line bg-panel p-5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-mute">03 · Choose an outcome</p>
            <div className="mt-4 space-y-2">
              {DESTINATIONS.map((destination) => (
                <div key={destination.name} className="flex items-center gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5">
                  <IntegrationMark src={destination.logo} alt="" size="sm" />
                  <div>
                    <p className="text-xs font-medium text-ink">{destination.name}</p>
                    <p className="mt-0.5 font-mono text-[9px] text-ink-mute">{destination.label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8" aria-labelledby="route-heading">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute">Route directory</p>
              <h2 id="route-heading" className="mt-3 text-3xl font-semibold tracking-tight text-ink">Pick the route you want to inspect</h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-mute">Each route opens its exact coverage, setup requirements, limitations, and verification steps.</p>
            </div>
            <div className="inline-flex items-center gap-2 self-start rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-[10px] text-ink-mute sm:self-auto">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              Read-only reporting workflows
            </div>
          </div>

          <div className="mt-8 overflow-hidden rounded-xl border border-line bg-panel">
            <div className="hidden grid-cols-[1.05fr_1.6fr_.8fr_.8fr] border-b border-line bg-canvas/60 px-5 py-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-mute md:grid">
              <span>Source</span>
              <span>Current pilot coverage</span>
              <span>Google Sheets</span>
              <span>Looker Studio</span>
            </div>

            <div className="divide-y divide-line">
              {SOURCES.map((source) => (
                <article key={source.name} className="grid gap-5 p-5 transition-colors hover:bg-white/[0.018] md:grid-cols-[1.05fr_1.6fr_.8fr_.8fr] md:items-center">
                  <div className="flex items-center gap-3">
                    <IntegrationMark src={source.logo} alt="" size="md" />
                    <div>
                      <h3 className="text-sm font-semibold text-ink">{source.name}</h3>
                      <span className={source.statusTone === "ready" ? "mt-1 inline-flex items-center gap-1 font-mono text-[9px] text-emerald-400" : "mt-1 inline-flex items-center gap-1 font-mono text-[9px] text-amber-300"}>
                        {source.statusTone === "ready" ? <CheckCircle2 className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}
                        {source.status}
                      </span>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-neutral-300">{source.coverage}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-mute">{source.note}</p>
                  </div>

                  <Link href={integrationPath(source.sheetsSlug)} className="group inline-flex items-center justify-between rounded-md border border-line bg-canvas px-3 py-2.5 text-xs font-medium text-ink transition-colors hover:border-white/25 hover:bg-white/[0.04]">
                    <span className="md:hidden">Open Sheets route</span><span className="hidden md:inline">Open route</span>
                    <ArrowRight className="h-3.5 w-3.5 text-ink-mute transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                  </Link>

                  <Link href={integrationPath(source.lookerSlug)} className="group inline-flex items-center justify-between rounded-md border border-line bg-canvas px-3 py-2.5 text-xs font-medium text-ink transition-colors hover:border-white/25 hover:bg-white/[0.04]">
                    <span className="md:hidden">Open Looker route</span><span className="hidden md:inline">Open route</span>
                    <ArrowRight className="h-3.5 w-3.5 text-ink-mute transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-panel/30 px-4 py-16 sm:px-6 lg:px-8" aria-labelledby="destination-heading">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-xl">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute">Choose by working style</p>
            <h2 id="destination-heading" className="mt-3 text-3xl font-semibold tracking-tight text-ink">Where should the verified data go?</h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {DESTINATIONS.map((destination) => {
              const DestinationIcon = destination.icon;
              return (
                <article key={destination.name} className="group relative overflow-hidden rounded-xl border border-line bg-panel p-6 transition-colors hover:border-white/20">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <IntegrationMark src={destination.logo} alt="" size="lg" />
                      <div>
                        <h3 className="text-base font-semibold text-ink">{destination.name}</h3>
                        <p className="mt-0.5 font-mono text-[10px] text-ink-mute">{destination.label}</p>
                      </div>
                    </div>
                    <DestinationIcon className="h-5 w-5 text-neutral-500 transition-colors group-hover:text-neutral-300" />
                  </div>
                  <p className="mt-5 max-w-lg text-sm leading-relaxed text-ink-mute">{destination.outcome}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.035] p-5">
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300/80" />
              <div>
                <h2 className="text-sm font-semibold text-ink">The pilot scope is intentionally narrow</h2>
                <p className="mt-2 text-xs leading-relaxed text-ink-mute">TikTok Shop and GMV Max, Lazada, Shopify, and Amazon are not public routes yet. They will appear here only after their live-account workflows pass verification.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-5 sm:min-w-72">
            <div>
              <h2 className="text-sm font-semibold text-ink">Have a route in mind?</h2>
              <p className="mt-1 text-xs text-ink-mute">Tell us the source, destination, and workspace count.</p>
            </div>
            <Link href="/support?pilot=1" className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-4 py-2.5 text-xs font-semibold text-black transition-colors hover:bg-neutral-200">
              Request pilot access
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
