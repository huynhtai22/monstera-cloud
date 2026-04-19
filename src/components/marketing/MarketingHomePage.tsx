"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowRight,
    ChevronRight,
    Zap,
    Globe,
    Shield,
    Clock,
    Database,
    RefreshCw,
    CheckCircle2,
} from "lucide-react";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { MarketingTrustSecuritySection } from "@/components/marketing/MarketingTrustSecuritySection";

const MARKETING_LANG_KEY = "marketing_lang";

// ─────────────────────────────────────────────
// Copy — EN / VI
// ─────────────────────────────────────────────
const COPY = {
    en: {
        hero: {
            h1: ["Stop reconciling spreadsheets", "at midnight."],
            sub: "Monstera Cloud pulls TikTok Ads, Meta, Shopee, and Google Ads into one clean Google Sheet — automatically, every day. Built for sellers and agencies in Southeast Asia.",
            cta: "Start free — first sync in 5 min",
            ctaSub: "See a live dashboard",
            heroTrust: "No card · Vietnamese support · Upgrade when you need more",
        },
        diff: [
            { num: "01", title: "Live in under 60 seconds",  body: "Connect your first platform, pick your metrics, and data is in your spreadsheet before your coffee goes cold." },
            { num: "02", title: "No code. No setup.",         body: "OAuth sign-in, click a few fields, done. Built for business owners — not developers." },
            { num: "03", title: "Every SEA platform",         body: "TikTok Ads, Meta Ads, Shopee, Google Ads — all the channels your business actually runs on." },
            { num: "04", title: "VND + USD billing",          body: "Priced for sellers and agencies in Vietnam, Indonesia, and Thailand." },
        ],
        grid: {
            eyebrow: "What you can connect",
            h2: ["Every channel.", "One workspace."],
            sub: "Stop switching between five tabs. Monstera pulls all your ad and store data into one place — clean, normalised, and always up to date.",
            link: "See how sellers use Monstera",
            sources: "Data sources",
            destinations: "Destinations",
        },
        how: {
            eyebrow: "How it works",
            steps: [
                { num: "01", title: "Connect your platforms",          body: "Sign in with TikTok Ads, Meta, Shopee, or Google Ads. Takes 2 minutes. We handle the auth — you just click Authorize." },
                { num: "02", title: "Pick your metrics and schedule",   body: "Choose what you want to track — spend, ROAS, orders, revenue. Set hourly or daily auto-refresh." },
                { num: "03", title: "Your data shows up automatically", body: "Numbers go straight into your Google Sheets™ or Looker Studio. Always fresh, zero manual work." },
            ],
            card: {
                filename: "My Business Dashboard.xlsx",
                synced: "All platforms synced",
                updated: "Updated 2 min ago",
                footer: "Next auto-refresh in 58 min · Powered by Monstera",
            },
        },
        sea: {
            eyebrow: "Region",
            h2: "Built for Southeast Asia",
            sub: "Designed for Vietnamese and SEA sellers managing TikTok Shop, Shopee, and Lazada. Pay in VND or USD. Infrastructure hosted in Singapore for low latency.",
            cta: "See Plans",
            stats: [
                { stat: "< 60s",   label: "Time to first sync" },
                { stat: "1h",      label: "Min auto-refresh interval" },
                { stat: "5+",      label: "Ad platforms connected" },
                { stat: "TLS 1.3", label: "Encrypted in transit" },
            ],
        },
        cta: {
            eyebrow: "Get started",
            h2: ["Your data.", "In your spreadsheet."],
            sub: "Connect your first platform in under 60 seconds. Free plan includes TikTok Ads + Shopee. No credit card required.",
            btn: "Create free account",
            trust: "No credit card · TLS encrypted · VND + USD billing",
            legal: "Google Sheets™ and Google Workspace™ are trademarks of Google LLC. Monstera Cloud is not affiliated with Google.",
        },
        card: {
            synced: "All platforms synced",
            updated: "Updated 2 min ago",
            footer: "Next auto-refresh in 58 min · Powered by Monstera",
            platforms: [
                { label: "TikTok Ads",  value: "$3,240 spend",   delta: "+12%" },
                { label: "Meta Ads",    value: "4.2x ROAS",      delta: "+8%"  },
                { label: "Shopee",      value: "$8,910 revenue",  delta: "+31%" },
                { label: "Google Ads",  value: "$0.91 CPC",       delta: "-5%"  },
            ],
        },
        partner: "Official API Partner",
    },
    vi: {
        hero: {
            h1: ["Dừng đối chiếu bảng tính", "lúc nửa đêm."],
            sub: "Monstera Cloud đưa TikTok Ads, Meta, Shopee và Google Ads vào một Google Sheet sạch — tự động mỗi ngày. Dành cho seller và agency Đông Nam Á.",
            cta: "Dùng thử miễn phí — đồng bộ đầu tiên trong 5 phút",
            ctaSub: "Xem dashboard mẫu",
            heroTrust: "Không cần thẻ · Hỗ trợ tiếng Việt · Nâng cấp khi cần thêm tính năng",
        },
        diff: [
            { num: "01", title: "Kết nối trong 60 giây",          body: "Kết nối nền tảng đầu tiên, chọn chỉ số, và dữ liệu đã có trong bảng tính của bạn — nhanh hơn một ly cà phê." },
            { num: "02", title: "Không code. Không cài đặt.",      body: "Đăng nhập OAuth, chọn vài trường là xong. Được xây dựng cho chủ kinh doanh — không phải lập trình viên." },
            { num: "03", title: "Toàn bộ nền tảng SEA",            body: "TikTok Ads, Meta Ads, Shopee, Google Ads — tất cả kênh bán hàng bạn đang dùng mỗi ngày." },
            { num: "04", title: "Thanh toán VND + USD",            body: "Mức giá phù hợp cho nhà bán và agency tại Việt Nam, Indonesia và Thái Lan." },
        ],
        grid: {
            eyebrow: "Kết nối với",
            h2: ["Mọi kênh bán hàng.", "Một nơi quản lý."],
            sub: "Hết cảnh mở 5 tab cùng lúc. Monstera tổng hợp toàn bộ dữ liệu quảng cáo và cửa hàng của bạn vào một nơi — sạch sẽ, chuẩn hóa và luôn cập nhật.",
            link: "Xem cách nhà bán dùng Monstera",
            sources: "Nguồn dữ liệu",
            destinations: "Đích đến",
        },
        how: {
            eyebrow: "Cách hoạt động",
            steps: [
                { num: "01", title: "Kết nối nền tảng của bạn",    body: "Đăng nhập TikTok Ads, Meta, Shopee hoặc Google Ads. Chỉ mất 2 phút. Chúng tôi xử lý xác thực — bạn chỉ cần nhấn Cho phép." },
                { num: "02", title: "Chọn chỉ số và lịch cập nhật", body: "Chọn những gì bạn muốn theo dõi — chi phí, ROAS, đơn hàng, doanh thu. Đặt lịch tự động cập nhật theo giờ hoặc ngày." },
                { num: "03", title: "Dữ liệu tự động hiển thị",     body: "Số liệu chạy thẳng vào Google Sheets™ hoặc Looker Studio của bạn. Luôn mới nhất, không tốn công thủ công." },
            ],
            card: {
                filename: "Báo cáo kinh doanh.xlsx",
                synced: "Tất cả nền tảng đã đồng bộ",
                updated: "Cập nhật 2 phút trước",
                footer: "Tự động cập nhật sau 58 phút · Bởi Monstera",
            },
        },
        sea: {
            eyebrow: "Khu vực",
            h2: "Được xây dựng cho Đông Nam Á",
            sub: "Được thiết kế cho nhà bán hàng Việt Nam và Đông Nam Á đang quản lý TikTok Shop, Shopee và Lazada. Thanh toán bằng VND hoặc USD. Hạ tầng đặt tại Singapore để đảm bảo tốc độ.",
            cta: "Xem gói cước",
            stats: [
                { stat: "< 60s",   label: "Thời gian đồng bộ đầu tiên" },
                { stat: "1h",      label: "Chu kỳ cập nhật tối thiểu" },
                { stat: "5+",      label: "Nền tảng quảng cáo" },
                { stat: "TLS 1.3", label: "Mã hóa kết nối" },
            ],
        },
        cta: {
            eyebrow: "Bắt đầu ngay",
            h2: ["Dữ liệu của bạn.", "Trong bảng tính của bạn."],
            sub: "Kết nối nền tảng đầu tiên trong vòng 60 giây. Gói miễn phí bao gồm TikTok Ads + Shopee. Không cần thẻ tín dụng.",
            btn: "Tạo tài khoản miễn phí",
            trust: "Không cần thẻ · Mã hóa TLS · Thanh toán VND + USD",
            legal: "Google Sheets™ và Google Workspace™ là thương hiệu của Google LLC. Monstera Cloud không liên kết với Google.",
        },
        card: {
            synced: "Tất cả nền tảng đã đồng bộ",
            updated: "Cập nhật 2 phút trước",
            footer: "Tự động cập nhật sau 58 phút · Bởi Monstera",
            platforms: [
                { label: "TikTok Ads",  value: "$3,240 chi phí",    delta: "+12%" },
                { label: "Meta Ads",    value: "4.2x ROAS",          delta: "+8%"  },
                { label: "Shopee",      value: "$8,910 doanh thu",   delta: "+31%" },
                { label: "Google Ads",  value: "$0.91 CPC",          delta: "-5%"  },
            ],
        },
        partner: "Đối tác API Chính thức",
    },
} as const;

