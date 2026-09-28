import type { Metadata } from "next";
import Link from "next/link";
import {
    ArrowDownRight,
    ArrowRight,
    BarChart3,
    Check,
    Clock3,
    Database,
    KeyRound,
    Plug,
    RefreshCw,
    ShieldCheck,
} from "lucide-react";
import { MarketingScrollReveal } from "@/components/marketing/MarketingScrollReveal";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
    title: "How Monstera works",
    description: "Connect certified advertising and marketplace sources, verify warehouse imports, and report through Google Sheets or Looker Studio.",
    alternates: { canonical: `${PRODUCT_SITE_URL}/platform` },
};

const steps = [
    {
        number: "01",
        icon: Plug,
        title: "Connect your sources",
        body: "Authorize Meta Ads, Google Ads, TikTok Ads, or Shopee and attach each connection to the right client workspace.",
        detail: "Provider authorization",
    },
    {
        number: "02",
        icon: RefreshCw,
        title: "Sync a date range",
        body: "Choose a reporting window and import data. Every run records its outcome so your team can see what completed.",
        detail: "On-demand or scheduled",
    },
    {
        number: "03",
        icon: Database,
        title: "Verify the data",
        body: "Review row coverage, freshness, and source health in Data Explorer before using the numbers in a client report.",
        detail: "Workspace-scoped history",
    },
    {
        number: "04",
        icon: BarChart3,
        title: "Build your report",
        body: "Use the prepared data in Google Sheets or Looker Studio, then reconcile the first report against the warehouse.",
        detail: "Sheets, Looker, CSV & API",
    },
];

const capabilities = [
    {
        icon: Clock3,
        title: "Know when data is fresh",
        body: "See sync timestamps and outcomes beside the reporting data, so a client review starts with the right context.",
        number: "01",
        visual: "freshness",
    },
    {
        icon: ShieldCheck,
        title: "Keep client workspaces separate",
        body: "Accounts, reporting data, and members stay organized within the selected workspace.",
        number: "02",
        visual: "workspace",
    },
    {
        icon: KeyRound,
        title: "Stay in control of access",
        body: "Provider access is revocable. Looker Studio uses a workspace API key; the Sheets add-on uses a Google identity token.",
        number: "03",
        visual: "access",
    },
];

