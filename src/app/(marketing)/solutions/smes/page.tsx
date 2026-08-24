"use client";

import Link from "next/link";
import { useState } from "react";
import {
    ArrowRight,
    ArrowLeft,
    CheckCircle2,
    Clock,
    ShoppingBag,
    TrendingUp,
    FileSpreadsheet,
    BarChart3,
    Zap,
    RefreshCw,
} from "lucide-react";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { IntegrationMark } from "@/components/ui/IntegrationMark";

// ── Platform toggle data ──────────────────────────────────────────────────────

const PLATFORMS = [
    {
        id: "tiktok",
        label: "TikTok Ads",
        logo: INTEGRATION_LOGOS.tiktok,
        description: "Your TikTok Ads campaigns — spend, impressions, CTR, and conversions. Refreshed manually or nightly.",
        filename: "TikTok_Ads_Report.xlsx",
        headers: ["Campaign", "Spend", "Impressions", "Conv."],
        rows: [
            { cells: ["Spring Sale 2026",     "$1,240", "845,320", "312"], badge: "↑ 24%" },
            { cells: ["Brand Awareness Q2",   "$880",   "1.2M",    "98"],  badge: "" },
            { cells: ["Flash Sale Apr 15",    "$2,105", "2.6M",    "741"], badge: "↑ 61%" },
            { cells: ["Retargeting – VIP",    "$430",   "298,100", "189"], badge: "↑ 12%" },
            { cells: ["Interest – Fashion",   "$620",   "560,400", "143"], badge: "" },
        ],
        metric: { label: "Total Spend", value: "$5,275", sub: "Last 30 days" },
        syncNote: "↻ Synced today at 08:00 AM · Next in 55 min",
    },
    {
        id: "meta",
        label: "Meta Ads",
        logo: INTEGRATION_LOGOS.meta,
        description: "Facebook & Instagram ad metrics — reach, CPM, ROAS, and conversions by ad set.",
        filename: "Meta_Ads_Report.xlsx",
        headers: ["Ad Set", "Spend", "Reach", "ROAS"],
        rows: [
            { cells: ["Lookalike 1% – VN",      "$740",  "182,400", "4.2x"], badge: "↑ 18%" },
            { cells: ["Retargeting – Cart",      "$430",  "41,200",  "6.8x"], badge: "↑ 31%" },
            { cells: ["Interest – Online Shop",  "$380",  "290,100", "3.1x"], badge: "" },
            { cells: ["Instagram Stories",       "$210",  "412,800", "2.4x"], badge: "" },
            { cells: ["Vietnam Broad 18-45",     "$680",  "510,300", "2.9x"], badge: "↑ 9%" },
        ],
        metric: { label: "Avg. ROAS", value: "3.88x", sub: "Across all ad sets" },
        syncNote: "↻ Synced today at 08:00 AM · Next in 55 min",
    },
    {
        id: "shopee",
        label: "Shopee",
        logo: INTEGRATION_LOGOS.shopee,
        description: "Shopee orders, revenue, and top products — directly from your seller account.",
        filename: "Shopee_Orders_Report.xlsx",
        headers: ["Product", "Orders", "Revenue", "Rating"],
        rows: [
            { cells: ["Summer Dress – White",  "284",  "$4,260",  "4.9★"], badge: "Top" },
            { cells: ["Linen Pants – Beige",   "197",  "$3,152",  "4.8★"], badge: "" },
            { cells: ["Floral Blouse Set",     "163",  "$2,934",  "4.7★"], badge: "" },
            { cells: ["Casual Tote Bag",       "142",  "$1,704",  "4.6★"], badge: "" },
            { cells: ["Denim Shorts – Blue",   "118",  "$1,888",  "4.8★"], badge: "↑ 22%" },
        ],
        metric: { label: "Total Revenue", value: "$13,938", sub: "Last 30 days" },
        syncNote: "↻ Synced today at 08:00 AM · Next in 55 min",
    },
    {
        id: "google",
        label: "Google Ads",
        logo: INTEGRATION_LOGOS.googleAds,
        description: "Google Search, Shopping, and Performance Max — clicks, CPC, and conversions.",
        filename: "Google_Ads_Report.xlsx",
        headers: ["Campaign", "Spend", "Clicks", "Conv."],
        rows: [
            { cells: ["Brand Keywords",       "$620",  "1,940",  "143"], badge: "↑ 15%" },
            { cells: ["PMax – Shopping",      "$980",  "3,210",  "287"], badge: "↑ 28%" },
            { cells: ["Competitor Terms",     "$340",  "820",    "62"],  badge: "" },
            { cells: ["Display Remarketing",  "$180",  "410",    "38"],  badge: "" },
            { cells: ["YouTube – Awareness",  "$290",  "640",    "29"],  badge: "" },
        ],
        metric: { label: "Avg. CPC", value: "$0.94", sub: "Below industry avg." },
        syncNote: "↻ Synced today at 08:00 AM · Next in 55 min",
    },
];

