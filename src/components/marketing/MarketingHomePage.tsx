"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  Shield,
} from "lucide-react";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";

type ConnectorItem = {
  name: string;
  logo: string;
  alt: string;
  status: "live" | "coming_soon";
};

type QA = {
  q: string;
  a: string;
};

function track(event: string, props?: Record<string, string>) {
  if (typeof window !== "undefined" && (window as any).gtag) {
    (window as any).gtag("event", event, props ?? {});
  }
}

function ctaTracking(eventName: string, location: string) {
  return () => track(eventName, { location, page: "marketing_home" });
}

const primaryMessage =
  "Connect your SEA sales and ad platforms once. Monstera keeps your Google Sheets fresh every day.";

const heroTrust =
  "No credit card · OAuth connections · Google Sheets destination · VND + USD billing";

const connectors: {
  ads: ConnectorItem[];
  marketplaces: ConnectorItem[];
  commerce: ConnectorItem[];
  destinations: ConnectorItem[];
} = {
  ads: [
    { name: "TikTok Ads", logo: INTEGRATION_LOGOS.tiktok, alt: "TikTok Ads", status: "live" },
    { name: "Meta Ads", logo: INTEGRATION_LOGOS.meta, alt: "Meta Ads", status: "live" },
    { name: "Google Ads", logo: INTEGRATION_LOGOS.googleAds, alt: "Google Ads", status: "live" },
  ],
  marketplaces: [
    { name: "TikTok Shop", logo: INTEGRATION_LOGOS.tiktok, alt: "TikTok Shop", status: "live" },
    { name: "Shopee", logo: INTEGRATION_LOGOS.shopee, alt: "Shopee", status: "live" },
    { name: "Lazada", logo: INTEGRATION_LOGOS.lazada, alt: "Lazada", status: "coming_soon" },
  ],
  commerce: [
    { name: "Shopify", logo: INTEGRATION_LOGOS.shopify, alt: "Shopify", status: "coming_soon" },
    { name: "GA4", logo: INTEGRATION_LOGOS.googleAnalytics, alt: "Google Analytics 4", status: "coming_soon" },
  ],
  destinations: [
    { name: "Google Sheets", logo: INTEGRATION_LOGOS.googleSheets, alt: "Google Sheets", status: "live" },
    { name: "Looker Studio", logo: INTEGRATION_LOGOS.looker, alt: "Looker Studio", status: "live" },
    { name: "Direct Export", logo: INTEGRATION_LOGOS.postgresql, alt: "Direct Export", status: "coming_soon" },
  ],
};

const spreadsheetColumns = [
  "Date",
  "Platform",
  "Campaign",
  "Spend",
  "Revenue",
  "Orders",
  "ROAS",
  "CPC",
  "Last synced",
];

const spreadsheetRows = [
  {
    date: "2026-04-28",
    platform: "TikTok Ads",
    campaign: "VN Summer Push",
    spend: "$420",
    revenue: "$2,840",
    orders: "81",
    roas: "6.8x",
    cpc: "$0.39",
    synced: "08:05 ICT",
  },
  {
    date: "2026-04-28",
    platform: "Shopee",
    campaign: "Flash Sale 4.4",
    spend: "-",
    revenue: "$7,120",
    orders: "246",
    roas: "-",
    cpc: "-",
    synced: "08:05 ICT",
  },
  {
    date: "2026-04-28",
    platform: "Meta Ads",
    campaign: "Retargeting SEA",
    spend: "$315",
    revenue: "$1,356",
    orders: "43",
    roas: "4.3x",
    cpc: "$0.72",
    synced: "08:05 ICT",
  },
  {
    date: "2026-04-28",
    platform: "Google Ads",
    campaign: "Brand Search VN",
    spend: "$188",
    revenue: "$812",
    orders: "24",
    roas: "4.3x",
    cpc: "$0.90",
    synced: "08:05 ICT",
  },
];

