import type { Metadata } from "next";
import Link from "next/link";
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
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
    title: "Monstera Cloud for Small Businesses & SMEs",
    description:
        "Stop copying ad data manually. Monstera connects TikTok Ads, Meta Ads, Shopee, and more — and pulls your numbers automatically into Google Sheets. Built for SME sellers in Vietnam and Southeast Asia.",
    alternates: { canonical: `${PRODUCT_SITE_URL}/solutions/smes` },
};

const PAIN_POINTS = [
    "Copying TikTok Ads spend into Excel every morning",
    "Checking Shopee orders in one tab, Meta Ads in another",
    "Building the same weekly report manually, every week",
    "Not knowing which campaign is wasting your budget right now",
];

const FEATURES = [
    {
        icon: TrendingUp,
        color: "emerald",
        title: "TikTok & Meta Ads in one place",
        desc: "See spend, impressions, clicks, and conversions from all your ad accounts side by side. No switching tabs.",
    },
    {
        icon: ShoppingBag,
        color: "orange",
        title: "Shopee order data",
        desc: "Pull orders, revenue, and product performance from your Shopee seller account. Filter by date and status.",
    },
    {
        icon: FileSpreadsheet,
        color: "blue",
        title: "Auto-updates Google Sheets™",
        desc: "Install our add-on once. Your spreadsheet refreshes automatically — hourly or daily — with zero manual work.",
    },
    {
        icon: BarChart3,
        color: "purple",
        title: "Looker Studio dashboards",
        desc: "Connect to Looker Studio for beautiful charts. Share live reports with your team or your boss.",
    },
    {
        icon: RefreshCw,
        color: "emerald",
        title: "Scheduled auto-sync",
        desc: "Set it and forget it. Monstera syncs your data on a schedule so your numbers are always up to date.",
    },
    {
        icon: Zap,
        color: "yellow",
        title: "No engineers needed",
        desc: "Built for business owners, not developers. Connect your accounts in minutes with just a few clicks.",
    },
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
                        Monstera connects your TikTok Ads, Meta Ads, and Shopee store — and automatically delivers your numbers into Google Sheets™ or a live dashboard. No code. No manual work. Just clarity.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full mb-12">
                        <Link
                            href="/register"
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-2xl transition-all shadow-xl shadow-emerald-500/20"
                        >
                            Start Free — No Credit Card
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                        <Link
                            href="/pricing"
                            className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-white bg-white/5 border border-white/10 hover:bg-white/10 rounded-2xl transition-all"
                        >
                            See Pricing
                        </Link>
                    </div>

                    {/* Social proof strip */}
                    <p className="text-xs text-gray-600 font-medium uppercase tracking-widest">
                        Trusted by sellers across Vietnam · Indonesia · Thailand
                    </p>
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
                            <div
                                key={pain}
                                className="flex items-start gap-3 p-5 rounded-2xl bg-white/5 border border-white/10"
                            >
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

            {/* ── SOLUTION TRANSITION ──────────────────────────────────────── */}
            <section className="w-full py-16 px-4 sm:px-6 lg:px-8 border-t border-white/5 bg-gradient-to-b from-[#09090b] to-[#0d1117]">
                <div className="max-w-4xl mx-auto text-center">
                    <h2 className="text-3xl md:text-5xl font-black text-white tracking-tight mb-6">
                        Monstera does it for you. <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-500">
                            Automatically.
                        </span>
                    </h2>
                    <p className="text-gray-400 text-lg max-w-2xl mx-auto">
                        Connect your platforms once. Monstera pulls your ad performance, orders, and sales data on a schedule — and pushes it straight into Google Sheets™ or a live dashboard.
                    </p>
                </div>
            </section>

            {/* ── FEATURES GRID ────────────────────────────────────────────── */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 bg-[#0d1117]">
                <div className="max-w-6xl mx-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {FEATURES.map((f) => {
                            const Icon = f.icon;
                            return (
                                <div
                                    key={f.title}
                                    className={`p-8 rounded-3xl bg-white/5 border border-white/10 ${borderMap[f.color]} transition-all group`}
                                >
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
                            {
                                step: "01",
                                title: "Connect your platforms",
                                desc: "Sign in with TikTok Ads, Meta Ads, or Shopee. Takes 2 minutes. We handle the OAuth — you just click Authorize.",
                                color: "emerald",
                            },
                            {
                                step: "02",
                                title: "Choose your destination",
                                desc: "Send data to Google Sheets™ with our add-on, or build a live Looker Studio dashboard with our connector.",
                                color: "blue",
                            },
                            {
                                step: "03",
                                title: "Set your schedule",
                                desc: "Pick hourly or daily sync. Monstera runs in the background — your data is always fresh when you open your sheet.",
                                color: "purple",
                            },
                        ].map((item) => (
                            <div key={item.step} className="flex flex-col items-start">
                                <div className={`text-5xl font-black mb-4 ${
                                    item.color === "emerald" ? "text-emerald-500/40" :
                                    item.color === "blue" ? "text-blue-500/40" : "text-purple-500/40"
                                }`}>
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
                            Your full ad picture. Every morning.
                        </h2>
                        <ul className="space-y-4">
                            {[
                                "TikTok Ads: spend, impressions, clicks, conversions by campaign",
                                "Meta Ads: reach, CPM, ROAS broken down by ad set",
                                "Shopee: orders, revenue, and top products by date",
                                "Google Sheets™ auto-updated — no manual export needed",
                                "Looker Studio charts ready to share with your team",
                                "All data in one workspace — not scattered across 5 tabs",
                            ].map((item) => (
                                <li key={item} className="flex items-start gap-3">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                                    <span className="text-gray-300 text-sm leading-relaxed">{item}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Mock terminal / sheet preview */}
                    <div className="rounded-2xl bg-[#09090b] border border-white/10 overflow-hidden shadow-2xl">
                        <div className="bg-[#18181b] px-4 py-3 flex items-center gap-2 border-b border-white/5">
                            <div className="w-3 h-3 rounded-full bg-red-500/80" />
                            <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                            <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                            <span className="ml-2 text-xs text-gray-500 font-mono">Weekly_Ad_Report.xlsx — auto-synced</span>
                        </div>
                        <div className="p-6 font-mono text-xs text-gray-300 space-y-3">
                            <div className="grid grid-cols-4 gap-2 text-gray-500 font-bold text-[10px] uppercase tracking-wider border-b border-white/5 pb-2">
                                <span>Campaign</span>
                                <span>Spend</span>
                                <span>Clicks</span>
                                <span>Conv.</span>
                            </div>
                            {[
                                ["Spring Sale 2026", "$1,240", "8,430", "312"],
                                ["Brand Awareness Q2", "$880", "4,210", "98"],
                                ["Flash Sale Apr 15", "$2,105", "14,820", "741"],
                                ["Meta – Retargeting", "$430", "2,180", "189"],
                                ["Google Search", "$620", "1,940", "143"],
                            ].map(([name, spend, clicks, conv]) => (
                                <div key={name} className="grid grid-cols-4 gap-2 text-[11px] py-1 border-b border-white/5">
                                    <span className="text-gray-200 truncate">{name}</span>
                                    <span className="text-emerald-400">{spend}</span>
                                    <span className="text-blue-400">{clicks}</span>
                                    <span className="text-purple-400">{conv}</span>
                                </div>
                            ))}
                            <div className="pt-2 text-emerald-500/60 text-[10px]">
                                ↻ Last synced: Today 08:00 AM · Next sync in 55 min
                            </div>
                        </div>
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
                            <Link
                                href="/register"
                                className="inline-flex items-center gap-2 px-10 py-5 text-lg font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-3xl shadow-2xl shadow-emerald-500/20 transition-all"
                            >
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