const PAIN_POINTS = [
    "Copying TikTok Ads spend into Excel every morning",
    "Checking Shopee orders in one tab, Meta Ads in another",
    "Building the same weekly report manually, every week",
    "Not knowing which campaign is wasting your budget right now",
];

const FEATURES = [
    { icon: TrendingUp,    title: "TikTok & Meta Ads in one place",  desc: "See spend, impressions, clicks, and conversions from all your ad accounts side by side. No switching tabs." },
    { icon: ShoppingBag,   title: "Shopee order data",               desc: "Pull orders, revenue, and product performance from your Shopee seller account. Filter by date and status." },
    { icon: FileSpreadsheet,title: "Query from Google Sheets™",      desc: "Use the private add-on to choose an agency workspace and pull its current warehouse data into a sheet." },
    { icon: BarChart3,     title: "Looker Studio dashboards",        desc: "Query the latest completed workspace import from Looker Studio with a revocable API key." },
    { icon: RefreshCw,     title: "Visible refresh state",            desc: "Inspect the latest completed outcome and metric window before relying on a report." },
    { icon: Zap,           title: "Guided setup",                     desc: "Follow one documented path from provider authorization through import verification and reporting." },
];

export default function SMEsSolutionPage() {
    const [activePlatform, setActivePlatform] = useState(PLATFORMS[0]);

    return (
        <div className="flex flex-col items-center bg-canvas text-ink w-full selection:bg-accent/20 overflow-hidden font-sans">

            {/* ── HERO ─────────────────────────────────────────────────────── */}
            <section className="relative w-full pt-32 pb-24 px-4 sm:px-6 lg:px-8 overflow-hidden border-b border-line">
                <div className="relative z-10 w-full max-w-4xl mx-auto text-center flex flex-col items-center">
                    <h1 className="text-4xl sm:text-6xl md:text-7xl font-bold text-ink tracking-tight leading-[1.08] mb-6">
                        Stop copying data.<br className="hidden md:block" />
                        <span className="text-accent">
                            Start growing.
                        </span>
                    </h1>

                    <p className="text-base sm:text-lg text-ink-mute max-w-2xl mx-auto mb-10 leading-relaxed">
                        Monstera connects TikTok Ads, Meta Ads, Shopee, and Google Ads in one normalized warehouse for Data Explorer, Google Sheets™, Looker Studio™, and API access.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full mb-12">
                        <Link href="/register" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-black bg-white hover:bg-neutral-200 rounded-md transition-colors shadow-xs">
                            Start Free — No Credit Card
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                        <Link href="/pricing" className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-ink bg-panel border border-line hover:bg-[#16181c] rounded-md transition-colors">
                            See Pricing
                        </Link>
                    </div>

                    {/* Official partner logo strip */}
                    <div className="flex flex-col items-center gap-4 pt-2">
                        <p className="text-[10px] font-mono text-ink-mute uppercase tracking-widest">
                            Certified public workflows · Built for Southeast Asian reporting teams
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-3">
                            <IntegrationMark src={INTEGRATION_LOGOS.tiktok} alt="TikTok Ads" size="sm" />
                            <IntegrationMark src={INTEGRATION_LOGOS.meta} alt="Meta Ads" size="sm" />
                            <IntegrationMark src={INTEGRATION_LOGOS.shopee} alt="Shopee" size="sm" />
                            <IntegrationMark src={INTEGRATION_LOGOS.googleAds} alt="Google Ads" size="sm" />
                            <IntegrationMark src={INTEGRATION_LOGOS.googleSheets} alt="Google Sheets" size="sm" />
                            <IntegrationMark src={INTEGRATION_LOGOS.looker} alt="Looker Studio" size="sm" />
                        </div>
                    </div>
                </div>
            </section>

            {/* ── PAIN POINTS ──────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-b border-line">
                <div className="max-w-4xl mx-auto text-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-panel border border-line text-ink-mute text-xs font-semibold uppercase tracking-wider mb-6">
                        <Clock className="w-3.5 h-3.5 text-accent" />
                        <span>Sound familiar?</span>
                    </div>
                    <h2 className="text-3xl md:text-4xl font-bold text-ink tracking-tight mb-12">
                        Reporting work grows quickly across channels.
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left mb-12">
                        {PAIN_POINTS.map((pain) => (
                            <div key={pain} className="flex items-start gap-3 p-5 rounded-lg bg-panel border border-line">
                                <span className="mt-0.5 text-red-400 text-base font-bold leading-none">✗</span>
                                <p className="text-ink-mute text-xs sm:text-sm leading-relaxed">{pain}</p>
                            </div>
                        ))}
                    </div>
                    <p className="text-ink-mute text-base">
                        A consistent import and verification process reduces repeated preparation and makes data freshness easier to inspect.
                    </p>
                </div>
            </section>

            {/* ── INTERACTIVE PLATFORM TOGGLE ──────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-b border-line">
                <div className="max-w-5xl mx-auto">

                    {/* Header */}
                    <div className="text-center mb-14">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-panel border border-line text-accent text-xs font-semibold uppercase tracking-wider mb-6">
                            Live preview
                        </div>
                        <h2 className="text-3xl md:text-5xl font-bold text-ink tracking-tight mb-4">
                            See exactly what you get.
                        </h2>
                        <p className="text-ink-mute text-sm sm:text-base max-w-xl mx-auto">
                            Pick a platform and see how normalized warehouse data can be queried in Google Sheets™ after a manual or nightly refresh.
                        </p>
                    </div>

                    {/* Platform pill toggles */}
                    <div className="flex flex-wrap justify-center gap-2 mb-10">
                        {PLATFORMS.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => setActivePlatform(p)}
                                className={`
                                    inline-flex items-center gap-2 px-4 py-2 rounded-md border text-xs font-semibold
                                    transition-colors cursor-pointer
                                    ${activePlatform.id === p.id 
                                        ? "bg-white text-black border-white shadow-xs" 
                                        : "bg-panel border-line text-ink-mute hover:text-ink hover:border-[#333]"}
                                `}
                            >
                                <IntegrationMark src={p.logo} alt={p.label} size="sm" />
                                <span>{p.label}</span>
                            </button>
                        ))}
                    </div>

                    {/* Description line */}
                    <p className="text-center text-xs text-ink-mute mb-8">
                        {activePlatform.description}
                    </p>

                    {/* Data preview card */}
                    <div className="rounded-lg border border-line bg-panel overflow-hidden shadow-sm">
                        {/* Window chrome */}
                        <div className="bg-canvas px-4 py-3 flex items-center gap-2 border-b border-line">
                            <div className="w-2.5 h-2.5 rounded-full bg-[#333]" />
                            <div className="w-2.5 h-2.5 rounded-full bg-[#333]" />
                            <div className="w-2.5 h-2.5 rounded-full bg-[#333]" />
                            <div className="flex items-center gap-2 ml-3">
                                <IntegrationMark src={activePlatform.logo} alt={activePlatform.label} size="sm" />
                                <span className="text-xs text-ink-mute font-mono">{activePlatform.filename} — warehouse export preview</span>
                            </div>
                        </div>

                        <div className="p-6 md:p-8">
                            {/* Metric highlight */}
                            <div className="flex items-start justify-between mb-8">
                                <div>
                                    <p className="text-[10px] text-ink-mute uppercase tracking-widest font-bold mb-2">{activePlatform.metric.label}</p>
                                    <p className="text-4xl md:text-5xl font-bold tracking-tight text-ink">{activePlatform.metric.value}</p>
                                    <p className="text-xs text-ink-mute mt-2">{activePlatform.metric.sub}</p>
                                </div>
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md text-xs font-medium border border-line bg-canvas text-ink">
                                    <IntegrationMark src={activePlatform.logo} alt={activePlatform.label} size="sm" />
                                    <span>{activePlatform.label}</span>
                                </div>
                            </div>

                            {/* Table */}
                            <div className="font-mono text-xs">
                                <div className="grid grid-cols-4 gap-4 text-ink-mute font-bold text-[10px] uppercase tracking-wider border-b border-line pb-3 mb-1">
                                    {activePlatform.headers.map((h) => (
                                        <span key={h}>{h}</span>
                                    ))}
                                </div>
                                {activePlatform.rows.map((row, i) => (
                                    <div
                                        key={i}
                                        className="grid grid-cols-4 gap-4 text-[12px] py-3 border-b border-line/40 items-center hover:bg-canvas/50 transition-colors"
                                    >
                                        <span className="text-ink truncate flex items-center gap-1.5">
                                            {row.cells[0]}
                                            {row.badge && (
                                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-canvas border border-line text-accent">
                                                    {row.badge}
                                                </span>
                                            )}
                                        </span>
                                        <span className="text-ink font-medium">{row.cells[1]}</span>
                                        <span className="text-ink-mute">{row.cells[2]}</span>
                                        <span className="text-accent">{row.cells[3]}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Sync footer */}
                            <p className="mt-6 text-[10px] text-ink-mute font-mono">
                                {activePlatform.syncNote}
                            </p>
                        </div>
                    </div>

                    <p className="text-center text-xs text-ink-mute mt-6">
                        Verify imported rows in Data Explorer, then query the same warehouse data from Google Sheets™ or Looker Studio.
                    </p>
                </div>
            </section>

            {/* ── FEATURES GRID ────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-b border-line">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-14">
                        <h2 className="text-3xl md:text-4xl font-bold text-ink tracking-tight mb-4">
                            Everything your business needs.
                        </h2>
                        <p className="text-ink-mute text-sm sm:text-base max-w-xl mx-auto">One workspace for connected sources, freshness checks, and exports.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {FEATURES.map((f) => {
                            const Icon = f.icon;
                            return (
                                <div key={f.title} className="p-6 rounded-lg bg-panel border border-line transition-colors hover:border-[#333]">
                                    <div className="w-10 h-10 rounded-md bg-canvas border border-line flex items-center justify-center mb-5 text-accent">
                                        <Icon className="w-5 h-5" />
                                    </div>
                                    <h3 className="text-base font-bold text-ink mb-2">{f.title}</h3>
                                    <p className="text-ink-mute text-xs leading-relaxed">{f.desc}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* ── HOW IT WORKS ─────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-b border-line">
                <div className="max-w-4xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold text-ink tracking-tight mb-4">
                            Up and running in 3 steps.
                        </h2>
                        <p className="text-ink-mute text-sm">No IT team. No code. No meetings.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {[
                            { step: "01", title: "Connect your platforms", desc: "Choose a certified source, complete its provider authorization, and confirm it appears in the intended workspace." },
                            { step: "02", title: "Choose your destination", desc: "Use the Google Sheets™ add-on identity flow or a workspace API key for the Looker Studio connector." },
                            { step: "03", title: "Verify freshness", desc: "Run the first import, inspect rows in Data Explorer, and confirm the configured plan cadence before relying on later refreshes." },
                        ].map((item) => (
                            <div key={item.step} className="p-6 rounded-lg bg-panel border border-line flex flex-col items-start">
                                <div className="text-3xl font-bold text-ink-mute mb-3 font-mono">
                                    {item.step}
                                </div>
                                <h3 className="text-base font-bold text-ink mb-2">{item.title}</h3>
                                <p className="text-ink-mute text-xs leading-relaxed">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── WHAT YOU GET ─────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-b border-line">
                <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-panel border border-line text-accent text-xs font-semibold uppercase tracking-wider mb-6">
                            What you get
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold text-ink tracking-tight mb-8">
                            Your full picture. Every morning.
                        </h2>
                        <ul className="space-y-3.5">
                            {[
                                "TikTok Ads: spend, impressions, clicks, conversions by campaign",
                                "Meta Ads: reach, CPM, ROAS broken down by ad set",
                                "Shopee: orders, revenue, and top products by date",
                                "Google Ads: CPC, clicks, conversions by campaign",
                                "Google Sheets™ add-on queries for selected warehouse data",
                                "All platforms in one workspace — not scattered across 5 tabs",
                            ].map((item) => (
                                <li key={item} className="flex items-start gap-3">
                                    <CheckCircle2 className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                                    <span className="text-ink-mute text-xs sm:text-sm leading-relaxed">{item}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Mini stat cards */}
                    <div className="grid grid-cols-2 gap-4">
                        {[
                            { label: "Certified sources", value: "4", sub: "Meta, Google, TikTok Ads, Shopee" },
                            { label: "Report destinations", value: "2", sub: "Google Sheets and Looker Studio" },
                            { label: "Pilot cadence", value: "Plan", sub: "Shown in configured limits" },
                            { label: "Verification", value: "Visible", sub: "Rows, dates, and sync outcome" },
                        ].map((stat) => (
                            <div key={stat.label} className="p-5 rounded-lg bg-panel border border-line flex flex-col gap-1">
                                <p className="text-[11px] text-ink-mute font-medium">{stat.label}</p>
                                <p className="text-2xl font-bold text-ink">
                                    {stat.value}
                                </p>
                                <p className="text-[11px] text-ink-mute">{stat.sub}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── CTA ──────────────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8">
                <div className="max-w-3xl mx-auto">
                    <div className="relative border border-line bg-panel rounded-lg p-10 md:p-14 text-center">
                        <h2 className="text-3xl md:text-4xl font-bold text-ink tracking-tight mb-4">
                            Ready to get your time back?
                        </h2>
                        <p className="text-ink-mute mb-8 max-w-md mx-auto text-xs sm:text-sm leading-relaxed">
                            Start with one certified source, verify its first import, and expand only after the reporting totals reconcile.
                        </p>
                        <Link href="/register" className="inline-flex items-center gap-2 px-8 py-3.5 text-sm font-semibold text-black bg-white hover:bg-neutral-200 rounded-md shadow-xs transition-colors">
                            Start Free Today
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                        <p className="mt-8 text-[10px] text-ink-mute uppercase tracking-[0.2em] font-medium">
                            Free plan available · Paid pilot activation is operator-managed
                        </p>
                    </div>
                </div>

                <div className="max-w-4xl mx-auto mt-16 text-center">
                    <Link href="/" className="inline-flex items-center text-xs font-medium text-ink-mute hover:text-ink transition-colors">
                        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Platform Overview
                    </Link>
                    <p className="mt-6 text-[10px] text-ink-mute font-medium italic">
                        Google Sheets™ and Google Workspace™ are trademarks of Google LLC.
                    </p>
                </div>
            </section>

        </div>
    );
}