const faqs: QA[] = [
  {
    q: "Which platforms are supported?",
    a: "Monstera currently supports selected ad and marketplace connectors, with additional connectors marked as Coming soon on this page.",
  },
  {
    q: "Does Monstera support TikTok Shop and Shopee?",
    a: "Yes. Monstera is built for SEA commerce reporting and includes TikTok Shop and Shopee workflows.",
  },
  {
    q: "Can I choose which metrics sync?",
    a: "Yes. You choose the fields and metrics you want in your sheet before refresh runs.",
  },
  {
    q: "How often does data refresh?",
    a: "Refresh cadence depends on your plan and setup, with daily sync available from the free tier.",
  },
  {
    q: "Can I use my existing Google Sheet?",
    a: "Yes. You can connect to an existing Google Sheet and map data into the tabs you use for reporting.",
  },
  {
    q: "Is my data secure?",
    a: "Monstera uses official OAuth flows, encrypted transport, and encrypted token storage.",
  },
  {
    q: "Do I need a data warehouse?",
    a: "No. Monstera is designed for teams that want fresh reporting directly in Google Sheets and Looker Studio.",
  },
  {
    q: "What happens if an API changes?",
    a: "Monstera maintains connectors and sync logic so your reporting workflow remains stable as platforms evolve.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes. Free includes 2 active pipelines, daily sync, 14 days ad report history, TikTok Ads and Shopee connectors, and the Google Sheets add-on.",
  },
];

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-white">{title}</h2>
      {description ? <p className="mt-4 text-sm md:text-base text-gray-300 leading-relaxed">{description}</p> : null}
    </div>
  );
}

function ConnectorCard({ item }: { item: ConnectorItem }) {
  const live = item.status === "live";
  return (
    <div
      className={`rounded-2xl border px-4 py-3 flex items-center gap-3 ${
        live
          ? "bg-white/[0.03] border-white/10"
          : "bg-white/[0.015] border-white/5 opacity-75"
      }`}
    >
      <img src={item.logo} alt={item.alt} className="h-5 w-5 object-contain brightness-0 invert opacity-70" />
      <span className="text-sm text-gray-200">{item.name}</span>
      <span
        className={`ml-auto text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full ${
          live
            ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
            : "bg-white/5 text-gray-400 border border-white/10"
        }`}
      >
        {live ? "Live" : "Coming soon"}
      </span>
    </div>
  );
}

function FAQItem({ qa }: { qa: QA }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/10">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left py-4 gap-4"
      >
        <span className="text-sm md:text-base text-gray-100">{qa.q}</span>
        {open ? <Minus className="h-4 w-4 text-cyan-400" /> : <Plus className="h-4 w-4 text-gray-400" />}
      </button>
      {open ? <p className="pb-4 text-sm text-gray-300 leading-relaxed">{qa.a}</p> : null}
    </div>
  );
}