function ReportingChart() {
    return (
        <div className="platform-chart-card">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-mute">Sample client · Last 30 days</p>
                    <p className="mt-3 text-3xl font-medium tracking-[-0.04em] text-ink sm:text-4xl">482.6M <span className="text-base tracking-normal text-ink-mute">₫</span></p>
                    <p className="mt-1 text-xs text-ink-mute">Provider-reported revenue</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-2.5 py-1.5 font-mono text-[10px] text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />+12.6%</span>
            </div>

            <div className="mt-7 rounded-xl border border-white/[0.07] bg-black/25 p-3 sm:p-4">
                <div className="flex items-center justify-between px-1 text-[10px] text-ink-mute"><span>Daily performance</span><span>VND</span></div>
                <div className="relative mt-3 h-36 sm:h-44">
                    <div className="absolute inset-0 flex flex-col justify-between" aria-hidden="true"><span className="border-t border-dashed border-white/[0.08]" /><span className="border-t border-dashed border-white/[0.08]" /><span className="border-t border-dashed border-white/[0.08]" /><span className="border-t border-white/[0.08]" /></div>
                    <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 720 180" preserveAspectRatio="none" role="img" aria-label="Illustrative rising revenue chart over the last 30 days">
                        <defs><linearGradient id="platform-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8ce5bc" stopOpacity=".24" /><stop offset="100%" stopColor="#8ce5bc" stopOpacity="0" /></linearGradient></defs>
                        <path d="M0 144 C32 137 38 116 72 123 S112 139 144 112 S185 123 216 101 S254 118 288 91 S326 106 360 77 S399 90 432 64 S471 89 504 57 S542 69 576 44 S615 71 648 35 S688 48 720 18 V180 H0Z" fill="url(#platform-chart-fill)" />
                        <path className="platform-chart-line" d="M0 144 C32 137 38 116 72 123 S112 139 144 112 S185 123 216 101 S254 118 288 91 S326 106 360 77 S399 90 432 64 S471 89 504 57 S542 69 576 44 S615 71 648 35 S688 48 720 18" fill="none" stroke="#9de8c5" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
                        <circle cx="720" cy="18" r="4.5" fill="#b4f2d3" />
                    </svg>
                </div>
                <div className="mt-2 flex justify-between px-1 font-mono text-[9px] text-ink-mute"><span>DAY 01</span><span>DAY 08</span><span>DAY 15</span><span>DAY 22</span><span>DAY 30</span></div>
            </div>

            <div className="mt-4 grid grid-cols-3 divide-x divide-white/[0.08] rounded-xl border border-white/[0.07] bg-white/[0.02]">
                {[{ name: "Spend", value: "126.4M ₫" }, { name: "ROAS", value: "3.82×" }, { name: "Sources", value: "4 connected" }].map((item) => <div className="min-w-0 px-3 py-3 sm:px-4" key={item.name}><p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-mute">{item.name}</p><p className="mt-1 truncate text-xs font-medium text-ink sm:text-sm">{item.value}</p></div>)}
            </div>
            <p className="mt-3 text-[9px] text-ink-mute">Illustrative product data—not a customer result.</p>
        </div>
    );
}

function CapabilityVisual({ type }: { type: string }) {
    if (type === "freshness") {
        return <div className="platform-mini-visual"><div className="flex items-center justify-between border-b border-white/[0.07] pb-3 text-[10px]"><span className="text-ink-mute">Latest sync</span><span className="font-mono text-emerald-300">Completed</span></div><div className="mt-3 flex items-end justify-between"><span className="text-xl font-medium tracking-tight text-ink">2 min ago</span><span className="font-mono text-[9px] text-ink-mute">TODAY, 10:42</span></div><div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.07]"><span className="block h-full w-[82%] rounded-full bg-emerald-300/70" /></div></div>;
    }
    if (type === "workspace") {
        return <div className="platform-mini-visual space-y-2"><div className="flex items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.05] px-3 py-2.5"><span className="h-2 w-2 rounded-full bg-emerald-300" /><span className="text-xs font-medium text-ink">Client workspace</span><Check className="ml-auto h-3.5 w-3.5 text-emerald-300" /></div><div className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-ink-mute"><span className="h-1.5 w-1.5 rounded-full bg-white/20" />Other workspaces stay separate</div></div>;
    }
    return <div className="platform-mini-visual"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.09] bg-white/[0.04]"><KeyRound className="h-4 w-4 text-ink-mute" /></span><div><p className="text-xs font-medium text-ink">Access can be revoked</p><p className="mt-1 text-[10px] text-ink-mute">Workspace-scoped credentials</p></div><ArrowDownRight className="ml-auto h-4 w-4 text-ink-mute" /></div></div>;
}

