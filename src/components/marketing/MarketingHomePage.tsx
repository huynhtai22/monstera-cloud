"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, Shield, Lock, Eye } from "lucide-react";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";

const MARKETING_LANG_KEY = "marketing_lang";

// ─────────────────────────────────────────────
// Copy — EN / VI
// ─────────────────────────────────────────────
const COPY = {
    en: {
        hero: {
            h1: ["Stop reconciling spreadsheets", "at midnight."],
            sub: "Monstera Cloud pulls TikTok Ads, Meta, Shopee, and Google Ads into one clean Google Sheet — automatically, every day.",
            cta: "Start free — first sync in 5 min",
            ctaSub: "See a live dashboard",
            trust: [
                { icon: Lock, text: "OAuth only — we never see your password" },
                { icon: Eye, text: "Read-only access to your ad data" },
                { icon: Shield, text: "TLS 1.3 encrypted · Workspace isolated" },
            ],
        },
        how: {
            eyebrow: "How it works",
            steps: [
                { num: "01", title: "Connect your platforms", body: "Sign in with TikTok Ads, Meta, Shopee, or Google Ads. OAuth — just click Authorize." },
                { num: "02", title: "Pick your metrics", body: "Choose what to track — spend, ROAS, orders, revenue. Set hourly or daily refresh." },
                { num: "03", title: "Data shows up automatically", body: "Numbers go straight into Google Sheets™ or Looker Studio. Always fresh, zero manual work." },
            ],
            card: {
                filename: "My Business Dashboard.xlsx",
                synced: "All platforms synced",
                updated: "Updated 2 min ago",
                footer: "Next auto-refresh in 58 min · Powered by Monstera",
            },
        },
        cta: {
            h2: ["Your data.", "In your spreadsheet."],
            sub: "Free plan includes TikTok Ads + Shopee. No credit card required.",
            btn: "Create free account",
            trust: "No credit card · OAuth only · VND + USD billing",
            legal: "Google Sheets™ and Google Workspace™ are trademarks of Google LLC. Monstera Cloud is not affiliated with Google.",
        },
        card: {
            platforms: [
                { label: "TikTok Ads", value: "$3,240 spend", delta: "+12%" },
                { label: "Meta Ads", value: "4.2x ROAS", delta: "+8%" },
                { label: "Shopee", value: "$8,910 revenue", delta: "+31%" },
                { label: "Google Ads", value: "$0.91 CPC", delta: "-5%" },
            ],
        },
        footer: {
            product: "Product",
            productLinks: [
                { label: "Sources", href: "/sources" },
                { label: "Destinations", href: "/destinations" },
                { label: "Pricing", href: "/pricing" },
            ],
            company: "Company",
            companyLinks: [
                { label: "About", href: "/about" },
                { label: "Support", href: "/support" },
                { label: "Changelog", href: "/changelog" },
            ],
            legal: "Legal",
            legalLinks: [
                { label: "Privacy Policy", href: "/legal/privacy-policy" },
                { label: "Terms of Service", href: "/legal/terms-of-service" },
                { label: "Refund Policy", href: "/legal/refund-policy" },
            ],
            copy: `© ${new Date().getFullYear()} Monstera Cloud. All rights reserved.`,
        },
    },
    vi: {
        hero: {
            h1: ["Dừng đối chiếu bảng tính", "lúc nửa đêm."],
            sub: "Monstera Cloud đưa TikTok Ads, Meta, Shopee và Google Ads vào một Google Sheet sạch — tự động mỗi ngày.",
            cta: "Dùng thử miễn phí — đồng bộ trong 5 phút",
            ctaSub: "Xem dashboard mẫu",
            trust: [
                { icon: Lock, text: "Chỉ OAuth — không cần mật khẩu" },
                { icon: Eye, text: "Chỉ đọc dữ liệu quảng cáo" },
                { icon: Shield, text: "Mã hóa TLS 1.3 · Workspace riêng biệt" },
            ],
        },
        how: {
            eyebrow: "Cách hoạt động",
            steps: [
                { num: "01", title: "Kết nối nền tảng", body: "Đăng nhập TikTok Ads, Meta, Shopee hoặc Google Ads. Chỉ cần nhấn Cho phép." },
                { num: "02", title: "Chọn chỉ số", body: "Chọn chi phí, ROAS, đơn hàng, doanh thu. Đặt lịch cập nhật tự động." },
                { num: "03", title: "Dữ liệu tự động hiển thị", body: "Số liệu chạy thẳng vào Google Sheets™ hoặc Looker Studio. Không tốn công." },
            ],
            card: {
                filename: "Báo cáo kinh doanh.xlsx",
                synced: "Tất cả nền tảng đã đồng bộ",
                updated: "Cập nhật 2 phút trước",
                footer: "Tự động cập nhật sau 58 phút · Bởi Monstera",
            },
        },
        cta: {
            h2: ["Dữ liệu của bạn.", "Trong bảng tính của bạn."],
            sub: "Gói miễn phí bao gồm TikTok Ads + Shopee. Không cần thẻ tín dụng.",
            btn: "Tạo tài khoản miễn phí",
            trust: "Không cần thẻ · OAuth only · Thanh toán VND + USD",
            legal: "Google Sheets™ và Google Workspace™ là thương hiệu của Google LLC. Monstera Cloud không liên kết với Google.",
        },
        card: {
            platforms: [
                { label: "TikTok Ads", value: "$3,240 chi phí", delta: "+12%" },
                { label: "Meta Ads", value: "4.2x ROAS", delta: "+8%" },
                { label: "Shopee", value: "$8,910 doanh thu", delta: "+31%" },
                { label: "Google Ads", value: "$0.91 CPC", delta: "-5%" },
            ],
        },
        footer: {
            product: "Sản phẩm",
            productLinks: [
                { label: "Nguồn dữ liệu", href: "/sources" },
                { label: "Đích đến", href: "/destinations" },
                { label: "Bảng giá", href: "/pricing" },
            ],
            company: "Công ty",
            companyLinks: [
                { label: "Giới thiệu", href: "/about" },
                { label: "Hỗ trợ", href: "/support" },
                { label: "Nhật ký", href: "/changelog" },
            ],
            legal: "Pháp lý",
            legalLinks: [
                { label: "Chính sách bảo mật", href: "/legal/privacy-policy" },
                { label: "Điều khoản dịch vụ", href: "/legal/terms-of-service" },
                { label: "Chính sách hoàn tiền", href: "/legal/refund-policy" },
            ],
            copy: `© ${new Date().getFullYear()} Monstera Cloud. All rights reserved.`,
        },
    },
} as const;

