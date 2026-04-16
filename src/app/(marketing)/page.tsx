import React from "react";
import Link from "next/link";
import {
    ArrowRight,
    ChevronRight,
    Zap,
    Globe,
    Shield,
    Clock,
    Database,
    BarChart3,
    RefreshCw,
    Terminal,
    ShoppingBag,
    TrendingUp,
    FileSpreadsheet,
    LineChart,
    Layers,
} from "lucide-react";
import { primaryButtonLinkClassName } from "@/components/ui/PrimaryButton";
import { MarketingNavbar } from "@/components/MarketingNavbar";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";

// ─────────────────────────────────────────────
// Architecture node diagram (static, no JS)
// ─────────────────────────────────────────────
function ArchDot({ label, logo, alt }: { label: string; logo: string; alt: string }) {
    return (
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 min-w-[140px]">
            <img src={logo} alt={alt} className="h-4 w-4 object-contain brightness-0 invert opacity-80" />
            <span className="text-xs text-gray-300 font-medium whitespace-nowrap">{label}</span>
        </div>
    );
}

function ArchDest({ label, logo, alt }: { label: string; logo: string; alt: string }) {
    return (
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 min-w-[148px]">
            <img src={logo} alt={alt} className="h-4 w-4 object-contain brightness-0 invert opacity-80" />
            <span className="text-xs text-emerald-300 font-medium whitespace-nowrap">{label}</span>
        </div>
    );
}

function ConnectorLine() {
    return (
        <div className="h-px w-8 bg-gradient-to-r from-white/20 to-white/5 flex-shrink-0" />
    );
}

function ConnectorLineGreen() {
    return (
        <div className="h-px w-8 bg-gradient-to-r from-emerald-500/30 to-emerald-500/10 flex-shrink-0" />
    );
}

