import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleAlert,
  FileSpreadsheet,
} from "lucide-react";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { MarketingScrollReveal } from "@/components/marketing/MarketingScrollReveal";
import { IntegrationRouteExplorer } from "@/components/marketing/IntegrationRouteExplorer";
import "@/components/marketing/marketing-page-polish.css";
import "./integrations-frontier.css";
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
  const routes = SOURCES.map(source => ({
    name: source.name, logo: source.logo, coverage: source.coverage, note: source.note,
    status: source.status, statusTone: source.statusTone,
    sheetsHref: integrationPath(source.sheetsSlug), lookerHref: integrationPath(source.lookerSlug),
  }));
  return <main className="marketing-polish integrations-frontier">
    <section className="if-hero"><div className="if-orbit" aria-hidden="true" /><div className="polish-container">
      <MarketingScrollReveal cinematic><div className="if-hero-top"><p className="polish-eyebrow">THE CONNECTED REPORTING WORKSPACE</p><span>MONSTERA / 02</span></div><div className="if-hero-split"><h1>Every source.<br /><span>One clear path.</span></h1><div className="if-hero-aside"><p>From ad platforms and commerce to the reports your team already uses. Choose a route, understand its coverage, and keep a clear view of the data in between.</p><div className="if-hero-actions"><Link href="#explore-routes" className="polish-button">Explore the routes<ArrowRight size={16} /></Link><Link href="#route-directory" className="polish-link">See all connections<ArrowRight size={15} /></Link></div></div></div></MarketingScrollReveal>
      <MarketingScrollReveal cinematic className="if-hero-figures"><div><strong>04</strong><span>PUBLIC SOURCES</span></div><div><strong>02</strong><span>REPORTING DESTINATIONS</span></div><div><strong>08</strong><span>PUBLIC ROUTES</span></div></MarketingScrollReveal>
    </div></section>

    <section id="explore-routes" className="if-explore polish-container"><MarketingScrollReveal cinematic className="if-section-heading"><p className="polish-eyebrow">START WITH THE WORKFLOW</p><h2>See how your data <span>gets there.</span></h2><p>Choose a source and destination to explore the exact reporting route. Each route page explains setup, coverage, and what still needs verification.</p></MarketingScrollReveal><MarketingScrollReveal cinematic><IntegrationRouteExplorer sources={routes} /></MarketingScrollReveal></section>

    <section id="route-directory" className="if-directory"><div className="polish-container"><MarketingScrollReveal cinematic className="if-section-heading"><p className="polish-eyebrow">THE ROUTE DIRECTORY</p><h2>Choose with <span>full context.</span></h2><p>Coverage varies by provider. These are the public pilot routes and their current limits.</p></MarketingScrollReveal><div className="if-directory-grid">{SOURCES.map((source, index) => <MarketingScrollReveal cinematic delay={index * 65} key={source.name}><article className="if-directory-card"><div className="if-directory-card-top"><IntegrationMark src={source.logo} alt="" size="lg" /><span>0{index + 1} / SOURCE</span></div><h3>{source.name}</h3><span className={source.statusTone === "ready" ? "if-status" : "if-status if-status-conditional"}>{source.statusTone === "ready" ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}{source.status}</span><p>{source.coverage}</p><small>{source.note}</small><div className="if-directory-card-links"><Link href={integrationPath(source.sheetsSlug)}>To Sheets<ArrowRight size={14} /></Link><Link href={integrationPath(source.lookerSlug)}>To Looker<ArrowRight size={14} /></Link></div></article></MarketingScrollReveal>)}</div></div></section>

    <section className="if-destinations polish-container"><MarketingScrollReveal cinematic className="if-section-heading"><p className="polish-eyebrow">THE LAST MILE</p><h2>Work where your team <span>already works.</span></h2></MarketingScrollReveal><div className="if-destination-grid">{DESTINATIONS.map((destination, index) => { const DestinationIcon = destination.icon; return <MarketingScrollReveal cinematic delay={index * 90} key={destination.name}><article className={index === 0 ? "if-destination-card if-destination-light" : "if-destination-card"}><div className="if-destination-card-top"><IntegrationMark src={destination.logo} alt="" size="lg" /><span>{destination.label}</span><DestinationIcon size={21} strokeWidth={1.2} /></div><div><h3>{destination.name}</h3><p>{destination.outcome}</p></div></article></MarketingScrollReveal>; })}</div></section>

    <section className="if-scope"><div className="polish-container"><MarketingScrollReveal cinematic className="if-scope-inner"><div><p className="polish-eyebrow">CURRENT PILOT SCOPE</p><h2>Coverage you can <span>count on.</span></h2></div><div><CircleAlert size={20} strokeWidth={1.4} /><p>TikTok Shop and GMV Max, Lazada, Shopify, and Amazon are not public routes yet. Shopee ads metrics depend on Partner Center approval. New routes appear after live-account verification.</p><Link href="/support?pilot=1" className="polish-link">Request pilot access<ArrowRight size={15} /></Link></div></MarketingScrollReveal></div></section>
  </main>;
}
