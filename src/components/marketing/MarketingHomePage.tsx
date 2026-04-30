"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
    ArrowRight, ChevronRight, CheckCircle2, Shield,
    Lock, RotateCcw, Eye, Plus, Minus, RefreshCw,
} from "lucide-react";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";

function track(event: string, props?: Record<string, string>) {
    if (typeof window !== "undefined" && (window as any).gtag) {
        (window as any).gtag("event", event, props ?? {});
    }
}

const MARKETING_LANG_KEY = "marketing_lang";
type Lang = "en" | "vi";

// ── Sub-components ─────────────────────────────────────────────────────────

function SourceNode({ label, logo, alt, tint }: { label: string; logo: string; alt: string; tint: string }) {
    return (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${tint}`}>
            <img src={logo} alt={alt} className="h-4 w-4 object-contain brightness-0 invert opacity-70 flex-shrink-0" />
            <span className="text-xs text-gray-300 font-medium whitespace-nowrap">{label}</span>
        </div>
    );
}

function DestNode({ label, logo, alt }: { label: string; logo: string; alt: string }) {
    return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/25">
            <img src={logo} alt={alt} className="h-4 w-4 object-contain brightness-0 invert opacity-70 flex-shrink-0" />
            <span className="text-xs text-cyan-300 font-medium whitespace-nowrap">{label}</span>
        </div>
    );
}

function FAQItem({ q, a }: { q: string; a: string }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="border-b border-white/5">
            <button
                className="w-full flex items-center justify-between py-4 text-left gap-4 group"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
            >
                <span className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors">{q}</span>
                {open
                    ? <Minus className="w-4 h-4 text-cyan-500 flex-shrink-0" />
                    : <Plus className="w-4 h-4 text-gray-500 flex-shrink-0 group-hover:text-gray-300 transition-colors" />
                }
            </button>
            {open && <p className="pb-4 text-sm text-gray-400 leading-relaxed max-w-2xl">{a}</p>}
        </div>
    );
}

// ── Sheet preview data ─────────────────────────────────────────────────────
const SHEET_ROWS = [
    { date: "2024-01-15", platform: "TikTok Ads",  spend: "$420",  revenue: "$2,940", orders: "84",  roas: "7.0x", synced: "2m ago" },
    { date: "2024-01-15", platform: "Meta Ads",    spend: "$310",  revenue: "$1,240", orders: "41",  roas: "4.0x", synced: "2m ago" },
    { date: "2024-01-15", platform: "Shopee",      spend: "–",     revenue: "$8,910", orders: "312", roas: "–",    synced: "2m ago" },
    { date: "2024-01-15", platform: "Google Ads",  spend: "$185",  revenue: "$740",   orders: "22",  roas: "4.0x", synced: "2m ago" },
    { date: "2024-01-14", platform: "TikTok Shop", spend: "–",     revenue: "$3,200", orders: "97",  roas: "–",    synced: "6h ago" },
];
const SHEET_COLS = ["Date", "Platform", "Spend", "Revenue", "Orders", "ROAS", "Last synced"];

const FAQS = [
    { q: "Which platforms are supported?",
      a: "Live: TikTok Ads, Meta Ads, Google Ads, TikTok Shop, Shopee. Google Sheets as destination. Lazada, Shopify, GA4, and Looker Studio are rolling out progressively." },
    { q: "How often does data refresh?",
      a: "Daily on the free plan. Hourly and more frequent refresh on paid plans." },
    { q: "Can I use my existing Google Sheet?",
      a: "Yes. Point a pipeline at an existing spreadsheet and Monstera writes into a new tab, leaving your existing data untouched." },
    { q: "Is my data secure?",
      a: "All connections use official OAuth. Tokens are AES-256 encrypted at rest. Traffic uses TLS 1.3. We do not sell your data." },
    { q: "Do I need a data warehouse or developer?",
      a: "No. Monstera is built for teams that live in Google Sheets. No SQL, no warehouse, no engineering." },
    { q: "Is there a free plan?",
      a: "Yes — 1 workspace, TikTok Ads and Shopee as sources, Google Sheets destination, daily refresh. No credit card." },
];

// ── Main page ───────────────────────────────────────────────────────────────
export default function MarketingHomePage() {
    const [_lang, setLang] = useState<Lang>("en");

    useEffect(() => {
        if (typeof window === "undefined") return;
        const apply = (v: string | null) => { if (v === "en" || v === "vi") setLang(v); };
        apply(window.localStorage.getItem(MARKETING_LANG_KEY));
        const onStorage = (e: StorageEvent) => { if (e.key === MARKETING_LANG_KEY) apply(e.newValue); };
        const onCustom = (e: Event) => apply((e as CustomEvent<Lang>).detail);
        window.addEventListener("storage", onStorage);
        window.addEventListener("marketing-lang-change", onCustom as EventListener);
        return () => {
            window.removeEventListener("storage", onStorage);
            window.removeEventListener("marketing-lang-change", onCustom as EventListener);
        };
    }, []);

    return (
        <div className="relative min-h-screen bg-[#09090b] selection:bg-cyan-500/30">

            {/* ── 1. HERO ─────────────────────────────────────────────────── */}
            <section className="relative pt-32 pb-28 border-b border-white/5 overflow-hidden">
                <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[380px] bg-cyan-500/6 blur-[140px] rounded-full" />
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
                    <div className="max-w-3xl mx-auto text-center mb-16">
                        <h1 className="text-5xl md:text-[4.5rem] font-bold text-white tracking-tight leading-[1.06] mb-5">
                            Stop exporting CSVs.
                        </h1>
                        <p className="text-lg text-gray-400 mb-10 max-w-lg mx-auto leading-relaxed">
                            Monstera syncs your SEA marketplace and ad data into clean Google Sheets automatically.
                        </p>
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                            <Link
                                href="/register"
                                onClick={() => track("cta_start_free", { location: "hero" })}
                                className="group inline-flex items-center gap-2 px-7 py-3.5 min-h-[48px] w-full sm:w-auto justify-center text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded-xl transition-colors shadow-lg shadow-cyan-900/40"
                            >
                                Start free
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                            </Link>
                            <a
                                href="#sheet-preview"
                                onClick={() => track("cta_sample_sheet", { location: "hero" })}
                                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors min-h-[48px] px-3"
                            >
                                View sample sheet <ChevronRight className="w-3.5 h-3.5" />
                            </a>
                        </div>
                        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
                            {["No credit card", "OAuth access", "Google Sheets destination", "Built for SEA sellers"].map((t) => (
                                <span key={t} className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                                    <CheckCircle2 className="w-3 h-3 text-cyan-700 flex-shrink-0" />{t}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Flow diagram */}
                    <div className="flex items-center justify-center gap-0 w-full max-w-4xl mx-auto overflow-x-auto pb-2">
                        {/* Sources */}
                        <div className="flex-shrink-0 grid grid-cols-1 gap-2">
                            <SourceNode label="TikTok Shop" logo={INTEGRATION_LOGOS.tiktok}    alt="TikTok Shop" tint="bg-pink-500/5 border-pink-500/20" />
                            <SourceNode label="Shopee"      logo={INTEGRATION_LOGOS.shopee}    alt="Shopee"      tint="bg-orange-500/5 border-orange-500/20" />
                            <SourceNode label="TikTok Ads"  logo={INTEGRATION_LOGOS.tiktok}    alt="TikTok Ads"  tint="bg-pink-500/5 border-pink-500/20" />
                            <SourceNode label="Meta Ads"    logo={INTEGRATION_LOGOS.meta}      alt="Meta Ads"    tint="bg-blue-500/5 border-blue-500/20" />
                            <SourceNode label="Google Ads"  logo={INTEGRATION_LOGOS.googleAds} alt="Google Ads"  tint="bg-green-500/5 border-green-500/20" />
                        </div>
                        {/* Arrow */}
                        <div className="flex-1 relative h-[2px] mx-4 min-w-[20px]">
                            <div className="absolute inset-0 bg-gradient-to-r from-white/5 via-white/20 to-white/10" />
                        </div>
                        {/* Monstera hub */}
                        <div className="flex-shrink-0 w-28 h-28 rounded-2xl border border-cyan-500/30 bg-cyan-500/5 flex flex-col items-center justify-center gap-2 relative">
                            <div className="absolute inset-0 rounded-2xl bg-cyan-400/5 blur-sm pointer-events-none" />
                            <div className="relative w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
                                <span className="font-bold text-cyan-400 text-base leading-none">M</span>
                            </div>
                            <span className="relative font-mono text-[9px] text-cyan-400/70 tracking-widest uppercase text-center leading-tight">Monstera</span>
                        </div>
                        {/* Arrow */}
                        <div className="flex-1 relative h-[2px] mx-4 min-w-[20px]">
                            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-cyan-500/30 to-cyan-500/5" />
                        </div>
                        {/* Destination */}
                        <div className="flex-shrink-0">
                            <DestNode label="Google Sheets™" logo={INTEGRATION_LOGOS.googleSheets} alt="Google Sheets" />
                        </div>
                    </div>
                </div>
            </section>

            {/* ── 2. PLATFORMS ────────────────────────────────────────────── */}
            <section className="py-20 px-4 sm:px-6 lg:px-8 border-b border-white/5">
                <div className="max-w-4xl mx-auto">
                    <div className="text-center mb-10">
                        <h2 className="text-2xl font-bold text-white tracking-tight">Works with the platforms SEA sellers use daily</h2>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
                        {[
                            { logo: INTEGRATION_LOGOS.tiktok,       label: "TikTok Shop",  alt: "TikTok Shop" },
                            { logo: INTEGRATION_LOGOS.shopee,       label: "Shopee",       alt: "Shopee" },
                            { logo: INTEGRATION_LOGOS.tiktok,       label: "TikTok Ads",   alt: "TikTok Ads" },
                            { logo: INTEGRATION_LOGOS.meta,         label: "Meta Ads",     alt: "Meta Ads" },
                            { logo: INTEGRATION_LOGOS.googleAds,    label: "Google Ads",   alt: "Google Ads" },
                            { logo: INTEGRATION_LOGOS.googleSheets, label: "Google Sheets™", alt: "Google Sheets" },
                        ].map(({ logo, label, alt }) => (
                            <div key={label} className="flex flex-col items-center gap-2.5 p-4 rounded-xl border border-white/8 bg-white/[0.02] hover:border-white/18 transition-colors">
                                <img src={logo} alt={alt} className="h-6 w-6 object-contain brightness-0 invert opacity-60" />
                                <span className="text-[11px] text-gray-400 text-center font-medium leading-tight">{label}</span>
                            </div>
                        ))}
                    </div>
                    <p className="text-center text-xs text-gray-600">
                        Lazada, GA4, Shopify, and Looker Studio support are rolling out progressively.
                    </p>
                </div>
            </section>

            {/* ── 3. HOW IT WORKS ─────────────────────────────────────────── */}
            <section className="py-20 px-4 sm:px-6 lg:px-8 border-b border-white/5">
                <div className="max-w-4xl mx-auto">
                    <div className="text-center mb-12">
                        <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-3">How it works</p>
                        <h2 className="text-2xl font-bold text-white tracking-tight">Set up once. Open a fresh sheet every day.</h2>
                    </div>
                    <div className="grid md:grid-cols-3 gap-5">
                        {[
                            { num: "01", title: "Connect your accounts",    body: "Authorize your ad and marketplace platforms with OAuth." },
                            { num: "02", title: "Choose what to sync",      body: "Pick the metrics your team reports on: spend, revenue, orders, and ROAS." },
                            { num: "03", title: "Open your updated sheet",  body: "Monstera refreshes your Google Sheet automatically." },
                        ].map(({ num, title, body }) => (
                            <div key={num} className="p-6 rounded-2xl border border-white/8 bg-white/[0.02] hover:border-white/15 transition-colors">
                                <span className="font-mono text-[10px] text-gray-600 tracking-widest">{num}</span>
                                <h3 className="mt-3 mb-2 text-sm font-semibold text-white">{title}</h3>
                                <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── 4. SHEET PREVIEW ────────────────────────────────────────── */}
            <section id="sheet-preview" className="py-20 px-4 sm:px-6 lg:px-8 border-b border-white/5">
                <div className="max-w-5xl mx-auto">
                    <div className="text-center mb-10">
                        <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-3">Output</p>
                        <h2 className="text-2xl font-bold text-white tracking-tight mb-2">Your daily report, already filled in</h2>
                        <p className="text-xs text-gray-600">Demo data shown only to illustrate the output format.</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 overflow-hidden bg-[#0d0d10] shadow-2xl">
                        {/* Chrome */}
                        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                            <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                            <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                            <span className="ml-3 text-[11px] text-gray-500 font-medium">SEA Ads Dashboard.xlsx</span>
                            <div className="ml-auto flex items-center gap-1.5">
                                <span className="relative flex h-1.5 w-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-500" />
                                </span>
                                <span className="text-[10px] text-cyan-400/80">Live sync</span>
                            </div>
                        </div>
                        {/* Table */}
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-white/5 bg-white/[0.03]">
                                        {SHEET_COLS.map((col) => (
                                            <th key={col} className="px-4 py-3 text-left font-semibold text-gray-500 whitespace-nowrap">{col}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {SHEET_ROWS.map((row, i) => (
                                        <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                                            <td className="px-4 py-3 text-gray-500 font-mono whitespace-nowrap">{row.date}</td>
                                            <td className="px-4 py-3 text-gray-300 font-medium whitespace-nowrap">{row.platform}</td>
                                            <td className="px-4 py-3 text-gray-300 font-mono whitespace-nowrap">{row.spend}</td>
                                            <td className="px-4 py-3 text-emerald-400 font-mono whitespace-nowrap">{row.revenue}</td>
                                            <td className="px-4 py-3 text-gray-300 font-mono whitespace-nowrap">{row.orders}</td>
                                            <td className="px-4 py-3 text-cyan-400 font-mono whitespace-nowrap">{row.roas}</td>
                                            <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{row.synced}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="px-4 py-3 border-t border-white/5 bg-white/[0.01]">
                            <span className="text-[10px] text-gray-600 font-mono">Demo data only · Auto-refreshed daily · Powered by Monstera</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── 5. TRUST + FINAL CTA ────────────────────────────────────── */}
            <section className="py-20 px-4 sm:px-6 lg:px-8 border-b border-white/5">
                <div className="max-w-4xl mx-auto">
                    {/* Trust block */}
                    <div className="mb-16">
                        <div className="text-center mb-8">
                            <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-3">Security</p>
                            <h2 className="text-2xl font-bold text-white tracking-tight">Your data stays under your control</h2>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
                            {[
                                { icon: Shield,    text: "OAuth access only — no shared passwords" },
                                { icon: Lock,      text: "Credentials encrypted at rest" },
                                { icon: RotateCcw, text: "Revoke access anytime" },
                                { icon: Eye,       text: "We do not sell your ad or sales data" },
                            ].map(({ icon: Icon, text }) => (
                                <div key={text} className="flex items-start gap-3 p-4 rounded-xl border border-white/8 bg-white/[0.02]">
                                    <Icon className="w-4 h-4 text-cyan-500 flex-shrink-0 mt-0.5" aria-hidden />
                                    <span className="text-sm text-gray-300">{text}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Final CTA */}
                    <div className="relative border border-cyan-500/20 bg-cyan-500/[0.04] rounded-3xl overflow-hidden text-center px-8 py-16">
                        <div className="pointer-events-none absolute top-0 left-0 w-64 h-64 bg-cyan-500/8 blur-[80px]" />
                        <div className="pointer-events-none absolute bottom-0 right-0 w-64 h-64 bg-cyan-500/8 blur-[80px]" />
                        <div className="relative">
                            <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-5">
                                Ready to stop exporting CSVs?
                            </h2>
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                                <Link
                                    href="/register"
                                    onClick={() => track("cta_start_free", { location: "final_cta" })}
                                    className="group inline-flex items-center gap-2 px-7 py-3.5 min-h-[48px] w-full sm:w-auto justify-center text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded-xl transition-colors shadow-lg shadow-cyan-900/40"
                                >
                                    Start free
                                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                                </Link>
                                <a
                                    href="#sheet-preview"
                                    onClick={() => track("cta_sample_sheet", { location: "final_cta" })}
                                    className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors min-h-[48px] px-3"
                                >
                                    View sample sheet <ChevronRight className="w-3.5 h-3.5" />
                                </a>
                            </div>
                            <p className="mt-6 text-[11px] text-gray-600">No credit card · Free plan includes TikTok Ads + Shopee</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── FAQ ─────────────────────────────────────────────────────── */}
            <section className="py-20 px-4 sm:px-6 lg:px-8 border-b border-white/5">
                <div className="max-w-2xl mx-auto">
                    <div className="text-center mb-10">
                        <h2 className="text-2xl font-bold text-white tracking-tight">Common questions</h2>
                    </div>
                    {FAQS.map((f) => <FAQItem key={f.q} q={f.q} a={f.a} />)}
                </div>
            </section>

            {/* ── FOOTER ──────────────────────────────────────────────────── */}
            <footer className="py-14 px-4 sm:px-6 lg:px-8">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col md:flex-row items-start justify-between gap-8 mb-10">
                        {/* Brand */}
                        <div className="flex-shrink-0">
                            <div className="flex items-center gap-2 mb-3">
                                <div className="w-6 h-6 rounded-lg bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
                                    <span className="text-cyan-400 font-bold text-xs">M</span>
                                </div>
                                <span className="text-sm text-gray-400 font-medium">Monstera Cloud</span>
                            </div>
                            <p className="text-xs text-gray-600 max-w-[200px] leading-relaxed">SEA ecommerce reporting for teams that live in Google Sheets.</p>
                        </div>
                        {/* Links */}
                        <div className="flex flex-wrap gap-x-10 gap-y-4">
                            {[
                                { label: "Product", href: "/" },
                                { label: "Pricing", href: "/pricing" },
                                { label: "Docs", href: "/docs" },
                                { label: "Privacy Policy", href: "/legal/privacy-policy" },
                                { label: "Terms", href: "/legal/terms" },
                                { label: "Contact", href: "/contact" },
                            ].map(({ label, href }) => (
                                <Link key={label} href={href} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">{label}</Link>
                            ))}
                        </div>
                    </div>
                    <div className="pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3">
                        <p className="text-[11px] text-gray-600">Built for Southeast Asia · Infrastructure in Singapore</p>
                        <p className="text-[11px] text-gray-600 text-center">
                            Google Sheets™ is a trademark of Google LLC. Monstera Cloud is not affiliated with Google.
                        </p>
                        <div className="flex items-center gap-4 opacity-25 hover:opacity-40 transition-opacity">
                            {[
                                { src: INTEGRATION_LOGOS.tiktok,       alt: "TikTok" },
                                { src: INTEGRATION_LOGOS.meta,         alt: "Meta" },
                                { src: INTEGRATION_LOGOS.shopee,       alt: "Shopee" },
                                { src: INTEGRATION_LOGOS.googleSheets, alt: "Google Sheets" },
                            ].map(({ src, alt }) => (
                                <img key={alt} src={src} alt={alt} className="h-4 w-auto brightness-0 invert" />
                            ))}
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
}
