"use client";

import Link from "next/link";
import Image from "next/image";
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

// ── Platform toggle data ──────────────────────────────────────────────────────

const PLATFORMS = [
    {
        id: "tiktok",
        label: "TikTok Ads",
        logo: "/logos/tiktok.svg",
        pillActive: "bg-pink-50 border-pink-300 text-pink-600",
        pillInactive: "border-gray-200 text-slate-400 hover:text-slate-600 hover:border-gray-300",
        accent: "text-pink-600",
        cardBorder: "border-t-pink-400",
        cardGlow: "shadow-pink-500/10",
        cardBg: "bg-white",
        badgeClass: "bg-pink-50 border-pink-200 text-pink-600",
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
        logo: "/logos/meta.svg",
        pillActive: "bg-blue-50 border-blue-300 text-blue-600",
        pillInactive: "border-gray-200 text-slate-400 hover:text-slate-600 hover:border-gray-300",
        accent: "text-blue-600",
        cardBorder: "border-t-blue-400",
        cardGlow: "shadow-blue-500/10",
        cardBg: "bg-white",
        badgeClass: "bg-blue-50 border-blue-200 text-blue-600",
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
        logo: "/logos/shopee.svg",
        pillActive: "bg-orange-50 border-orange-300 text-orange-600",
        pillInactive: "border-gray-200 text-slate-400 hover:text-slate-600 hover:border-gray-300",
        accent: "text-orange-600",
        cardBorder: "border-t-orange-400",
        cardGlow: "shadow-orange-500/10",
        cardBg: "bg-white",
        badgeClass: "bg-orange-50 border-orange-200 text-orange-600",
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
        logo: "/logos/google-ads.svg",
        pillActive: "bg-green-50 border-green-300 text-green-600",
        pillInactive: "border-gray-200 text-slate-400 hover:text-slate-600 hover:border-gray-300",
        accent: "text-green-600",
        cardBorder: "border-t-green-400",
        cardGlow: "shadow-green-500/10",
        cardBg: "bg-white",
        badgeClass: "bg-green-50 border-green-200 text-green-600",
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
    { icon: TrendingUp,    color: "cyan", title: "TikTok & Meta Ads in one place",  desc: "See spend, impressions, clicks, and conversions from all your ad accounts side by side. No switching tabs." },
    { icon: ShoppingBag,   color: "orange",  title: "Shopee order data",               desc: "Pull orders, revenue, and product performance from your Shopee seller account. Filter by date and status." },
    { icon: FileSpreadsheet,color:"blue",    title: "Query from Google Sheets™",     desc: "Use the private add-on to choose an agency workspace and pull its current warehouse data into a sheet." },
    { icon: BarChart3,     color: "purple",  title: "Looker Studio dashboards",        desc: "Connect to Looker Studio for beautiful charts. Share live reports with your team or your boss." },
    { icon: RefreshCw,     color: "cyan", title: "Scheduled auto-sync",             desc: "Set it and forget it. Monstera syncs your data on a schedule so your numbers are always up to date." },
    { icon: Zap,           color: "yellow",  title: "No engineers needed",             desc: "Built for business owners, not developers. Connect your accounts in minutes with just a few clicks." },
];

const colorMap: Record<string, string> = {
    cyan: "text-cyan-600 bg-cyan-50 group-hover:bg-cyan-100",
    orange:  "text-orange-600 bg-orange-50 group-hover:bg-orange-100",
    blue:    "text-blue-600 bg-blue-50 group-hover:bg-blue-100",
    purple:  "text-purple-600 bg-purple-50 group-hover:bg-purple-100",
    yellow:  "text-amber-600 bg-amber-50 group-hover:bg-amber-100",
};

const borderMap: Record<string, string> = {
    cyan: "hover:border-cyan-200",
    orange:  "hover:border-orange-200",
    blue:    "hover:border-blue-200",
    purple:  "hover:border-purple-200",
    yellow:  "hover:border-amber-200",
};

export default function SMEsSolutionPage() {
    const [activePlatform, setActivePlatform] = useState(PLATFORMS[0]);

    return (
        <div className="flex flex-col items-center bg-white text-slate-800 w-full selection:bg-cyan-500/20 overflow-hidden font-sans">

            {/* ── HERO ─────────────────────────────────────────────────────── */}
            <section className="relative w-full pt-32 pb-24 px-4 sm:px-6 lg:px-8 overflow-hidden border-b border-gray-100">
                <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-cyan-500/10 blur-[140px] rounded-full" />

                <div className="relative z-10 w-full max-w-4xl mx-auto text-center flex flex-col items-center">
                    <h1 className="text-5xl md:text-7xl font-black text-slate-900 tracking-tight leading-[1.08] mb-6">
                        Stop copying data.<br className="hidden md:block" />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 to-cyan-600">
                            Start growing.
                        </span>
                    </h1>

                    <p className="text-lg md:text-xl text-slate-500 max-w-2xl mx-auto mb-10 leading-relaxed">
                        Monstera connects TikTok Ads, Meta Ads, Shopee, and Google Ads in one normalized warehouse for Data Explorer, Google Sheets™, Looker Studio™, and API access.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full mb-12">
                        <Link href="/register" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-bold text-white bg-cyan-600 hover:bg-cyan-700 rounded-xl transition-all shadow-lg shadow-cyan-600/20">
                            Start Free — No Credit Card
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                        <Link href="/pricing" className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-slate-600 border border-gray-200 hover:border-gray-300 rounded-xl transition-all">
                            See Pricing
                        </Link>
                    </div>

                    {/* Official partner logo strip */}
                    <div className="flex flex-col items-center gap-4 pt-2">
                        <p className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
                            Official API Partner · Trusted by sellers across Vietnam · Indonesia · Thailand
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-6 opacity-50 hover:opacity-70 transition-opacity">
                            <Image src={INTEGRATION_LOGOS.tiktok}       alt="TikTok Ads"    width={20} height={20} className="h-5 w-auto" />
                            <Image src={INTEGRATION_LOGOS.meta}         alt="Meta Ads"      width={20} height={20} className="h-5 w-auto" />
                            <Image src={INTEGRATION_LOGOS.shopee}       alt="Shopee"        width={20} height={20} className="h-5 w-auto" />
                            <Image src={INTEGRATION_LOGOS.googleAds}    alt="Google Ads"    width={20} height={20} className="h-5 w-auto" />
                            <Image src={INTEGRATION_LOGOS.googleSheets} alt="Google Sheets" width={20} height={20} className="h-5 w-auto" />
                            <Image src={INTEGRATION_LOGOS.looker}       alt="Looker Studio" width={20} height={20} className="h-5 w-auto" />
                        </div>
                    </div>
                </div>
            </section>

            {/* ── PAIN POINTS ──────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8">
                <div className="max-w-4xl mx-auto text-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-50 border border-red-200 text-red-500 text-xs font-bold uppercase tracking-widest mb-6">
                        <Clock className="w-3 h-3" /> Sound familiar?
                    </div>
                    <h2 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight mb-12">
                        Every SME seller wastes hours on this.
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left mb-12">
                        {PAIN_POINTS.map((pain) => (
                            <div key={pain} className="flex items-start gap-3 p-5 rounded-2xl bg-red-50/50 border border-red-100">
                                <span className="mt-0.5 text-red-400 text-lg leading-none">✗</span>
                                <p className="text-slate-600 text-sm leading-relaxed">{pain}</p>
                            </div>
                        ))}
                    </div>
                    <p className="text-slate-500 text-lg">
                        That's <span className="text-slate-900 font-bold">5–10 hours a week</span> you could spend on growing your business instead.
                    </p>
                </div>
            </section>

            {/* ── INTERACTIVE PLATFORM TOGGLE ──────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-t border-gray-100">
                <div className="max-w-5xl mx-auto">

                    {/* Header */}
                    <div className="text-center mb-14">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-50 border border-cyan-200 text-cyan-600 text-xs font-bold uppercase tracking-widest mb-6">
                            Live preview
                        </div>
                        <h2 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight mb-4">
                            See exactly what you get.
                        </h2>
                        <p className="text-slate-500 text-lg max-w-xl mx-auto">
                            Pick a platform and see how normalized warehouse data can be queried in Google Sheets™ after a manual or nightly refresh.
                        </p>
                    </div>

                    {/* Platform pill toggles */}
                    <div className="flex flex-wrap justify-center gap-3 mb-10">
                        {PLATFORMS.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => setActivePlatform(p)}
                                className={`
                                    inline-flex items-center gap-2.5 px-5 py-2.5 rounded-full border text-sm font-semibold
                                    transition-all duration-200 cursor-pointer
                                    ${activePlatform.id === p.id ? p.pillActive : p.pillInactive}
                                `}
                            >
                                <Image
                                    src={p.logo}
                                    alt={p.label}
                                    width={16}
                                    height={16}
                                    className="h-4 w-4 object-contain"
                                />
                                {p.label}
                            </button>
                        ))}
                    </div>

                    {/* Description line */}
                    <p className={`text-center text-sm mb-8 transition-all duration-300 ${activePlatform.accent}`}>
                        {activePlatform.description}
                    </p>

                    {/* Data preview card */}
                    <div className={`
                        rounded-2xl border border-t-2 overflow-hidden
                        transition-all duration-300
                        ${activePlatform.cardBg} ${activePlatform.cardBorder} ${activePlatform.cardGlow} shadow-xl
                        border-gray-200
                    `}>
                        {/* Window chrome */}
                        <div className="bg-slate-50 px-5 py-4 flex items-center gap-2 border-b border-gray-200">
                            <div className="w-3 h-3 rounded-full bg-red-400" />
                            <div className="w-3 h-3 rounded-full bg-amber-400" />
                            <div className="w-3 h-3 rounded-full bg-green-400" />
                            <div className="flex items-center gap-2 ml-3">
                                <Image src={activePlatform.logo} alt={activePlatform.label} width={14} height={14} className="h-3.5 w-3.5 object-contain" />
                                <span className="text-xs text-slate-400 font-mono">{activePlatform.filename} — warehouse export preview</span>
                            </div>
                        </div>

                        <div className="p-8">
                            {/* Metric highlight */}
                            <div className="flex items-start justify-between mb-8">
                                <div>
                                    <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-2">{activePlatform.metric.label}</p>
                                    <p className={`text-5xl font-black tracking-tight ${activePlatform.accent}`}>{activePlatform.metric.value}</p>
                                    <p className="text-xs text-slate-400 mt-2">{activePlatform.metric.sub}</p>
                                </div>
                                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${activePlatform.badgeClass}`}>
                                    <Image src={activePlatform.logo} alt={activePlatform.label} width={12} height={12} className="h-3 w-3 object-contain" />
                                    {activePlatform.label}
                                </div>
                            </div>

                            {/* Table */}
                            <div className="font-mono text-xs">
                                <div className="grid grid-cols-4 gap-4 text-slate-400 font-bold text-[10px] uppercase tracking-wider border-b border-gray-100 pb-3 mb-1">
                                    {activePlatform.headers.map((h) => (
                                        <span key={h}>{h}</span>
                                    ))}
                                </div>
                                {activePlatform.rows.map((row, i) => (
                                    <div
                                        key={i}
                                        className="grid grid-cols-4 gap-4 text-[12px] py-3.5 border-b border-gray-50 items-center hover:bg-slate-50/50 transition-colors"
                                    >
                                        <span className="text-slate-700 truncate flex items-center gap-1.5">
                                            {row.cells[0]}
                                            {row.badge && (
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${activePlatform.badgeClass}`}>
                                                    {row.badge}
                                                </span>
                                            )}
                                        </span>
                                        <span className={activePlatform.accent}>{row.cells[1]}</span>
                                        <span className="text-blue-500">{row.cells[2]}</span>
                                        <span className="text-purple-500">{row.cells[3]}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Sync footer */}
                            <p className="mt-6 text-[10px] text-slate-400 font-mono">
                                {activePlatform.syncNote}
                            </p>
                        </div>
                    </div>

                    <p className="text-center text-xs text-slate-400 mt-6">
                        This data goes directly into your Google Sheets™ — or use it in Looker Studio for live dashboards.
                    </p>
                </div>
            </section>

            {/* ── FEATURES GRID ────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-t border-gray-100 bg-slate-50/50">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-14">
                        <h2 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight mb-4">
                            Everything your business needs.
                        </h2>
                        <p className="text-slate-500 max-w-xl mx-auto">One workspace for connected sources, freshness checks, and exports.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {FEATURES.map((f) => {
                            const Icon = f.icon;
                            return (
                                <div key={f.title} className={`p-8 rounded-2xl bg-white border border-gray-200 ${borderMap[f.color]} transition-all group shadow-sm`}>
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 transition-colors ${colorMap[f.color]}`}>
                                        <Icon className="w-6 h-6" />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-900 mb-3">{f.title}</h3>
                                    <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* ── HOW IT WORKS ─────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-t border-gray-100">
                <div className="max-w-4xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight mb-4">
                            Up and running in 3 steps.
                        </h2>
                        <p className="text-slate-500">No IT team. No code. No meetings.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {[
                            { step: "01", color: "cyan", title: "Connect your platforms", desc: "Sign in with TikTok Ads, Meta Ads, Shopee, or Google Ads. Takes 2 minutes. We handle the OAuth — you just click Authorize." },
                            { step: "02", color: "blue",    title: "Choose your destination", desc: "Send data to Google Sheets™ with our add-on, or build a live Looker Studio dashboard with our connector." },
                            { step: "03", color: "purple",  title: "Verify freshness", desc: "Run the first import, inspect rows in Data Explorer, then rely on manual and nightly warehouse refresh." },
                        ].map((item) => (
                            <div key={item.step} className="flex flex-col items-start">
                                <div className={`text-5xl font-black mb-4 ${item.color === "cyan" ? "text-cyan-200" : item.color === "blue" ? "text-blue-200" : "text-purple-200"}`}>
                                    {item.step}
                                </div>
                                <h3 className="text-xl font-bold text-slate-900 mb-3">{item.title}</h3>
                                <p className="text-slate-500 text-sm leading-relaxed">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── WHAT YOU GET ─────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-t border-gray-100 bg-slate-50/50">
                <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-50 border border-cyan-200 text-cyan-600 text-xs font-bold uppercase tracking-widest mb-6">
                            What you get
                        </div>
                        <h2 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight mb-8">
                            Your full picture. Every morning.
                        </h2>
                        <ul className="space-y-4">
                            {[
                                "TikTok Ads: spend, impressions, clicks, conversions by campaign",
                                "Meta Ads: reach, CPM, ROAS broken down by ad set",
                                "Shopee: orders, revenue, and top products by date",
                                "Google Ads: CPC, clicks, conversions by campaign",
                                "Google Sheets™ auto-updated — no manual export needed",
                                "All platforms in one workspace — not scattered across 5 tabs",
                            ].map((item) => (
                                <li key={item} className="flex items-start gap-3">
                                    <CheckCircle2 className="w-5 h-5 text-cyan-500 shrink-0 mt-0.5" />
                                    <span className="text-slate-600 text-sm leading-relaxed">{item}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Mini stat cards */}
                    <div className="grid grid-cols-2 gap-4">
                        {[
                            { label: "Hours saved per week",  value: "8–10h",  color: "cyan", sub: "On manual reporting" },
                            { label: "Platforms connected",   value: "4+",     color: "blue",    sub: "TikTok, Meta, Shopee, Google" },
                            { label: "Pilot refresh",         value: "Nightly", color: "purple", sub: "+ manual refresh" },
                            { label: "Setup time",            value: "< 2min", color: "orange",  sub: "No engineers needed" },
                        ].map((stat) => (
                            <div key={stat.label} className="p-6 rounded-2xl bg-white border border-gray-200 flex flex-col gap-1 shadow-sm">
                                <p className="text-xs text-slate-400 font-medium">{stat.label}</p>
                                <p className={`text-2xl font-black ${stat.color === "cyan" ? "text-cyan-600" : stat.color === "blue" ? "text-blue-600" : stat.color === "purple" ? "text-purple-600" : "text-orange-600"}`}>
                                    {stat.value}
                                </p>
                                <p className="text-xs text-slate-400">{stat.sub}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── CTA ──────────────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-t border-gray-100">
                <div className="max-w-3xl mx-auto">
                    <div className="relative border border-cyan-200 bg-cyan-50/60 rounded-3xl overflow-hidden">
                        <div className="pointer-events-none absolute top-0 left-0 w-64 h-64 bg-cyan-400/10 blur-[80px]" />
                        <div className="pointer-events-none absolute bottom-0 right-0 w-64 h-64 bg-cyan-400/10 blur-[80px]" />
                        <div className="relative px-8 py-20 text-center">
                            <h2 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight mb-4">
                                Ready to get your time back?
                            </h2>
                            <p className="text-slate-500 mb-10 max-w-md mx-auto">
                                Connect your first data source in under 2 minutes. Free plan available — no credit card required.
                            </p>
                            <Link href="/register" className="group inline-flex items-center gap-2 px-10 py-5 text-lg font-bold text-white bg-cyan-600 hover:bg-cyan-700 rounded-xl shadow-xl shadow-cyan-600/20 transition-all">
                                Start Free Today
                                <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                            </Link>
                            <p className="mt-8 text-[10px] text-slate-400 uppercase tracking-[0.3em] font-bold">
                                Free plan available · VND + USD billing · Cancel anytime
                            </p>
                        </div>
                    </div>
                </div>

                <div className="max-w-4xl mx-auto mt-16 text-center">
                    <Link href="/" className="inline-flex items-center text-sm font-medium text-slate-400 hover:text-slate-900 transition-colors">
                        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Platform Overview
                    </Link>
                    <p className="mt-6 text-[10px] text-slate-400 font-medium italic">
                        Google Sheets™ and Google Workspace™ are trademarks of Google LLC.
                    </p>
                </div>
            </section>

        </div>
    );
}