function PlatformFlowDiagram() {
  const sourceNodes = [
    { label: "TikTok Ads", logo: INTEGRATION_LOGOS.tiktok },
    { label: "TikTok Shop", logo: INTEGRATION_LOGOS.tiktok },
    { label: "Shopee", logo: INTEGRATION_LOGOS.shopee },
    { label: "Meta Ads", logo: INTEGRATION_LOGOS.meta },
    { label: "Google Ads", logo: INTEGRATION_LOGOS.googleAds },
  ];

  const destinationNodes = [
    { label: "Google Sheets", logo: INTEGRATION_LOGOS.googleSheets },
    { label: "Looker Studio", logo: INTEGRATION_LOGOS.looker },
    { label: "Direct Export", logo: INTEGRATION_LOGOS.postgresql },
  ];

  return (
    <div className="rounded-3xl border border-white/10 bg-[#0f1117]/80 p-4 md:p-6 lg:p-8 backdrop-blur-sm">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-center">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
          {sourceNodes.map((node) => (
            <div key={node.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 flex items-center gap-2.5">
              <img src={node.logo} alt={node.label} className="h-4 w-4 object-contain brightness-0 invert opacity-75" />
              <span className="text-xs text-gray-200">{node.label}</span>
            </div>
          ))}
        </div>

        <ArrowRight className="hidden lg:block h-5 w-5 text-cyan-400/70" />

        <div className="mx-auto h-28 w-28 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 flex items-center justify-center">
          <div className="text-center">
            <div className="mx-auto h-10 w-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center mb-2">
              <span className="font-black text-cyan-300">M</span>
            </div>
            <p className="text-[10px] tracking-widest uppercase text-cyan-300/80">Monstera Cloud</p>
          </div>
        </div>

        <ArrowRight className="hidden lg:block h-5 w-5 text-cyan-400/70" />

        <div className="grid grid-cols-1 gap-3">
          {destinationNodes.map((node) => (
            <div key={node.label} className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2.5 flex items-center gap-2.5">
              <img src={node.logo} alt={node.label} className="h-4 w-4 object-contain brightness-0 invert opacity-75" />
              <span className="text-xs text-cyan-200">{node.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConnectorGrid() {
  return (
    <section className="py-20 border-b border-white/10" id="connectors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <SectionHeading
          title="Connect the platforms your team already uses"
          description="Availability can vary by plan and connector maturity. Cards marked Coming soon are not generally available yet."
        />

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.18em] text-gray-400">Ads</h3>
            <div className="space-y-2.5">{connectors.ads.map((item) => <ConnectorCard key={item.name} item={item} />)}</div>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.18em] text-gray-400">Marketplaces</h3>
            <div className="space-y-2.5">{connectors.marketplaces.map((item) => <ConnectorCard key={item.name} item={item} />)}</div>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.18em] text-gray-400">Commerce / Analytics</h3>
            <div className="space-y-2.5">{connectors.commerce.map((item) => <ConnectorCard key={item.name} item={item} />)}</div>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs uppercase tracking-[0.18em] text-gray-400">Destinations</h3>
            <div className="space-y-2.5">{connectors.destinations.map((item) => <ConnectorCard key={item.name} item={item} />)}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProblemCards() {
  const problems = [
    "CSV exports from every platform",
    "Different metric names across channels",
    "Late reports and stale dashboards",
    "Agency teams rebuilding the same reports for every client",
  ];

  return (
    <section className="py-20 border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <SectionHeading title="Manual reporting breaks when your channels grow" />
        <div className="grid gap-4 md:grid-cols-2">
          {problems.map((problem) => (
            <div key={problem} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <p className="text-gray-200 text-sm md:text-base">{problem}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: "Connect platforms with OAuth",
      body: "Authorize your ad and marketplace accounts in official OAuth flows.",
    },
    {
      title: "Choose metrics and refresh schedule",
      body: "Pick the fields your team reports on and decide refresh cadence.",
    },
    {
      title: "Monstera updates your Google Sheet automatically",
      body: "Your reporting tab stays fresh without CSV exports or manual cleanup.",
    },
  ];

  return (
    <section className="py-20 border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <SectionHeading title="From platform data to spreadsheet in three steps" />
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((step, idx) => (
            <div key={step.title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-400 mb-3">0{idx + 1}</p>
              <h3 className="text-white font-semibold mb-2">{step.title}</h3>
              <p className="text-sm text-gray-300 leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProductDemoBlock() {
  return (
    <section className="py-20 border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <SectionHeading title="See your first report update automatically" />

        <div className="rounded-3xl border border-white/10 bg-[#0d1016] overflow-hidden">
          <div className="aspect-video relative flex items-center justify-center">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.14),transparent_60%)]" />
            <div className="relative text-center px-6">
              <div className="mx-auto mb-4 h-14 w-14 rounded-full border border-cyan-500/35 bg-cyan-500/10 flex items-center justify-center">
                <RefreshCw className="h-6 w-6 text-cyan-300" />
              </div>
              <p className="text-white font-semibold">Product demo coming soon</p>
              <p className="mt-2 text-sm text-gray-300">A short walkthrough of first sync setup and automatic refresh will be added here.</p>
            </div>
          </div>
          <div className="border-t border-white/10 px-5 py-4 flex justify-center">
            <Link
              href="/templates"
              onClick={ctaTracking("mc_home_view_sample_sheet", "product_demo")}
              className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200"
            >
              View sample Google Sheet
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function SpreadsheetPreview() {
  return (
    <section className="py-20 border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <SectionHeading
          title="Google Sheets-style preview"
          description="Demo values only to illustrate output format. This does not represent real customer data."
        />

        <div className="rounded-2xl border border-white/10 bg-[#0f1117] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 text-xs text-gray-400">Monstera Sync Preview</div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white/[0.03]">
                <tr>
                  {spreadsheetColumns.map((col) => (
                    <th key={col} className="text-left text-xs text-gray-300 font-semibold px-4 py-3 whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {spreadsheetRows.map((row, idx) => (
                  <tr key={`${row.date}-${row.platform}-${idx}`} className="border-t border-white/10">
                    <td className="px-4 py-3 text-gray-200 whitespace-nowrap">{row.date}</td>
                    <td className="px-4 py-3 text-gray-200 whitespace-nowrap">{row.platform}</td>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{row.campaign}</td>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{row.spend}</td>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{row.revenue}</td>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{row.orders}</td>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{row.roas}</td>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{row.cpc}</td>
                    <td className="px-4 py-3 text-cyan-300 whitespace-nowrap">{row.synced}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function UseCaseCards() {
  const cards = [
    {
      title: "For ecommerce sellers",
      body: "Track daily orders, spend, revenue, ROAS, and product performance across marketplaces and ad platforms.",
    },
    {
      title: "For agencies",
      body: "Automate multi-client reporting and deliver clean, repeatable Google Sheets without manual exports.",
    },
    {
      title: "For founders/operators",
      body: "See yesterday's performance every morning without waiting for the team to reconcile reports.",
    },
  ];

  return (
    <section className="py-20 border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <SectionHeading title="Built for SEA ecommerce teams" />
        <div className="grid gap-4 md:grid-cols-3">
          {cards.map((card) => (
            <div key={card.title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <h3 className="text-white font-semibold mb-2">{card.title}</h3>
              <p className="text-sm text-gray-300 leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SecurityTrustCards() {
  const cards = [
    {
      title: "OAuth-only access",
      body: "Connect platforms through official OAuth flows. No shared passwords.",
      icon: Shield,
    },
    {
      title: "Encrypted credentials",
      body: "Tokens are encrypted at rest and traffic is encrypted in transit.",
      icon: Lock,
    },
    {
      title: "Revoke anytime",
      body: "Disconnect a platform or Google Sheet whenever you want.",
      icon: RefreshCw,
    },
    {
      title: "Your data stays yours",
      body: "Monstera does not sell your ad, sales, or customer data.",
      icon: CheckCircle2,
    },
    {
      title: "Sync visibility",
      body: "See the latest refresh time and sync status for every connected workspace.",
      icon: ChevronDown,
    },
    {
      title: "SEA-ready",
      body: "Designed for teams operating across Vietnam and Southeast Asia.",
      icon: Shield,
    },
  ];

  return (
    <section className="py-20 border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <SectionHeading title="Your data stays under your control" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ title, body, icon: Icon }) => (
            <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <Icon className="h-4 w-4 text-cyan-300 mb-3" />
              <h3 className="text-white font-semibold mb-2">{title}</h3>
              <p className="text-sm text-gray-300 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TemplateCards() {
  const templates = [
    "TikTok Shop daily sales report",
    "Shopee revenue + orders report",
    "TikTok Ads spend pacing report",
    "Meta Ads ROAS report",
    "Marketplace + ads blended ROAS report",
    "Agency weekly client report",
    "Founder daily ecommerce pulse",
    "Product SKU performance report",
  ];

  return (
    <section className="py-20 border-b border-white/10" id="templates">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <SectionHeading title="Start with ready-made reporting templates" />
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {templates.map((template) => (
            <div key={template} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-sm text-gray-200 leading-relaxed">{template}</p>
            </div>
          ))}
        </div>
        <div>
          <Link
            href="/templates"
            onClick={ctaTracking("mc_home_explore_templates", "templates_section")}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 transition-colors"
          >
            Explore templates
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function PricingPreview() {
  return (
    <section className="py-20 border-b border-white/10" id="pricing-preview">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <SectionHeading title="Start free. Upgrade when reporting gets serious." />

        <div className="max-w-xl rounded-3xl border border-cyan-500/25 bg-cyan-500/[0.06] p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300 mb-2">Free</p>
          <p className="text-4xl font-bold text-white mb-4">$0</p>
          <ul className="space-y-2 text-sm text-gray-200">
            <li>2 active pipelines</li>
            <li>Daily sync</li>
            <li>Up to 14 days ad report history</li>
            <li>TikTok Ads and Shopee connectors</li>
            <li>Google Sheets add-on</li>
            <li>No credit card</li>
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/register"
              onClick={ctaTracking("mc_home_start_free", "pricing_preview")}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 transition-colors"
            >
              Start free - first sync in 5 min
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              onClick={ctaTracking("mc_home_see_pricing", "pricing_preview")}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-gray-200 border border-white/15 bg-white/[0.03] hover:bg-white/[0.06]"
            >
              See pricing
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function FAQAccordion() {
  return (
    <section className="py-20 border-b border-white/10" id="faq">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <SectionHeading title="FAQ" />
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 md:px-6">
          {faqs.map((qa) => (
            <FAQItem key={qa.q} qa={qa} />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function MarketingHomePage() {
  return (
    <div className="relative min-h-screen bg-[#09090b] text-slate-200 selection:bg-cyan-500/30">
      <section className="relative pt-28 pb-16 md:pt-32 md:pb-20 border-b border-white/10 overflow-hidden">
        <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 h-[24rem] w-[44rem] rounded-full bg-cyan-500/10 blur-[130px]" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="max-w-4xl mx-auto text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80 mb-4">SEA ecommerce reporting layer</p>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white leading-tight">
              Stop exporting CSVs from TikTok Shop, Shopee, and ad platforms.
            </h1>
            <p className="mt-6 text-base md:text-lg text-gray-300 max-w-3xl mx-auto leading-relaxed">
              Monstera syncs your ads, marketplace, and revenue data into clean Google Sheets automatically - built for Southeast Asia sellers and agencies.
            </p>
            <p className="mt-4 text-sm text-gray-300">{primaryMessage}</p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/register"
                onClick={ctaTracking("mc_home_start_free", "hero")}
                className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 shadow-lg shadow-cyan-900/40"
              >
                Start free - first sync in 5 min
                <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link
                href="/templates"
                onClick={ctaTracking("mc_home_view_sample_sheet", "hero")}
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-semibold text-cyan-200 border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/15"
              >
                View sample Google Sheet
              </Link>
            </div>

            <p className="mt-5 text-xs text-gray-300">{heroTrust}</p>
          </div>

          <PlatformFlowDiagram />
        </div>
      </section>

      <ConnectorGrid />
      <ProblemCards />
      <HowItWorks />
      <ProductDemoBlock />
      <SpreadsheetPreview />
      <UseCaseCards />
      <SecurityTrustCards />
      <TemplateCards />
      <PricingPreview />
      <FAQAccordion />
    </div>
  );
}
