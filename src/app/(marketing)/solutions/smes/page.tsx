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
import { DataStreamBackground } from "@/components/DataStreamBackground";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";

// ── Platform toggle data ──────────────────────────────────────────────────────

const PLATFORMS = [
    {
        id: "tiktok",
        label: "TikTok Ads",
        logo: "/logos/tiktok.svg",
        pillActive: "bg-pink-500/10 border-pink-500/50 text-pink-300",
        pillInactive: "border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20",
        accent: "text-pink-400",
        cardBorder: "border-t-pink-500/60",
        cardGlow: "shadow-pink-500/15",
        cardBg: "bg-gradient-to-br from-pink-500/5 via-[#09090b] to-[#09090b]",
        badgeClass: "bg-pink-500/15 border-pink-500/30 text-pink-300",
        description: "Your TikTok Ads campaigns — spend, impressions, CTR, and conversions. Updated hourly.",
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
        pillActive: "bg-blue-500/10 border-blue-500/50 text-blue-300",
        pillInactive: "border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20",
        accent: "text-blue-400",
        cardBorder: "border-t-blue-500/60",
        cardGlow: "shadow-blue-500/15",
        cardBg: "bg-gradient-to-br from-blue-500/5 via-[#09090b] to-[#09090b]",
        badgeClass: "bg-blue-500/15 border-blue-500/30 text-blue-300",
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
        pillActive: "bg-orange-500/10 border-orange-500/50 text-orange-300",
        pillInactive: "border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20",
        accent: "text-orange-400",
        cardBorder: "border-t-orange-500/60",
        cardGlow: "shadow-orange-500/15",
        cardBg: "bg-gradient-to-br from-orange-500/5 via-[#09090b] to-[#09090b]",
        badgeClass: "bg-orange-500/15 border-orange-500/30 text-orange-300",
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
        pillActive: "bg-emerald-500/10 border-emerald-500/50 text-emerald-300",
        pillInactive: "border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20",
        accent: "text-emerald-400",
        cardBorder: "border-t-emerald-500/60",
        cardGlow: "shadow-emerald-500/15",
        cardBg: "bg-gradient-to-br from-emerald-500/5 via-[#09090b] to-[#09090b]",
        badgeClass: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
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
    { icon: TrendingUp,    color: "emerald", title: "TikTok & Meta Ads in one place",  desc: "See spend, impressions, clicks, and conversions from all your ad accounts side by side. No switching tabs." },
    { icon: ShoppingBag,   color: "orange",  title: "Shopee order data",               desc: "Pull orders, revenue, and product performance from your Shopee seller account. Filter by date and status." },
    { icon: FileSpreadsheet,color:"blue",    title: "Auto-updates Google Sheets™",     desc: "Install our add-on once. Your spreadsheet refreshes automatically — hourly or daily — with zero manual work." },
    { icon: BarChart3,     color: "purple",  title: "Looker Studio dashboards",        desc: "Connect to Looker Studio for beautiful charts. Share live reports with your team or your boss." },
    { icon: RefreshCw,     color: "emerald", title: "Scheduled auto-sync",             desc: "Set it and forget it. Monstera syncs your data on a schedule so your numbers are always up to date." },
    { icon: Zap,           color: "yellow",  title: "No engineers needed",             desc: "Built for business owners, not developers. Connect your accounts in minutes with just a few clicks." },
];

const colorMap: Record<string, string> = {
    emerald: "text-emerald-400 bg-emerald-500/10 group-hover:bg-emerald-500/20",
    orange:  "text-orange-400 bg-orange-500/10 group-hover:bg-orange-500/20",
    blue:    "text-blue-400 bg-blue-500/10 group-hover:bg-blue-500/20",
    purple:  "text-purple-400 bg-purple-500/10 group-hover:bg-purple-500/20",
    yellow:  "text-yellow-400 bg-yellow-500/10 group-hover:bg-yellow-500/20",
};

const borderMap: Record<string, string> = {
    emerald: "hover:border-emerald-500/30",
    orange:  "hover:border-orange-500/30",
    blue:    "hover:border-blue-500/30",
    purple:  "hover:border-purple-500/30",
    yellow:  "hover:border-yellow-500/30",
};

export default function SMEsSolutionPage() {
    const [activePlatform, setActivePlatform] = useState(PLATFORMS[0]);

    return (
        <div className="flex flex-col items-center bg-[#09090b] text-slate-200 w-full selection:bg-emerald-500/30 overflow-hidden font-sans">

            {/* ── HERO ─────────────────────────────────────────────────────── */}
            <section className="relative w-full min-h-[90vh] flex flex-col items-center justify-center pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden border-b border-white/5">
                <DataStreamBackground />
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_60%,transparent_100%)] pointer-events-none opacity-40 z-0" />

                <div className="relative z-10 w-full max-w-4xl mx-auto text-center flex flex-col items-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-bold tracking-widest uppercase mb-8">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                        For SME Sellers · Vietnam & Southeast Asia
                    </div>

                    <h1 className="text-5xl md:text-7xl font-black text-white tracking-tight leading-[1.08] mb-6">
                        Stop copying data.<br className="hidden md:block" />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-500">
                            Start growing.
                        </span>
                    </h1>

                    <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
                        Monstera connects your TikTok Ads, Meta Ads, Shopee, and Google Ads — and automatically delivers your numbers into Google Sheets™ or a live dashboard. No code. No manual work.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full mb-12">
                        <Link href="/register" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-2xl transition-all shadow-xl shadow-emerald-500/20">
                            Start Free — No Credit Card
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                        <Link href="/pricing" className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-white bg-white/5 border border-white/10 hover:bg-white/10 rounded-2xl transition-all">
                            See Pricing
                        </Link>
                    </div>

                    {/* Official partner logo strip */}
                    <div className="flex flex-col items-center gap-4 pt-2">
                        <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">
                            Official API Partner · Trusted by sellers across Vietnam · Indonesia · Thailand
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-6 opacity-50 hover:opacity-70 transition-opacity">
                            <img src={INTEGRATION_LOGOS.tiktok}       alt="TikTok Ads"    className="h-5 w-auto brightness-0 invert" />
                            <img src={INTEGRATION_LOGOS.meta}         alt="Meta Ads"      className="h-5 w-auto brightness-0 invert" />
                            <img src={INTEGRATION_LOGOS.shopee}       alt="Shopee"        className="h-5 w-auto brightness-0 invert" />
                            <img src={INTEGRATION_LOGOS.googleAds}    alt="Google Ads"    className="h-5 w-auto brightness-0 invert" />
                            <img src={INTEGRATION_LOGOS.googleSheets} alt="Google Sheets" className="h-5 w-auto brightness-0 invert" />
                            <img src={INTEGRATION_LOGOS.looker}       alt="Looker Studio" className="h-5 w-auto brightness-0 invert" />
                        </div>
                    </div>
                </div>
            </section>

            {/* ── PAIN POINTS ──────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 bg-[#09090b]">
                <div className="max-w-4xl mx-auto text-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold uppercase tracking-widest mb-6">
                        <Clock className="w-3 h-3" /> Sound familiar?
                    </div>
                    <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-12">
                        Every SME seller wastes hours on this.
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left mb-12">
                        {PAIN_POINTS.map((pain) => (
                            <div key={pain} className="flex items-start gap-3 p-5 rounded-2xl bg-white/5 border border-white/10">
                                <span className="mt-0.5 text-red-400 text-lg leading-none">✗</span>
                                <p className="text-gray-300 text-sm leading-relaxed">{pain}</p>
                            </div>
                        ))}
                    </div>
                    <p className="text-gray-400 text-lg">
                        That's <span className="text-white font-bold">5–10 hours a week</span> you could spend on growing your business instead.
                    </p>
                </div>
            </section>

            {/* ── INTERACTIVE PLATFORM TOGGLE ──────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-t border-white/5 bg-gradient-to-b from-[#09090b] to-[#0d1117]">
                <div className="max-w-5xl mx-auto">

                    {/* Header */}
                    <div className="text-center mb-14">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-widest mb-6">
                            Live preview
                        </div>
                        <h2 className="text-3xl md:text-5xl font-black text-white tracking-tight mb-4">
                            See exactly what you get.
                        </h2>
                        <p className="text-gray-400 text-lg max-w-xl mx-auto">
                            Pick a platform and see how your data looks in Google Sheets™ — auto-synced every hour.
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
                                <img
                                    src={p.logo}
                                    alt={p.label}
                                    className="h-4 w-4 object-contain brightness-0 invert opacity-80"
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
                        rounded-2xl border border-t-2 overflow-hidden shadow-2xl
                        transition-all duration-300
                        ${activePlatform.cardBg} ${activePlatform.cardBorder} ${activePlatform.cardGlow} shadow-xl
                        border-white/10
                    `}>
                        {/* Window chrome */}
                        <div className="bg-black/30 px-5 py-4 flex items-center gap-2 border-b border-white/5">
                            <div className="w-3 h-3 rounded-full bg-red-500/80" />
                            <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                            <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                            <div className="flex items-center gap-2 ml-3">
                                <img src={activePlatform.logo} alt={activePlatform.label} className="h-3.5 w-3.5 object-contain brightness-0 invert opacity-60" />
                                <span className="text-xs text-gray-500 font-mono">{activePlatform.filename} — auto-synced</span>
                            </div>
                        </div>

                        <div className="p-8">
                            {/* Metric highlight */}
                            <div className="flex items-start justify-between mb-8">
                                <div>
                                    <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">{activePlatform.metric.label}</p>
                                    <p className={`text-5xl font-black tracking-tight ${activePlatform.accent}`}>{activePlatform.metric.value}</p>
                                    <p className="text-xs text-gray-600 mt-2">{activePlatform.metric.sub}</p>
                                </div>
                                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${activePlatform.badgeClass}`}>
                                    <img src={activePlatform.logo} alt={activePlatform.label} className="h-3 w-3 object-contain brightness-0 invert opacity-70" />
                                    {activePlatform.label}
                                </div>
                            </div>

                            {/* Table */}
                            <div className="font-mono text-xs">
                                <div className="grid grid-cols-4 gap-4 text-gray-500 font-bold text-[10px] uppercase tracking-wider border-b border-white/8 pb-3 mb-1">
                                    {activePlatform.headers.map((h) => (
                                        <span key={h}>{h}</span>
                                    ))}
                                </div>
                                {activePlatform.rows.map((row, i) => (
                                    <div
                                        key={i}
                                        className="grid grid-cols-4 gap-4 text-[12px] py-3.5 border-b border-white/5 items-center hover:bg-white/[0.03] transition-colors"
                                    >
                                        <span className="text-gray-200 truncate flex items-center gap-1.5">
                                            {row.cells[0]}
                                            {row.badge && (
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${activePlatform.badgeClass}`}>
                                                    {row.badge}
                                                </span>
                                            )}
                                        </span>
                                        <span className={activePlatform.accent}>{row.cells[1]}</span>
                                        <span className="text-blue-400">{row.cells[2]}</span>
                                        <span className="text-purple-400">{row.cells[3]}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Sync footer */}
                            <p className="mt-6 text-[10px] text-gray-600 font-mono">
                                {activePlatform.syncNote}
                            </p>
                        </div>
                    </div>

                    <p className="text-center text-xs text-gray-600 mt-6">
                        This data goes directly into your Google Sheets™ — or use it in Looker Studio for live dashboards.
                    </p>
                </div>
            </section>

            {/* ── FEATURES GRID ────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 bg-[#0d1117]">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-14">
                        <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-4">
                            Everything your business needs.
                        </h2>
                        <p className="text-gray-400 max-w-xl mx-auto">One tool. All your platforms. Zero manual work.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {FEATURES.map((f) => {
                            const Icon = f.icon;
                            return (
                                <div key={f.title} className={`p-8 rounded-3xl bg-white/5 border border-white/10 ${borderMap[f.color]} transition-all group`}>
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 transition-colors ${colorMap[f.color]}`}>
                                        <Icon className="w-6 h-6" />
                                    </div>
                                    <h3 className="text-lg font-bold text-white mb-3">{f.title}</h3>
                                    <p className="text-gray-400 text-sm leading-relaxed">{f.desc}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* ── HOW IT WORKS ─────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-t border-white/5 bg-[#09090b]">
                <div className="max-w-4xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-4">
                            Up and running in 3 steps.
                        </h2>
                        <p className="text-gray-400">No IT team. No code. No meetings.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {[
                            { step: "01", color: "emerald", title: "Connect your platforms", desc: "Sign in with TikTok Ads, Meta Ads, Shopee, or Google Ads. Takes 2 minutes. We handle the OAuth — you just click Authorize." },
                            { step: "02", color: "blue",    title: "Choose your destination", desc: "Send data to Google Sheets™ with our add-on, or build a live Looker Studio dashboard with our connector." },
                            { step: "03", color: "purple",  title: "Set your schedule", desc: "Pick hourly or daily sync. Monstera runs in the background — your data is always fresh when you open your sheet." },
                        ].map((item) => (
                            <div key={item.step} className="flex flex-col items-start">
                                <div className={`text-5xl font-black mb-4 ${item.color === "emerald" ? "text-emerald-500/40" : item.color === "blue" ? "text-blue-500/40" : "text-purple-500/40"}`}>
                                    {item.step}
                                </div>
                                <h3 className="text-xl font-bold text-white mb-3">{item.title}</h3>
                                <p className="text-gray-400 text-sm leading-relaxed">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── WHAT YOU GET ─────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-t border-white/5 bg-[#0d1117]">
                <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-widest mb-6">
                            What you get
                        </div>
                        <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-8">
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
                                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                                    <span className="text-gray-300 text-sm leading-relaxed">{item}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Mini stat cards */}
                    <div className="grid grid-cols-2 gap-4">
                        {[
                            { label: "Hours saved per week",  value: "8–10h",  color: "emerald", sub: "On manual reporting" },
                            { label: "Platforms connected",   value: "4+",     color: "blue",    sub: "TikTok, Meta, Shopee, Google" },
                            { label: "Sync frequency",        value: "Hourly", color: "purple",  sub: "Pro plan" },
                            { label: "Setup time",            value: "< 2min", color: "orange",  sub: "No engineers needed" },
                        ].map((stat) => (
                            <div key={stat.label} className="p-6 rounded-2xl bg-white/5 border border-white/10 flex flex-col gap-1">
                                <p className="text-xs text-gray-500 font-medium">{stat.label}</p>
                                <p className={`text-2xl font-black ${stat.color === "emerald" ? "text-emerald-400" : stat.color === "blue" ? "text-blue-400" : stat.color === "purple" ? "text-purple-400" : "text-orange-400"}`}>
                                    {stat.value}
                                </p>
                                <p className="text-xs text-gray-600">{stat.sub}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── CTA ──────────────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-t border-white/5">
                <div className="max-w-3xl mx-auto rounded-[3rem] bg-emerald-500 p-1">
                    <div className="bg-[#09090b] rounded-[2.8rem] px-8 py-20 text-center relative overflow-hidden">
                        <div className="relative z-10">
                            <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-4">
                                Ready to get your time back?
                            </h2>
                            <p className="text-gray-400 mb-10 max-w-md mx-auto">
                                Connect your first data source in under 2 minutes. Free plan available — no credit card required.
                            </p>
                            <Link href="/register" className="inline-flex items-center gap-2 px-10 py-5 text-lg font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-3xl shadow-2xl shadow-emerald-500/20 transition-all">
                                Start Free Today
                                <ArrowRight className="w-5 h-5" />
                            </Link>
                            <p className="mt-8 text-[10px] font-black text-gray-600 uppercase tracking-[0.3em]">
                                Free plan available · VND + USD billing · Cancel anytime
                            </p>
                        </div>
                        <div className="absolute top-0 left-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[80px] -translate-x-1/2 -translate-y-1/2" />
                        <div className="absolute bottom-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-[80px] translate-x-1/2 translate-y-1/2" />
                    </div>
                </div>

                <div className="max-w-4xl mx-auto mt-16 text-center">
                    <Link href="/" className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-white transition-colors">
                        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Platform Overview
                    </Link>
                    <p className="mt-6 text-[10px] text-gray-600 font-medium italic">
                        Google Sheets™ and Google Workspace™ are trademarks of Google LLC.
                    </p>
                </div>
            </section>

        </div>
    );
}