export default function PlatformPage() {
    return (
        <div className="overflow-x-clip pb-20 text-ink">
            <section className="relative isolate px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20 lg:px-8">
                <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[44rem] bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.045),transparent_58%)]" />
                <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
                    <MarketingScrollReveal className="max-w-xl">
                        <p className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.035] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-mute"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Reporting, without the busywork</p>
                        <h1 className="mt-7 text-balance text-5xl font-medium leading-[1.02] tracking-[-0.055em] sm:text-6xl lg:text-[4.25rem]">From ad accounts to <span className="text-neutral-400">client-ready reports.</span></h1>
                        <p className="mt-6 max-w-lg text-base leading-relaxed text-ink-mute sm:text-lg">Connect your advertising sources, check the data, and send it to the reporting tools your team already uses.</p>
                        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                            <Link href="/register?offer=agency-pro-pilot" className="inline-flex min-h-12 items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-200">Start the 7-day pilot <ArrowRight className="ml-2 h-4 w-4" aria-hidden /></Link>
                            <Link href="/integrations" className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/[0.12] px-6 py-3 text-sm font-medium text-ink transition-colors hover:border-white/25 hover:bg-white/[0.04]">Explore integrations</Link>
                        </div>
                        <div className="mt-9 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/[0.09] pt-5 text-[11px] text-ink-mute"><span>Meta Ads</span><span>Google Ads</span><span>TikTok Ads</span><span>Shopee</span></div>
                    </MarketingScrollReveal>
                    <MarketingScrollReveal delay={120}><ReportingChart /></MarketingScrollReveal>
                </div>
            </section>

            <section className="border-y border-white/[0.08] bg-white/[0.015] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
                <div className="mx-auto max-w-6xl">
                    <MarketingScrollReveal className="mb-10 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                        <div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-mute">One dependable reporting flow</p><h2 className="mt-3 max-w-2xl text-balance text-3xl font-medium tracking-[-0.04em] sm:text-5xl">Each step is clear. Every handoff is visible.</h2></div>
                        <p className="max-w-sm text-sm leading-relaxed text-ink-mute">Move from authorization to a verified client report, with a place to check the data before it goes out.</p>
                    </MarketingScrollReveal>
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                        {steps.map((step, index) => {
                            const Icon = step.icon;
                            return <MarketingScrollReveal key={step.number} delay={index * 75} className="h-full"><article className="platform-card h-full"><div className="flex items-center justify-between"><span className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">{step.number} / 04</span><span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.025]"><Icon className="h-4 w-4 text-ink" strokeWidth={1.5} aria-hidden /></span></div><h3 className="mt-8 text-lg font-medium tracking-tight text-ink">{step.title}</h3><p className="mt-3 min-h-[5.25rem] text-sm leading-relaxed text-ink-mute">{step.body}</p><p className="mt-6 border-t border-white/[0.08] pt-4 font-mono text-[9px] uppercase tracking-[0.13em] text-ink-mute">{step.detail}</p></article></MarketingScrollReveal>;
                        })}
                    </div>
                </div>
            </section>

            <section className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
                <div className="mx-auto max-w-6xl">
                    <MarketingScrollReveal className="mb-10 max-w-2xl"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-mute">Built for day-to-day agency work</p><h2 className="mt-3 text-balance text-3xl font-medium tracking-[-0.04em] sm:text-5xl">The details that make reporting easier to trust.</h2></MarketingScrollReveal>
                    <div className="grid gap-4 md:grid-cols-2">
                        {capabilities.map((cap, index) => {
                            const Icon = cap.icon;
                            return <MarketingScrollReveal key={cap.number} delay={index * 85} className="h-full"><article className="platform-card flex h-full flex-col"><div className="flex items-center justify-between"><span className="font-mono text-[10px] tracking-[0.14em] text-ink-mute">{cap.number}</span><Icon className="h-4 w-4 text-ink-mute" strokeWidth={1.5} aria-hidden /></div><h3 className="mt-6 text-xl font-medium tracking-tight text-ink">{cap.title}</h3><p className="mt-2 max-w-lg text-sm leading-relaxed text-ink-mute">{cap.body}</p><div className="mt-7"><CapabilityVisual type={cap.visual} /></div></article></MarketingScrollReveal>;
                        })}
                        <MarketingScrollReveal delay={255} className="h-full"><article className="platform-card flex h-full flex-col justify-between bg-[radial-gradient(ellipse_at_bottom_right,rgba(255,255,255,0.055),transparent_65%)]"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute">Your existing workflow</p><h3 className="mt-6 max-w-md text-2xl font-medium tracking-tight text-ink sm:text-3xl">Keep reports where your team already works.</h3><p className="mt-3 max-w-lg text-sm leading-relaxed text-ink-mute">Deliver prepared data to Sheets or Looker Studio, or export it for the next tool in your workflow.</p></div><div className="mt-8 flex flex-wrap gap-2">{["Google Sheets", "Looker Studio", "CSV", "REST API"].map((name) => <span key={name} className="rounded-full border border-white/[0.1] bg-black/20 px-3 py-2 text-[10px] text-ink-mute">{name}</span>)}</div></article></MarketingScrollReveal>
                    </div>
                </div>
            </section>

            <section className="px-4 pb-4 sm:px-6 lg:px-8"><MarketingScrollReveal className="mx-auto flex max-w-6xl flex-col gap-6 rounded-2xl border border-white/[0.1] bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.06),transparent_65%)] p-7 sm:flex-row sm:items-center sm:justify-between sm:p-10"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute">Start with one real client</p><h2 className="mt-3 max-w-2xl text-2xl font-medium tracking-tight text-ink sm:text-3xl">See how much reporting time you get back.</h2><p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-mute">Try the full workflow for seven days with guided setup and a real client workspace.</p></div><Link href="/register?offer=agency-pro-pilot" className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-200">Start the pilot <ArrowRight className="ml-2 h-4 w-4" aria-hidden /></Link></MarketingScrollReveal></section>
        </div>
    );
}