// ─────────────────────────────────────────────
// Differentiator card
// ─────────────────────────────────────────────
function DiffCard({
    num,
    title,
    body,
    icon: Icon,
}: {
    num: string;
    title: string;
    body: string;
    icon: React.ElementType;
}) {
    return (
        <div className="flex flex-col gap-4 p-6 border border-white/8 bg-white/[0.02] hover:border-white/20 transition-colors duration-300">
            <div className="flex items-start justify-between">
                <span className="font-mono text-[10px] text-gray-600 tracking-widest">{num}</span>
                <Icon className="w-4 h-4 text-gray-500" />
            </div>
            <div>
                <h3 className="text-sm font-semibold text-white mb-1.5">{title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// Step
// ─────────────────────────────────────────────
function Step({
    num,
    title,
    body,
}: {
    num: string;
    title: string;
    body: string;
}) {
    return (
        <div className="flex gap-6 group">
            <div className="flex-shrink-0 w-10 h-10 rounded-full border border-white/10 flex items-center justify-center group-hover:border-emerald-500/40 transition-colors">
                <span className="font-mono text-xs text-gray-500 group-hover:text-emerald-400 transition-colors">{num}</span>
            </div>
            <div className="pt-1.5">
                <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────
export default function MarketingPage() {
    return (
        <div className="relative min-h-screen bg-[#09090b] selection:bg-emerald-500/30">
            <MarketingNavbar />

            {/* ── HERO ──────────────────────────────────────────── */}
            <section className="relative pt-32 pb-24 border-b border-white/5">
                {/* Subtle top-center glow */}
                <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-emerald-500/6 blur-[120px] rounded-full" />

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
                    <div className="max-w-3xl mx-auto text-center mb-16">
                        {/* Status badge */}
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-sm bg-white/5 border border-white/10 text-gray-400 text-[10px] font-mono uppercase tracking-widest mb-10">
                            <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                            </span>
                            v1.0 · Now Live in Southeast Asia
                        </div>

                        <h1 className="text-5xl md:text-[4.5rem] font-black text-white tracking-tight leading-[1.05] mb-6">
                            One data layer.
                            <br />
                            Every channel.
                        </h1>

                        <p className="text-lg text-gray-400 mb-10 max-w-xl mx-auto leading-relaxed">
                            Connect TikTok Ads, Meta, Shopee, and Google Ads. Route live data into Google Sheets™ and Looker Studio — no code, no pipelines.
                        </p>

                        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                            <Link
                                href="/register"
                                className="group inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-sm transition-colors shadow-lg shadow-emerald-900/40"
                            >
                                Start free — no card needed
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                            </Link>
                            <Link
                                href="/pricing"
                                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-gray-400 hover:text-white border border-white/10 hover:border-white/20 rounded-sm transition-colors"
                            >
                                View pricing <ChevronRight className="w-3.5 h-3.5" />
                            </Link>
                        </div>
                    </div>

                    {/* Architecture node diagram */}
                    <div className="flex items-center justify-center gap-0 overflow-x-auto pb-2">
                        {/* Source nodes */}
                        <div className="flex flex-col gap-2.5 flex-shrink-0">
                            <ArchDot label="TikTok Ads" logo={INTEGRATION_LOGOS.tiktok} alt="TikTok" />
                            <ArchDot label="Meta Ads" logo={INTEGRATION_LOGOS.meta} alt="Meta" />
                            <ArchDot label="Shopee" logo={INTEGRATION_LOGOS.shopee} alt="Shopee" />
                            <ArchDot label="Google Ads" logo={INTEGRATION_LOGOS.googleAds} alt="Google Ads" />
                        </div>

                        {/* Left connector lines block */}
                        <div className="flex flex-col gap-2.5 flex-shrink-0 px-1">
                            {[0, 1, 2, 3].map((i) => (
                                <div key={i} className="flex items-center" style={{ height: "36px" }}>
                                    <ConnectorLine />
                                </div>
                            ))}
                        </div>

                        {/* Center — Monstera node */}
                        <div className="flex-shrink-0 flex flex-col items-center justify-center w-[120px] h-[192px] border border-emerald-500/30 bg-emerald-500/5 rounded-sm relative">
                            <div className="absolute inset-0 rounded-sm bg-emerald-500/5 blur-sm" />
                            <div className="relative flex flex-col items-center gap-2">
                                {/* Simple M logo */}
                                <div className="w-9 h-9 rounded-sm bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                                    <span className="font-black text-emerald-400 text-lg leading-none">M</span>
                                </div>
                                <span className="font-mono text-[9px] text-emerald-400/80 tracking-widest uppercase text-center leading-tight">Monstera<br/>Cloud</span>
                            </div>
                        </div>

                        {/* Right connector lines block */}
                        <div className="flex flex-col flex-shrink-0 px-1" style={{ gap: "20px", paddingTop: "8px", paddingBottom: "8px" }}>
                            {[0, 1, 2].map((i) => (
                                <div key={i} className="flex items-center" style={{ height: "36px" }}>
                                    <ConnectorLineGreen />
                                </div>
                            ))}
                        </div>

                        {/* Destination nodes */}
                        <div className="flex flex-col gap-2.5 flex-shrink-0" style={{ paddingTop: "8px", paddingBottom: "8px" }}>
                            <ArchDest label="Google Sheets™" logo={INTEGRATION_LOGOS.googleSheets} alt="Google Sheets" />
                            <ArchDest label="Looker Studio" logo={INTEGRATION_LOGOS.looker} alt="Looker Studio" />
                            <ArchDest label="REST API / CSV" logo={INTEGRATION_LOGOS.postgresql} alt="API" />
                        </div>
                    </div>

                    {/* API partner strip */}
                    <div className="mt-12 pt-8 border-t border-white/5 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
                        <span className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Official API Partner</span>
                        <div className="flex items-center gap-6 opacity-50">
                            <img src={INTEGRATION_LOGOS.tiktok} alt="TikTok" className="h-5 w-auto brightness-0 invert" />
                            <img src={INTEGRATION_LOGOS.meta} alt="Meta" className="h-5 w-auto brightness-0 invert" />
                            <img src={INTEGRATION_LOGOS.googleAds} alt="Google Ads" className="h-5 w-auto brightness-0 invert" />
                            <img src={INTEGRATION_LOGOS.googleSheets} alt="Google Sheets" className="h-5 w-auto brightness-0 invert" />
                        </div>
                    </div>
                </div>
            </section>

            {/* ── DIFFERENTIATOR STRIP ────────────────────────── */}
            <section className="border-b border-white/5">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/5">
                        <DiffCard
                            num="01"
                            title="Day-1 value"
                            body="First data sync completes in under 60 seconds. No data engineering, no warehouse setup."
                            icon={Zap}
                        />
                        <DiffCard
                            num="02"
                            title="Zero code"
                            body="OAuth in your browser. Pick metrics from a sidebar. Data lands in your spreadsheet."
                            icon={Terminal}
                        />
                        <DiffCard
                            num="03"
                            title="All SEA channels"
                            body="TikTok Ads, Meta Ads, Shopee, Google Ads — the platforms your business actually runs on."
                            icon={Globe}
                        />
                        <DiffCard
                            num="04"
                            title="SEA-first pricing"
                            body="VND and USD billing. Plans designed for independent sellers and growing agencies."
                            icon={TrendingUp}
                        />
                    </div>
                </div>
            </section>

            {/* ── CAPABILITY GRID ─────────────────────────────── */}
            <section className="py-28 px-4 sm:px-6 lg:px-8 border-b border-white/5">
                <div className="max-w-7xl mx-auto">
                    <div className="grid lg:grid-cols-2 gap-16 items-start">
                        {/* Left: text */}
                        <div>
                            <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-4">What you can connect</p>
                            <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight leading-tight mb-6">
                                Every channel.
                                <br />
                                One workspace.
                            </h2>
                            <p className="text-gray-400 text-sm leading-relaxed max-w-md mb-8">
                                Monstera sits between your ad platforms and your reporting tools. Pull raw metrics once, normalise them, and push to wherever your team works.
                            </p>
                            <Link href="/solutions/smes" className="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 transition-colors font-medium">
                                See how SMEs use Monstera <ChevronRight className="w-3.5 h-3.5" />
                            </Link>
                        </div>

                        {/* Right: icon grid */}
                        <div>
                            <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-4">Data sources</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/5 border border-white/5 mb-6">
                                {[
                                    { logo: INTEGRATION_LOGOS.tiktok, label: "TikTok Ads" },
                                    { logo: INTEGRATION_LOGOS.meta, label: "Meta Ads" },
                                    { logo: INTEGRATION_LOGOS.shopee, label: "Shopee" },
                                    { logo: INTEGRATION_LOGOS.googleAds, label: "Google Ads" },
                                    { logo: INTEGRATION_LOGOS.shopify, label: "Shopify" },
                                    { logo: INTEGRATION_LOGOS.lazada, label: "Lazada" },
                                    { logo: INTEGRATION_LOGOS.googleAnalytics, label: "GA4" },
                                    { logo: INTEGRATION_LOGOS.slack, label: "Slack Alerts" },
                                ].map(({ logo, label }) => (
                                    <div
                                        key={label}
                                        className="flex flex-col items-center justify-center gap-2 p-4 bg-[#09090b] hover:bg-white/[0.03] transition-colors"
                                    >
                                        <img src={logo} alt={label} className="h-5 w-5 object-contain brightness-0 invert opacity-60" />
                                        <span className="text-[10px] text-gray-600 text-center leading-tight">{label}</span>
                                    </div>
                                ))}
                            </div>

                            <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-4">Destinations</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-white/5 border border-white/5">
                                {[
                                    { logo: INTEGRATION_LOGOS.googleSheets, label: "Google Sheets™" },
                                    { logo: INTEGRATION_LOGOS.looker, label: "Looker Studio" },
                                    { logo: INTEGRATION_LOGOS.postgresql, label: "REST API" },
                                ].map(({ logo, label }) => (
                                    <div
                                        key={label}
                                        className="flex flex-col items-center justify-center gap-2 p-4 bg-[#09090b] hover:bg-white/[0.03] transition-colors"
                                    >
                                        <img src={logo} alt={label} className="h-5 w-5 object-contain brightness-0 invert opacity-60" />
                                        <span className="text-[10px] text-gray-600 text-center leading-tight">{label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── HOW IT WORKS ────────────────────────────────── */}
            <section className="py-28 px-4 sm:px-6 lg:px-8 border-b border-white/5">
                <div className="max-w-7xl mx-auto">
                    <div className="grid lg:grid-cols-2 gap-16 items-center">
                        {/* Left: steps */}
                        <div>
                            <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-8">How it works</p>
                            <div className="flex flex-col gap-10">
                                <Step
                                    num="01"
                                    title="Connect your platforms"
                                    body="Authenticate via OAuth with one click. Monstera stores tokens securely — your credentials never touch our servers in plaintext."
                                />
                                <Step
                                    num="02"
                                    title="Pick your metrics and schedule"
                                    body="Choose dimensions (campaign, ad group, ad), select metrics, set a date range, and configure auto-refresh from hourly to daily."
                                />
                                <Step
                                    num="03"
                                    title="Data lands where you work"
                                    body="Results write directly into Google Sheets™ via our add-on, or stream into Looker Studio through our certified connector. No exports, no copy-paste."
                                />
                            </div>
                        </div>

                        {/* Right: terminal-style preview */}
                        <div className="relative">
                            <div className="absolute inset-0 bg-emerald-500/5 blur-[80px] rounded-full pointer-events-none" />
                            <div className="relative border border-white/10 rounded-sm overflow-hidden bg-[#0d0d10]">
                                {/* Terminal header */}
                                <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                                    <span className="ml-3 font-mono text-[10px] text-gray-600">monstera — console</span>
                                </div>
                                {/* Terminal body */}
                                <div className="p-5 font-mono text-[11px] leading-relaxed flex flex-col gap-1.5">
                                    <div className="text-gray-600">$ monstera sync --source tiktok_ads --level campaign</div>
                                    <div className="text-emerald-400/70">✓ OAuth token validated</div>
                                    <div className="text-gray-500">→ Fetching campaigns (2025-03-01 → 2025-04-15)…</div>
                                    <div className="text-blue-400/70">  [META] Normalising 312 rows</div>
                                    <div className="text-blue-400/70">  [TIKTOK] Normalising 189 rows</div>
                                    <div className="text-blue-400/70">  [GOOGLE] Normalising 221 rows</div>
                                    <div className="text-gray-500">→ Writing to Sheet1!A1…</div>
                                    <div className="text-emerald-400">✓ 722 rows written  (1.2s)</div>
                                    <div className="text-gray-600 mt-1">Next auto-refresh: 06:00 ICT</div>
                                    <div className="flex items-center gap-1.5 mt-2">
                                        <span className="text-emerald-500/50">▋</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── APAC / BUILT FOR SEA ────────────────────────── */}
            <section className="py-28 px-4 sm:px-6 lg:px-8 border-b border-white/5">
                <div className="max-w-7xl mx-auto">
                    <div className="grid lg:grid-cols-2 gap-20 items-center">
                        <div>
                            <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-4">Region</p>
                            <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-6">Built for Southeast Asia</h2>
                            <p className="text-gray-400 text-sm leading-relaxed mb-8 max-w-md">
                                Designed for Vietnamese and SEA sellers managing TikTok Shop, Shopee, and Lazada. Pay in VND or USD. Infrastructure hosted in Singapore for low latency.
                            </p>
                            <div className="flex gap-3">
                                <Link
                                    href="/pricing"
                                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-sm transition-colors"
                                >
                                    See Plans <ChevronRight className="w-3.5 h-3.5" />
                                </Link>
                            </div>
                        </div>

                        {/* Stat cards */}
                        <div className="grid grid-cols-2 gap-4">
                            {[
                                { icon: Clock, stat: "< 60s", label: "Time to first data sync" },
                                { icon: RefreshCw, stat: "1h", label: "Minimum auto-refresh interval" },
                                { icon: Database, stat: "5+", label: "Ad platforms connected" },
                                { icon: Shield, stat: "TLS 1.3", label: "Encrypted in transit" },
                            ].map(({ icon: Icon, stat, label }) => (
                                <div key={label} className="p-6 border border-white/8 bg-white/[0.02] hover:border-white/20 transition-colors">
                                    <Icon className="w-4 h-4 text-gray-600 mb-4" />
                                    <div className="text-2xl font-black text-white mb-1">{stat}</div>
                                    <div className="text-[11px] text-gray-500 leading-snug">{label}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* ── CTA ─────────────────────────────────────────── */}
            <section className="py-28 px-4 sm:px-6 lg:px-8">
                <div className="max-w-7xl mx-auto">
                    <div className="relative border border-emerald-500/20 bg-emerald-500/[0.04] p-px">
                        <div className="px-8 py-20 text-center relative overflow-hidden">
                            {/* subtle corner glows */}
                            <div className="pointer-events-none absolute top-0 left-0 w-48 h-48 bg-emerald-500/8 blur-[80px]" />
                            <div className="pointer-events-none absolute bottom-0 right-0 w-48 h-48 bg-emerald-500/8 blur-[80px]" />

                            <div className="relative z-10 max-w-2xl mx-auto">
                                <p className="font-mono text-[10px] text-emerald-500/60 uppercase tracking-widest mb-4">Get started</p>
                                <h2 className="text-3xl md:text-5xl font-black text-white tracking-tight mb-5">
                                    Connect your first data source today.
                                </h2>
                                <p className="text-gray-400 text-sm mb-10 leading-relaxed">
                                    Free plan includes TikTok Ads + Shopee. No credit card required.
                                </p>
                                <Link
                                    href="/register"
                                    className="group inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-sm transition-colors shadow-xl shadow-emerald-900/40"
                                >
                                    Create free account
                                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                                </Link>
                                <p className="mt-8 font-mono text-[10px] text-gray-700 uppercase tracking-widest">
                                    No credit card · TLS encrypted · VND + USD billing
                                </p>
                            </div>
                        </div>
                    </div>

                    <p className="mt-12 text-center text-[10px] text-gray-600 italic">
                        Google Sheets™ and Google Workspace™ are trademarks of Google LLC. Monstera Cloud is not affiliated with Google.
                    </p>
                </div>
            </section>
        </div>
    );
}