type Lang = keyof typeof COPY;

// ─────────────────────────────────────────────
// Architecture nodes
// ─────────────────────────────────────────────
function SourceNode({ label, logo, alt, tint }: { label: string; logo: string; alt: string; tint: string }) {
    return (
        <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border ${tint} min-w-[148px]`}>
            <img src={logo} alt={alt} className="h-4 w-4 object-contain brightness-0 invert opacity-75 flex-shrink-0" />
            <span className="text-xs text-gray-300 font-medium whitespace-nowrap">{label}</span>
        </div>
    );
}

function DestNode({ label, logo, alt }: { label: string; logo: string; alt: string }) {
    return (
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-cyan-500/8 border border-cyan-500/25 min-w-[160px]">
            <img src={logo} alt={alt} className="h-4 w-4 object-contain brightness-0 invert opacity-75 flex-shrink-0" />
            <span className="text-xs text-cyan-300 font-medium whitespace-nowrap">{label}</span>
        </div>
    );
}

// ─────────────────────────────────────────────
// Differentiator card
// ─────────────────────────────────────────────
function DiffCard({ num, title, body, icon: Icon }: { num: string; title: string; body: string; icon: React.ElementType }) {
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
function Step({ num, title, body }: { num: string; title: string; body: string }) {
    return (
        <div className="flex gap-5 group">
            <div className="flex-shrink-0 w-9 h-9 rounded-full border border-white/10 flex items-center justify-center group-hover:border-cyan-500/40 transition-colors mt-0.5">
                <span className="font-mono text-xs text-gray-500 group-hover:text-cyan-400 transition-colors">{num}</span>
            </div>
            <div>
                <h3 className="text-base font-semibold text-white mb-1.5">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
            </div>
        </div>
    );
}

const PLATFORM_LOGOS = [
    { logo: INTEGRATION_LOGOS.tiktok,    color: "text-pink-400" },
    { logo: INTEGRATION_LOGOS.meta,      color: "text-blue-400" },
    { logo: INTEGRATION_LOGOS.shopee,    color: "text-orange-400" },
    { logo: INTEGRATION_LOGOS.googleAds, color: "text-green-400" },
] as const;

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────
export default function MarketingHomePage() {
    const [lang, setLang] = useState<Lang>("en");

    useEffect(() => {
        if (typeof window === "undefined") return;

        const applyLang = (value: string | null) => {
            if (value === "en" || value === "vi") {
                setLang(value);
            }
        };

        applyLang(window.localStorage.getItem(MARKETING_LANG_KEY));

        const onStorage = (event: StorageEvent) => {
            if (event.key === MARKETING_LANG_KEY) {
                applyLang(event.newValue);
            }
        };

        const onMarketingLangChange = (event: Event) => {
            const nextLang = (event as CustomEvent<Lang>).detail;
            applyLang(nextLang);
        };

        window.addEventListener("storage", onStorage);
        window.addEventListener("marketing-lang-change", onMarketingLangChange as EventListener);

        return () => {
            window.removeEventListener("storage", onStorage);
            window.removeEventListener("marketing-lang-change", onMarketingLangChange as EventListener);
        };
    }, []);

    const c = COPY[lang];

    return (
        <div className="relative min-h-screen bg-[#09090b] selection:bg-cyan-500/30">
            {/* ── HERO ──────────────────────────────────────────── */}
            <section className="relative pt-32 pb-24 border-b border-white/5 overflow-hidden">
                <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-cyan-500/6 blur-[140px] rounded-full" />

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
                    <div className="max-w-3xl mx-auto text-center mb-14">

                        <h1 className="text-5xl md:text-[4.5rem] font-black text-white tracking-tight leading-[1.05] mb-6">
                            {c.hero.h1[0]}
                            <br />
                            {c.hero.h1[1]}
                        </h1>

                        <p className="text-lg text-gray-400 mb-10 max-w-xl mx-auto leading-relaxed">
                            {c.hero.sub}
                        </p>

                        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                            <Link
                                href="/register"
                                className="group inline-flex items-center gap-2 px-7 py-3.5 text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded-xl transition-colors shadow-lg shadow-cyan-900/40"
                            >
                                {c.hero.cta}
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                            </Link>
                            <Link
                                href="/showcase"
                                className="inline-flex items-center gap-2 px-7 py-3.5 text-sm font-medium text-gray-400 hover:text-white border border-white/10 hover:border-white/20 rounded-xl transition-colors"
                            >
                                {c.hero.ctaSub} <ChevronRight className="w-3.5 h-3.5" />
                            </Link>
                        </div>
                        <p className="mt-6 text-xs text-gray-500">{c.hero.heroTrust}</p>
                    </div>

                    {/* Architecture diagram */}
                    <div className="flex items-center gap-0 w-full max-w-5xl mx-auto">
                        {/* Sources: 2×2 grid */}
                        <div className="flex-shrink-0 grid grid-cols-2 gap-2.5">
                            <SourceNode label="TikTok Ads"  logo={INTEGRATION_LOGOS.tiktok}    alt="TikTok"     tint="bg-red-500/5 border-red-500/20" />
                            <SourceNode label="Meta Ads"    logo={INTEGRATION_LOGOS.meta}      alt="Meta"       tint="bg-blue-500/5 border-blue-500/20" />
                            <SourceNode label="Shopee"      logo={INTEGRATION_LOGOS.shopee}    alt="Shopee"     tint="bg-orange-500/5 border-orange-500/20" />
                            <SourceNode label="Google Ads"  logo={INTEGRATION_LOGOS.googleAds} alt="Google Ads" tint="bg-green-500/5 border-green-500/20" />
                        </div>

                        {/* Left connector */}
                        <div className="flex-1 relative h-[2px] mx-4">
                            <div className="absolute inset-0 bg-gradient-to-r from-white/5 via-white/20 to-white/10" />
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-white/30" />
                        </div>

                        {/* Center — Monstera */}
                        <div className="flex-shrink-0 w-36 h-36 rounded-2xl border border-cyan-500/30 bg-cyan-500/5 flex flex-col items-center justify-center gap-3 relative">
                            <div className="absolute inset-0 rounded-2xl bg-cyan-400/5 blur-sm pointer-events-none" />
                            <div className="relative w-11 h-11 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
                                <span className="font-black text-cyan-400 text-xl leading-none">M</span>
                            </div>
                            <span className="relative font-mono text-[9px] text-cyan-400/70 tracking-widest uppercase text-center leading-tight">Monstera<br />Cloud</span>
                        </div>

                        {/* Right connector */}
                        <div className="flex-1 relative h-[2px] mx-4">
                            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-cyan-500/30 to-cyan-500/5" />
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-cyan-500/50" />
                        </div>

                        {/* Destinations */}
                        <div className="flex-shrink-0 flex flex-col gap-2.5">
                            <DestNode label="Google Sheets™" logo={INTEGRATION_LOGOS.googleSheets} alt="Google Sheets" />
                            <DestNode label="Looker Studio"   logo={INTEGRATION_LOGOS.looker}       alt="Looker Studio" />
                            <DestNode label="Direct Export"   logo={INTEGRATION_LOGOS.postgresql}   alt="Export" />
                        </div>
                    </div>

                    {/* Partner strip */}
                    <div className="mt-12 pt-8 border-t border-white/5 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
                        <span className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">{c.partner}</span>
                        <div className="flex items-center gap-6 opacity-40 hover:opacity-60 transition-opacity">
                            <img src={INTEGRATION_LOGOS.tiktok}       alt="TikTok"        className="h-5 w-auto brightness-0 invert" />
                            <img src={INTEGRATION_LOGOS.meta}         alt="Meta"          className="h-5 w-auto brightness-0 invert" />
                            <img src={INTEGRATION_LOGOS.googleAds}    alt="Google Ads"    className="h-5 w-auto brightness-0 invert" />
                            <img src={INTEGRATION_LOGOS.googleSheets} alt="Google Sheets" className="h-5 w-auto brightness-0 invert" />
                        </div>
                    </div>
                </div>
            </section>

            {/* ── DIFFERENTIATOR STRIP ────────────────────────── */}
            <section className="border-b border-white/5">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/5">
                        {c.diff.map((d, i) => (
                            <DiffCard key={i} num={d.num} title={d.title} body={d.body}
                                icon={[Zap, CheckCircle2, Globe, RefreshCw][i]} />
                        ))}
                    </div>
                </div>
            </section>

            {/* ── CAPABILITY GRID ─────────────────────────────── */}
            <section className="py-28 px-4 sm:px-6 lg:px-8 border-b border-white/5">
                <div className="max-w-7xl mx-auto">
                    <div className="grid lg:grid-cols-2 gap-16 items-start">
                        <div>
                            <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-4">{c.grid.eyebrow}</p>
                            <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight leading-tight mb-6">
                                {c.grid.h2[0]}<br />{c.grid.h2[1]}
                            </h2>
                            <p className="text-gray-400 text-sm leading-relaxed max-w-md mb-8">{c.grid.sub}</p>
                            <Link href="/solutions/smes" className="inline-flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300 transition-colors font-medium">
                                {c.grid.link} <ChevronRight className="w-3.5 h-3.5" />
                            </Link>
                        </div>

                        <div>
                            <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-4">{c.grid.sources}</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/5 border border-white/5 mb-6">
                                {[
                                    { logo: INTEGRATION_LOGOS.tiktok,          label: "TikTok Ads" },
                                    { logo: INTEGRATION_LOGOS.meta,            label: "Meta Ads" },
                                    { logo: INTEGRATION_LOGOS.shopee,          label: "Shopee" },
                                    { logo: INTEGRATION_LOGOS.googleAds,       label: "Google Ads" },
                                    { logo: INTEGRATION_LOGOS.shopify,         label: "Shopify" },
                                    { logo: INTEGRATION_LOGOS.lazada,          label: "Lazada" },
                                    { logo: INTEGRATION_LOGOS.googleAnalytics, label: "GA4" },
                                    { logo: INTEGRATION_LOGOS.slack,           label: "Slack Alerts" },
                                ].map(({ logo, label }) => (
                                    <div key={label} className="flex flex-col items-center justify-center gap-2 p-4 bg-[#09090b] hover:bg-white/[0.03] transition-colors">
                                        <img src={logo} alt={label} className="h-5 w-5 object-contain brightness-0 invert opacity-60" />
                                        <span className="text-[10px] text-gray-600 text-center leading-tight">{label}</span>
                                    </div>
                                ))}
                            </div>

                            <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-4">{c.grid.destinations}</p>
                            <div className="grid grid-cols-3 gap-px bg-white/5 border border-white/5">
                                {[
                                    { logo: INTEGRATION_LOGOS.googleSheets, label: "Google Sheets™" },
                                    { logo: INTEGRATION_LOGOS.looker,       label: "Looker Studio" },
                                    { logo: INTEGRATION_LOGOS.postgresql,   label: "Direct Export" },
                                ].map(({ logo, label }) => (
                                    <div key={label} className="flex flex-col items-center justify-center gap-2 p-4 bg-[#09090b] hover:bg-white/[0.03] transition-colors">
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
                        <div>
                            <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-8">{c.how.eyebrow}</p>
                            <div className="flex flex-col gap-10">
                                {c.how.steps.map((s) => (
                                    <Step key={s.num} num={s.num} title={s.title} body={s.body} />
                                ))}
                            </div>
                        </div>

                        <div className="relative">
                            <div className="absolute inset-0 bg-cyan-500/5 blur-[80px] rounded-full pointer-events-none" />
                            <div className="relative border border-white/10 rounded-2xl overflow-hidden bg-[#0d0d10]">
                                <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/5 bg-white/[0.02]">
                                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                                    <span className="ml-3 text-[11px] text-gray-500 font-medium">{c.how.card.filename}</span>
                                </div>

                                <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between bg-cyan-500/[0.04]">
                                    <div className="flex items-center gap-2">
                                        <span className="relative flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
                                        </span>
                                        <span className="text-xs text-cyan-400 font-medium">{c.how.card.synced}</span>
                                    </div>
                                    <span className="text-[10px] text-gray-600">{c.how.card.updated}</span>
                                </div>

                                <div className="p-5 flex flex-col gap-3">
                                    {c.card.platforms.map(({ label, value, delta }, i) => (
                                        <div key={label} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center">
                                                    <img src={PLATFORM_LOGOS[i].logo} alt={label} className="h-3.5 w-3.5 object-contain brightness-0 invert opacity-70" />
                                                </div>
                                                <span className="text-sm text-gray-300 font-medium">{label}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className={`text-sm font-semibold ${PLATFORM_LOGOS[i].color}`}>{value}</span>
                                                <span className="text-[10px] text-gray-600 font-mono bg-white/5 px-2 py-0.5 rounded-full">{delta}</span>
                                            </div>
                                        </div>
                                    ))}
                                    <div className="mt-1 text-center">
                                        <span className="text-[10px] text-gray-600 font-mono">{c.how.card.footer}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── SEA SECTION ─────────────────────────────────── */}
            <section className="py-28 px-4 sm:px-6 lg:px-8 border-b border-white/5">
                <div className="max-w-7xl mx-auto">
                    <div className="grid lg:grid-cols-2 gap-20 items-center">
                        <div>
                            <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-4">{c.sea.eyebrow}</p>
                            <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-6">{c.sea.h2}</h2>
                            <p className="text-gray-400 text-sm leading-relaxed mb-8 max-w-md">{c.sea.sub}</p>
                            <Link href="/pricing" className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded-xl transition-colors">
                                {c.sea.cta} <ChevronRight className="w-3.5 h-3.5" />
                            </Link>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            {c.sea.stats.map(({ stat, label }, i) => {
                                const icons = [Clock, RefreshCw, Database, Shield];
                                const Icon = icons[i];
                                return (
                                    <div key={label} className="p-6 border border-white/8 bg-white/[0.02] hover:border-white/20 rounded-2xl transition-colors">
                                        <Icon className="w-4 h-4 text-gray-600 mb-4" />
                                        <div className="text-2xl font-black text-white mb-1">{stat}</div>
                                        <div className="text-[11px] text-gray-500 leading-snug">{label}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </section>

            <MarketingTrustSecuritySection />

            {/* ── CTA ─────────────────────────────────────────── */}
            <section className="py-28 px-4 sm:px-6 lg:px-8">
                <div className="max-w-7xl mx-auto">
                    <div className="relative border border-cyan-500/20 bg-cyan-500/[0.04] rounded-3xl overflow-hidden">
                        <div className="pointer-events-none absolute top-0 left-0 w-64 h-64 bg-cyan-500/8 blur-[80px]" />
                        <div className="pointer-events-none absolute bottom-0 right-0 w-64 h-64 bg-cyan-500/8 blur-[80px]" />
                        <div className="relative px-8 py-20 text-center max-w-2xl mx-auto">
                            <p className="font-mono text-[10px] text-cyan-500/60 uppercase tracking-widest mb-4">{c.cta.eyebrow}</p>
                            <h2 className="text-3xl md:text-5xl font-black text-white tracking-tight mb-5">
                                {c.cta.h2[0]}<br />{c.cta.h2[1]}
                            </h2>
                            <p className="text-gray-400 text-sm mb-10 leading-relaxed">{c.cta.sub}</p>
                            <Link href="/register" className="group inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded-xl transition-colors shadow-xl shadow-cyan-900/40">
                                {c.cta.btn}
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                            </Link>
                            <p className="mt-8 font-mono text-[10px] text-gray-700 uppercase tracking-widest">{c.cta.trust}</p>
                        </div>
                    </div>

                    <p className="mt-12 text-center text-[10px] text-gray-600 italic">{c.cta.legal}</p>
                </div>
            </section>
        </div>
    );
}