type Lang = keyof typeof COPY;

const PLATFORM_LOGOS = [
    { logo: INTEGRATION_LOGOS.tiktok, color: "text-pink-400" },
    { logo: INTEGRATION_LOGOS.meta, color: "text-blue-400" },
    { logo: INTEGRATION_LOGOS.shopee, color: "text-orange-400" },
    { logo: INTEGRATION_LOGOS.googleAds, color: "text-green-400" },
] as const;

const HERO_LOGOS = [
    { src: INTEGRATION_LOGOS.tiktok, alt: "TikTok Ads" },
    { src: INTEGRATION_LOGOS.meta, alt: "Meta Ads" },
    { src: INTEGRATION_LOGOS.shopee, alt: "Shopee" },
    { src: INTEGRATION_LOGOS.googleAds, alt: "Google Ads" },
    { src: INTEGRATION_LOGOS.googleSheets, alt: "Google Sheets" },
    { src: INTEGRATION_LOGOS.looker, alt: "Looker Studio" },
];

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

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────
export default function MarketingHomePage() {
    const [lang, setLang] = useState<Lang>("en");

    useEffect(() => {
        if (typeof window === "undefined") return;

        const applyLang = (value: string | null) => {
            if (value === "en" || value === "vi") setLang(value);
        };

        applyLang(window.localStorage.getItem(MARKETING_LANG_KEY));

        const onStorage = (e: StorageEvent) => {
            if (e.key === MARKETING_LANG_KEY) applyLang(e.newValue);
        };
        const onCustom = (e: Event) => applyLang((e as CustomEvent<Lang>).detail);

        window.addEventListener("storage", onStorage);
        window.addEventListener("marketing-lang-change", onCustom as EventListener);
        return () => {
            window.removeEventListener("storage", onStorage);
            window.removeEventListener("marketing-lang-change", onCustom as EventListener);
        };
    }, []);

    const c = COPY[lang];

    return (
        <div className="relative min-h-screen bg-[#09090b] selection:bg-cyan-500/30">

            {/* ── 1. HERO ─────────────────────────────────────── */}
            <section className="relative pt-32 pb-20 overflow-hidden">
                <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-cyan-500/6 blur-[140px] rounded-full" />

                <div className="max-w-3xl mx-auto px-6 text-center relative">
                    <h1 className="text-4xl sm:text-5xl md:text-[4.2rem] font-black text-white tracking-tight leading-[1.08] mb-6">
                        {c.hero.h1[0]}<br />{c.hero.h1[1]}
                    </h1>

                    <p className="text-lg text-gray-400 mb-10 max-w-xl mx-auto leading-relaxed">
                        {c.hero.sub}
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-8">
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

                    {/* Platform logos — compact, replaces architecture diagram */}
                    <div className="flex items-center justify-center gap-5 mb-10">
                        {HERO_LOGOS.map(({ src, alt }) => (
                            <img key={alt} src={src} alt={alt} className="h-6 w-6 object-contain opacity-40 hover:opacity-70 transition-opacity" />
                        ))}
                    </div>

                    {/* Trust signals — visible, not buried */}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6">
                        {c.hero.trust.map(({ icon: Icon, text }) => (
                            <div key={text} className="flex items-center gap-2 text-xs text-gray-500">
                                <Icon className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                                <span>{text}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── 2. HOW IT WORKS ─────────────────────────────── */}
            <section className="py-24 px-6 border-t border-white/5">
                <div className="max-w-6xl mx-auto">
                    <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest mb-10 text-center">{c.how.eyebrow}</p>

                    <div className="grid lg:grid-cols-2 gap-16 items-center">
                        <div className="flex flex-col gap-10">
                            {c.how.steps.map((s) => (
                                <Step key={s.num} num={s.num} title={s.title} body={s.body} />
                            ))}
                        </div>

                        {/* Spreadsheet mockup */}
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

            {/* ── 3. TRUST + CTA ──────────────────────────────── */}
            <section className="py-24 px-6">
                <div className="max-w-3xl mx-auto">
                    <div className="relative border border-cyan-500/20 bg-cyan-500/[0.04] rounded-3xl overflow-hidden">
                        <div className="pointer-events-none absolute top-0 left-0 w-64 h-64 bg-cyan-500/8 blur-[80px]" />
                        <div className="pointer-events-none absolute bottom-0 right-0 w-64 h-64 bg-cyan-500/8 blur-[80px]" />

                        <div className="relative px-8 py-20 text-center">
                            <h2 className="text-3xl md:text-5xl font-black text-white tracking-tight mb-5">
                                {c.cta.h2[0]}<br />{c.cta.h2[1]}
                            </h2>
                            <p className="text-gray-400 text-sm mb-10 leading-relaxed max-w-md mx-auto">{c.cta.sub}</p>
                            <Link
                                href="/register"
                                className="group inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded-xl transition-colors shadow-xl shadow-cyan-900/40"
                            >
                                {c.cta.btn}
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                            </Link>
                            <p className="mt-8 font-mono text-[10px] text-gray-600 uppercase tracking-widest">{c.cta.trust}</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── 4. FOOTER ───────────────────────────────────── */}
            <footer className="border-t border-white/5 py-16 px-6">
                <div className="max-w-6xl mx-auto">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-12">
                        {/* Brand */}
                        <div className="col-span-2 sm:col-span-1">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
                                    <span className="font-black text-cyan-400 text-sm leading-none">M</span>
                                </div>
                                <span className="text-sm font-bold text-white">Monstera Cloud</span>
                            </div>
                            <p className="text-xs text-gray-600 leading-relaxed max-w-[200px]">
                                Ad data → spreadsheets, automatically.
                            </p>
                        </div>

                        {/* Product */}
                        <div>
                            <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-4">{c.footer.product}</h4>
                            <ul className="space-y-2.5">
                                {c.footer.productLinks.map(({ label, href }) => (
                                    <li key={href}>
                                        <Link href={href} className="text-xs text-gray-500 hover:text-white transition-colors">{label}</Link>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Company */}
                        <div>
                            <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-4">{c.footer.company}</h4>
                            <ul className="space-y-2.5">
                                {c.footer.companyLinks.map(({ label, href }) => (
                                    <li key={href}>
                                        <Link href={href} className="text-xs text-gray-500 hover:text-white transition-colors">{label}</Link>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Legal */}
                        <div>
                            <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-4">{c.footer.legal}</h4>
                            <ul className="space-y-2.5">
                                {c.footer.legalLinks.map(({ label, href }) => (
                                    <li key={href}>
                                        <Link href={href} className="text-xs text-gray-500 hover:text-white transition-colors">{label}</Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    <div className="border-t border-white/5 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
                        <p className="text-[10px] text-gray-600">{c.footer.copy}</p>
                        <p className="text-[10px] text-gray-700 italic">{c.cta.legal}</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}
