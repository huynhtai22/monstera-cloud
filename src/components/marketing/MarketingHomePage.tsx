"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ChevronRight, Shield, Lock, Eye, Zap } from "lucide-react";
import { LegalEntityNotice } from "@/components/LegalEntityNotice";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";

const MARKETING_LANG_KEY = "marketing_lang";

// ─────────────────────────────────────────────
// Animated Stat — count-up on scroll into view
// ─────────────────────────────────────────────
function AnimatedStat({ value, label, delay = 0 }: { value: string; label: string; delay?: number }) {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const [display, setDisplay] = useState("");

    // Detect when the element enters the viewport
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
            { threshold: 0.5 },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Count-up animation
    useEffect(() => {
        if (!visible) return;

        // Parse: extract prefix, numeric part, suffix
        const match = value.match(/^([^0-9]*?)(\d+\.?\d*)(.*)$/);
        if (!match) {
            // Non-numeric value (e.g. "TLS 1.3") — just reveal
            const t = setTimeout(() => setDisplay(value), delay);
            return () => clearTimeout(t);
        }

        const [, prefix, numStr, suffix] = match;
        const target = parseFloat(numStr);
        const isFloat = numStr.includes(".");
        const duration = 1200; // ms
        const fps = 40;
        const steps = Math.ceil(duration / (1000 / fps));
        let step = 0;

        const t = setTimeout(() => {
            const interval = setInterval(() => {
                step++;
                const progress = Math.min(step / steps, 1);
                // ease-out quad
                const eased = 1 - (1 - progress) * (1 - progress);
                const current = eased * target;
                setDisplay(`${prefix}${isFloat ? current.toFixed(1) : Math.round(current)}${suffix}`);
                if (progress >= 1) clearInterval(interval);
            }, 1000 / fps);
        }, delay);

        return () => clearTimeout(t);
    }, [visible, value, delay]);

    return (
        <div ref={ref} className="text-center">
            <div
                className={`text-2xl font-black text-slate-900 leading-none mb-1 transition-all duration-700 ${
                    visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
                }`}
                style={{ transitionDelay: `${delay}ms` }}
            >
                {display || "\u00A0"}
            </div>
            <div
                className={`text-[10px] text-slate-400 uppercase tracking-widest transition-all duration-700 ${
                    visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
                }`}
                style={{ transitionDelay: `${delay + 200}ms` }}
            >
                {label}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// Word Rotator
// ─────────────────────────────────────────────
function WordRotator({ words, interval = 2400 }: { words: readonly string[]; interval?: number }) {
    const [index, setIndex] = useState(0);

    useEffect(() => {
        const id = setInterval(() => setIndex(i => (i + 1) % words.length), interval);
        return () => clearInterval(id);
    }, [words.length, interval]);

    return (
        <span className="inline-flex overflow-hidden h-[1.15em] align-bottom relative">
            {words.map((word, i) => (
                <span
                    key={word}
                    className="absolute left-0 top-0 w-full transition-all duration-500 ease-in-out"
                    style={{
                        transform: i === index ? "translateY(0)" : i < index || (index === 0 && i === words.length - 1 && i !== 0) ? "translateY(-110%)" : "translateY(110%)",
                        opacity: i === index ? 1 : 0,
                    }}
                >
                    <span className="bg-gradient-to-r from-cyan-500 to-cyan-600 bg-clip-text text-transparent">{word}</span>
                </span>
            ))}
        </span>
    );
}

// ─────────────────────────────────────────────
// Copy — EN / VI
// ─────────────────────────────────────────────
const HERO_WORDS_EN = ["TikTok Ads", "Meta Ads", "Shopee", "Google Ads", "Lazada"] as const;
const HERO_WORDS_VI = ["TikTok Ads", "Meta Ads", "Shopee", "Google Ads", "Lazada"] as const;

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
            tabs: [
                { id: "connect", label: "Connect", icon: "plug", title: "Connect your platforms", body: "Sign in with TikTok Ads, Meta, Shopee, or Google Ads via OAuth. One click to authorize — no passwords shared.", detail: "6 platforms supported · OAuth 2.0 only" },
                { id: "sync", label: "Sync", icon: "refresh", title: "Reliable warehouse refresh", body: "Your campaigns, spend, ROAS, and orders refresh on demand and in one nightly run during the agency pilot.", detail: "Manual + nightly · Rate-limit aware" },
                { id: "report", label: "Report", icon: "sheet", title: "Delivered to your sheets", body: "Data lands in Google Sheets™ or Looker Studio automatically. Clean rows, correct columns, zero copy-paste.", detail: "Google Sheets™ add-on · Looker Studio connector" },
                { id: "optimize", label: "Optimize", icon: "zap", title: "Focus on decisions", body: "With data flowing automatically, your team spends time optimizing campaigns — not wrestling spreadsheets.", detail: "Save 3+ hours per week on reporting" },
            ],
        },
        cta: {
            h2: ["Your data.", "In your spreadsheet."],
            sub: "Free plan includes TikTok Ads + Shopee. No credit card required.",
            btn: "Create free account",
            trust: "No credit card · OAuth only · VND + USD billing",
            legal: "Google Sheets™ and Google Workspace™ are trademarks of Google LLC. Monstera Cloud is not affiliated with Google.",
        },
        stats: [
            { value: "< 60s", label: "First sync" },
            { value: "6", label: "Platforms" },
            { value: "1h", label: "Min refresh" },
            { value: "TLS 1.3", label: "Encrypted" },
        ],
        timeCompare: {
            heading: "Where does your time go?",
            sub: "Every week, this is what manual reporting costs you.",
            steps: [
                { task: "Export CSVs from 4 platforms", time: "40 min" },
                { task: "Copy-paste & fix data", time: "70 min" },
                { task: "Format & share reports", time: "50 min" },
                { task: "Repeat next week", time: "repeat" },
            ],
            total: "2h 40min",
            unit: "/week",
            after: {
                label: "With Monstera",
                total: "0 min",
                unit: "/week",
                setup: "5 min one-time setup",
                tagline: "Then it just works. Every day. Automatically.",
            },
        },
        proofRow1: [
            { quote: "Saved 3 hours every week on reporting.", author: "D.T., Agency Owner" },
            { quote: "Setup took 2 minutes, not kidding.", author: "H.V., Performance Marketer" },
            { quote: "My team stopped fighting over data discrepancies.", author: "A.L., Head of Growth" },
            { quote: "We cancelled 2 other tools after switching.", author: "K.R., COO" },
        ],
        proofRow2: [
            { quote: "Finally my Shopee and TikTok data in one place.", author: "L.N., Seller" },
            { quote: "No more midnight spreadsheet sessions.", author: "T.P., E-com Manager" },
            { quote: "Best ROI on any tool we use.", author: "M.K., Agency Director" },
            { quote: "Our daily standup is 10 minutes shorter now.", author: "P.H., Operations Lead" },
        ],
        showcase: {
            eyebrow: "Connects to",
            from: "Your platforms",
            to: "Your spreadsheets",
        },
        screenshot: {
            eyebrow: "See it in action",
            heading: "One dashboard. Every platform.",
            sub: "Real-time sync status, connection health, and data flowing into your sheets — all in one place.",
        },
        footer: {
            product: "Product",
            productLinks: [
                { label: "Sources", href: "/sources" },
                { label: "Exports", href: "/exports" },
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
            tabs: [
                { id: "connect", label: "Kết nối", icon: "plug", title: "Kết nối nền tảng", body: "Đăng nhập TikTok Ads, Meta, Shopee hoặc Google Ads qua OAuth. Chỉ cần nhấn Cho phép.", detail: "6 nền tảng · Chỉ OAuth 2.0" },
                { id: "sync", label: "Đồng bộ", icon: "refresh", title: "Tự động đồng bộ", body: "Chiến dịch, chi phí, ROAS và đơn hàng tự động cập nhật theo lịch — mỗi giờ, mỗi ngày, hoặc thủ công.", detail: "Làm mới mỗi giờ trên Pro · Tự quản rate-limit" },
                { id: "report", label: "Báo cáo", icon: "sheet", title: "Đến thẳng bảng tính", body: "Dữ liệu chạy vào Google Sheets™ hoặc Looker Studio tự động. Hàng sạch, cột đúng, không copy-paste.", detail: "Add-on Google Sheets™ · Kết nối Looker Studio" },
                { id: "optimize", label: "Tối ưu", icon: "zap", title: "Tập trung ra quyết định", body: "Dữ liệu tự chạy, team dành thời gian tối ưu chiến dịch — không vật lộn spreadsheet.", detail: "Tiết kiệm 3+ giờ/tuần cho báo cáo" },
            ],
        },
        cta: {
            h2: ["Dữ liệu của bạn.", "Trong bảng tính của bạn."],
            sub: "Gói miễn phí bao gồm TikTok Ads + Shopee. Không cần thẻ tín dụng.",
            btn: "Tạo tài khoản miễn phí",
            trust: "Không cần thẻ · OAuth only · Thanh toán VND + USD",
            legal: "Google Sheets™ và Google Workspace™ là thương hiệu của Google LLC. Monstera Cloud không liên kết với Google.",
        },
        stats: [
            { value: "< 60s", label: "Đồng bộ đầu" },
            { value: "6", label: "Nền tảng" },
            { value: "1h", label: "Tối thiểu" },
            { value: "TLS 1.3", label: "Mã hóa" },
        ],
        timeCompare: {
            heading: "Thời gian của bạn đang đi đâu?",
            sub: "Mỗi tuần, đây là chi phí thực của việc báo cáo thủ công.",
            steps: [
                { task: "Xuất CSV từ 4 nền tảng", time: "40 phút" },
                { task: "Copy-paste & sửa dữ liệu", time: "70 phút" },
                { task: "Định dạng & gửi báo cáo", time: "50 phút" },
                { task: "Lặp lại tuần sau", time: "lặp lại" },
            ],
            total: "2h 40min",
            unit: "/tuần",
            after: {
                label: "Với Monstera",
                total: "0 phút",
                unit: "/tuần",
                setup: "5 phút cài đặt một lần",
                tagline: "Sau đó tự động. Mỗi ngày. Mãi mãi.",
            },
        },
        proofRow1: [
            { quote: "Tiết kiệm 3 giờ mỗi tuần cho báo cáo.", author: "D.T., Chủ Agency" },
            { quote: "Setup mất 2 phút, không đùa.", author: "H.V., Performance Marketer" },
            { quote: "Team không còn cãi nhau vì số liệu lệch.", author: "A.L., Head of Growth" },
            { quote: "Hủy 2 tool khác sau khi dùng Monstera.", author: "K.R., COO" },
        ],
        proofRow2: [
            { quote: "Cuối cùng Shopee và TikTok trong một chỗ.", author: "L.N., Seller" },
            { quote: "Hết cảnh spreadsheet lúc nửa đêm.", author: "T.P., E-com Manager" },
            { quote: "ROI tốt nhất trong tất cả tool.", author: "M.K., Agency Director" },
            { quote: "Standup hàng ngày ngắn hơn 10 phút.", author: "P.H., Operations Lead" },
        ],
        showcase: {
            eyebrow: "Kết nối với",
            from: "Nền tảng của bạn",
            to: "Bảng tính của bạn",
        },
        screenshot: {
            eyebrow: "Xem thực tế",
            heading: "Một dashboard. Mọi nền tảng.",
            sub: "Trạng thái đồng bộ, sức khỏe kết nối, dữ liệu chảy vào sheet — tất cả một chỗ.",
        },
        footer: {
            product: "Sản phẩm",
            productLinks: [
                { label: "Nguồn dữ liệu", href: "/sources" },
                { label: "Xuất Dữ Liệu", href: "/exports" },
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

const HERO_LOGOS = [
    { src: INTEGRATION_LOGOS.tiktok, alt: "TikTok Ads" },
    { src: INTEGRATION_LOGOS.meta, alt: "Meta Ads" },
    { src: INTEGRATION_LOGOS.shopee, alt: "Shopee" },
    { src: INTEGRATION_LOGOS.googleAds, alt: "Google Ads" },
    { src: INTEGRATION_LOGOS.googleSheets, alt: "Google Sheets" },
    { src: INTEGRATION_LOGOS.looker, alt: "Looker Studio" },
];

// ─────────────────────────────────────────────
// Interactive Product Demo
// ─────────────────────────────────────────────
const DEMO_PLATFORMS = [
    { id: "tiktok_business", name: "TikTok Ads", logo: INTEGRATION_LOGOS.tiktok, metrics: "23 campaigns · $3,240 spend", syncedAgo: "12 min ago" },
    { id: "meta_ads", name: "Meta Ads", logo: INTEGRATION_LOGOS.meta, metrics: "12 ad sets · 4.2x ROAS", syncedAgo: "8 min ago" },
    { id: "shopee", name: "Shopee", logo: INTEGRATION_LOGOS.shopee, metrics: "156 orders · $8,910 revenue", syncedAgo: "5 min ago" },
    { id: "google_ads", name: "Google Ads", logo: INTEGRATION_LOGOS.googleAds, metrics: "8 campaigns · $0.91 CPC", syncedAgo: "3 min ago" },
    { id: "tiktok_shop", name: "TikTok Shop", logo: INTEGRATION_LOGOS.tiktok, metrics: "89 orders · $2,410 revenue", syncedAgo: "6 min ago" },
    { id: "lazada", name: "Lazada", logo: INTEGRATION_LOGOS.lazada, metrics: "42 orders · $1,850 revenue", syncedAgo: "9 min ago" },
] as const;

type ScreenshotCopy = (typeof COPY)[keyof typeof COPY]["screenshot"];

function InteractiveDemoSection({ copy }: { copy: ScreenshotCopy }) {
    const [selected, setSelected] = useState<Set<string>>(new Set(["tiktok_business", "meta_ads", "shopee", "google_ads"]));

    const toggle = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const activePlatforms = DEMO_PLATFORMS.filter(p => selected.has(p.id));
    const count = activePlatforms.length;

    return (
        <section className="border-t border-gray-100 py-28 px-6">
            <div className="max-w-5xl mx-auto text-center">
                <p className="font-mono text-[10px] text-slate-400 uppercase tracking-widest mb-4">{copy.eyebrow}</p>
                <h2 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight mb-4">{copy.heading}</h2>
                <p className="text-slate-500 text-base mb-10 max-w-xl mx-auto leading-relaxed">{copy.sub}</p>

                {/* Platform picker */}
                <div className="flex flex-wrap items-center justify-center gap-2.5 mb-10">
                    {DEMO_PLATFORMS.map(({ id, name, logo }) => {
                        const active = selected.has(id);
                        return (
                            <button
                                key={id}
                                type="button"
                                onClick={() => toggle(id)}
                                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                                    active
                                        ? "border-cyan-500/40 bg-cyan-50 text-slate-900"
                                        : "border-gray-200 bg-white text-slate-400 hover:border-gray-300 hover:text-slate-600"
                                }`}
                            >
                                <img src={logo} alt="" className={`h-4 w-4 object-contain transition-opacity ${active ? "opacity-100" : "opacity-40"}`} />
                                {name}
                            </button>
                        );
                    })}
                </div>

                {/* Browser frame */}
                <div className="relative rounded-2xl border border-gray-200 overflow-hidden bg-[#101014] shadow-2xl shadow-black/20">
                    {/* Title bar */}
                    <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/[0.06] bg-[#131318]">
                        <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                        <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                        <div className="w-3 h-3 rounded-full bg-[#28c840]" />
                        <div className="ml-4 flex-1 max-w-xs h-7 rounded-lg bg-[#1a1a20] border border-white/[0.06] flex items-center px-3">
                            <span className="text-[11px] text-gray-500 font-mono">app.monstera.cloud/sources</span>
                        </div>
                    </div>

                    {/* Dashboard body */}
                    <div className="p-6 sm:p-8 bg-[#101014]">
                        {/* Top bar */}
                        <div className="flex items-center justify-between mb-7">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center">
                                    <span className="font-black text-cyan-400 text-sm">M</span>
                                </div>
                                <div>
                                    <div className="text-[13px] font-semibold text-gray-100 text-left tracking-tight">My Workspace</div>
                                    <div className="text-[11px] text-gray-500 text-left transition-all duration-300">
                                        {count === 0 ? "No sources connected" : `${count} source${count > 1 ? "s" : ""} connected`}
                                    </div>
                                </div>
                            </div>
                            {count > 0 && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/[0.08] border border-emerald-500/20 transition-all duration-300">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    <span className="text-[11px] text-emerald-400 font-medium">All synced</span>
                                </span>
                            )}
                        </div>

                        {/* Source cards grid */}
                        {count > 0 ? (
                            <div className={`grid gap-3.5 transition-all duration-300 ${count === 1 ? "grid-cols-1 max-w-sm mx-auto" : "grid-cols-1 sm:grid-cols-2"}`}>
                                {activePlatforms.map(({ id, logo, name, metrics, syncedAgo }) => (
                                    <div key={id} className="rounded-xl border border-white/[0.06] bg-[#161620] p-5 text-left transition-all duration-300 animate-in fade-in">
                                        <div className="flex items-start justify-between mb-5">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-[#1c1c28] border border-white/[0.08] flex items-center justify-center">
                                                    <img src={logo} alt={name} className="h-5 w-5 object-contain" />
                                                </div>
                                                <div>
                                                    <div className="text-[13px] font-semibold text-gray-100">{name}</div>
                                                    <div className="text-[11px] text-gray-500 mt-0.5">{metrics}</div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5">
                                                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                                                <span className="text-[11px] font-medium text-emerald-400">Synced {syncedAgo}</span>
                                            </div>
                                            <div className="h-1.5 w-20 rounded-full bg-white/[0.04] overflow-hidden">
                                                <div className="h-full rounded-full w-full bg-emerald-500/25" />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="py-16 flex flex-col items-center justify-center gap-3">
                                <div className="w-12 h-12 rounded-2xl border border-dashed border-white/[0.08] flex items-center justify-center">
                                    <span className="text-gray-600 text-lg">+</span>
                                </div>
                                <p className="text-gray-600 text-sm">Select a platform above to connect</p>
                            </div>
                        )}

                        {/* Bottom bar */}
                        {count > 0 && (
                            <div className="mt-6 flex items-center justify-between pt-4 border-t border-white/[0.05] transition-all duration-300">
                                <span className="text-[11px] text-gray-500 font-mono">Next auto-refresh in 47 min</span>
                                <span className="text-[11px] text-gray-500">Destination: <span className="text-gray-400 font-medium">Google Sheets™</span></span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}

// ─────────────────────────────────────────────
// Tab icon map
// ─────────────────────────────────────────────
const TAB_ICONS: Record<string, React.ReactNode> = {
    plug: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
    ),
    refresh: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
    ),
    sheet: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
        </svg>
    ),
    zap: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
    ),
};

// ─────────────────────────────────────────────
// Feature Tabs
// ─────────────────────────────────────────────
type TabData = { id: string; label: string; icon: string; title: string; body: string; detail: string };

function FeatureTabs({ tabs, eyebrow }: { tabs: readonly TabData[]; eyebrow: string }) {
    const [active, setActive] = useState(0);
    const [tick, setTick] = useState(0);
    const tab = tabs[active];

    useEffect(() => {
        const id = setInterval(() => setActive(i => (i + 1) % tabs.length), 5000);
        return () => clearInterval(id);
    }, [tabs.length, tick]);

    const selectTab = (i: number) => {
        setActive(i);
        setTick(t => t + 1);
    };

    return (
        <section className="py-24 px-6 border-t border-gray-100">
            <div className="max-w-4xl mx-auto">
                <p className="font-mono text-[10px] text-slate-400 uppercase tracking-widest mb-10 text-center">{eyebrow}</p>

                {/* Tab bar */}
                <div className="flex items-center justify-center gap-1 mb-12">
                    {tabs.map((t, i) => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => selectTab(i)}
                            className={`relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
                                i === active
                                    ? "bg-cyan-50 text-cyan-700 border border-cyan-200 shadow-sm"
                                    : "text-slate-400 hover:text-slate-600 border border-transparent"
                            }`}
                        >
                            <span className={`transition-colors duration-300 ${i === active ? "text-cyan-500" : "text-slate-300"}`}>
                                {TAB_ICONS[t.icon] || null}
                            </span>
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* Content card */}
                <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-slate-50 shadow-sm">
                    <div
                        key={tab.id}
                        className="p-8 sm:p-12 animate-in fade-in duration-300"
                    >
                        <div className="flex items-start gap-5">
                            <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-cyan-50 border border-cyan-200 flex items-center justify-center text-cyan-500">
                                {TAB_ICONS[tab.icon] || null}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-xl sm:text-2xl font-bold text-slate-900 mb-3">{tab.title}</h3>
                                <p className="text-base text-slate-500 leading-relaxed mb-5">{tab.body}</p>
                                <p className="text-xs text-slate-400 font-mono tracking-wide">{tab.detail}</p>
                            </div>
                        </div>
                    </div>

                    {/* Progress bar at bottom */}
                    <div className="h-1 bg-gray-100 flex">
                        {tabs.map((_, i) => (
                            <div key={i} className="flex-1">
                                <div
                                    className={`h-full transition-all ${
                                        i === active ? "bg-cyan-500 animate-[progress_5s_linear]" : i < active ? "bg-cyan-200" : "bg-transparent"
                                    }`}
                                    style={i === active ? { animation: "progress 5s linear forwards" } : undefined}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────
export default function MarketingHomePage() {
    const [lang, setLang] = useState<Lang>("en");
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
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

    if (!mounted) return null;

    const c = COPY[lang];

    return (
        <div className="relative min-h-screen bg-white selection:bg-cyan-500/20">

            {/* ── 1. HERO ─────────────────────────────────────── */}
            <section className="relative pt-32 pb-20 overflow-hidden">
                <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-cyan-500/10 blur-[140px] rounded-full" />

                <div className="max-w-3xl mx-auto px-6 text-center relative">
                    <h1 className="text-4xl sm:text-5xl md:text-[4.2rem] font-black text-slate-900 tracking-tight leading-[1.08] mb-6">
                        {c.hero.h1[0]}<br />{c.hero.h1[1]}
                    </h1>
                    <p className="text-xl sm:text-2xl font-semibold text-slate-600 mb-2">
                        Pull{" "}
                        <WordRotator words={lang === "vi" ? HERO_WORDS_VI : HERO_WORDS_EN} />
                        {" "}into one clean sheet.
                    </p>

                    <p className="text-lg text-slate-500 mb-10 max-w-xl mx-auto leading-relaxed">
                        {c.hero.sub}
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-8">
                        <Link
                            href="/register"
                            className="group inline-flex items-center gap-2 px-7 py-3.5 text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded-xl transition-colors shadow-lg shadow-cyan-600/20"
                        >
                            {c.hero.cta}
                            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                        </Link>
                        <Link
                            href="/showcase"
                            className="inline-flex items-center gap-2 px-7 py-3.5 text-sm font-medium text-slate-500 hover:text-slate-900 border border-gray-200 hover:border-gray-300 rounded-xl transition-colors"
                        >
                            {c.hero.ctaSub} <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>

                    {/* Platform logos — compact, replaces architecture diagram */}
                    <div className="flex items-center justify-center gap-5 mb-10">
                        {HERO_LOGOS.map(({ src, alt }) => (
                            <Image key={alt} src={src} alt={alt} width={24} height={24} className="h-6 w-6 object-contain opacity-50 hover:opacity-80 transition-opacity" />
                        ))}
                    </div>

                    {/* Trust signals — visible, not buried */}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6">
                        {c.hero.trust.map(({ icon: Icon, text }) => (
                            <div key={text} className="flex items-center gap-2 text-xs text-slate-400">
                                <Icon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                <span>{text}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── STATS STRIP ───────────────────────────────── */}
            <section className="border-t border-gray-100">
                <div className="max-w-4xl mx-auto px-6 py-10 flex items-center justify-center gap-8 sm:gap-14">
                    {c.stats.map(({ value, label }, i) => (
                        <AnimatedStat key={label} value={value} label={label} delay={i * 150} />
                    ))}
                </div>
            </section>

            {/* ── TIME COMPARISON (static) ──────────────────── */}
            <section className="border-t border-gray-100 py-28 px-6">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight text-center mb-6">{c.timeCompare.heading}</h2>
                    <p className="text-center text-slate-400 text-sm mb-14">{c.timeCompare.sub}</p>

                    <div className="space-y-3 mb-8">
                        {c.timeCompare.steps.map(({ task, time }, i) => {
                            const isRepeat = time === "repeat" || time === "lặp lại";
                            const widths = ["w-[40%]", "w-[70%]", "w-[50%]", "w-full"];
                            return (
                                <div key={task} className="flex items-center gap-5">
                                    <span className="text-sm sm:text-base text-slate-600 w-52 sm:w-64 text-right shrink-0 font-medium">{task}</span>
                                    <div className="flex-1 flex items-center">
                                        <div className={`h-11 rounded-lg ${isRepeat ? "bg-red-50 border border-red-200 border-dashed" : "bg-red-50"} ${widths[i]} flex items-center justify-end pr-4`}>
                                            <span className={`text-sm font-mono font-bold ${isRepeat ? "text-red-300 italic" : "text-red-500"}`}>{time}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-5 mb-20">
                        <span className="text-sm sm:text-base text-slate-400 font-semibold w-52 sm:w-64 text-right shrink-0">Total</span>
                        <div className="flex-1 flex items-center gap-3 border-t border-red-200 pt-5">
                            <span className="text-4xl font-black text-red-500 tracking-tight">{c.timeCompare.total}</span>
                            <span className="text-base text-slate-400 font-medium">{c.timeCompare.unit}</span>
                        </div>
                    </div>

                    <div className="relative rounded-3xl border border-cyan-200 overflow-hidden">
                        <div className="absolute inset-0 bg-cyan-50" />
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(6,182,212,0.08)_0%,_transparent_60%)]" />
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-cyan-400/[0.06] blur-3xl" />
                        <div className="relative py-16 sm:py-20 px-8">
                            <div className="flex flex-col items-center text-center">
                                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-100 border border-cyan-200 mb-8">
                                    <Zap className="w-4 h-4 text-cyan-600" />
                                    <span className="text-xs text-cyan-600 font-bold uppercase tracking-widest">{c.timeCompare.after.label}</span>
                                </div>
                                <div className="flex items-baseline justify-center gap-3 mb-4">
                                    <span className="text-8xl sm:text-9xl font-black text-slate-900 leading-none tracking-tighter">{c.timeCompare.after.total}</span>
                                    <span className="text-2xl text-slate-400 font-semibold">{c.timeCompare.after.unit}</span>
                                </div>
                                <div className="w-16 h-px bg-cyan-300 my-5" />
                                <p className="text-cyan-600 font-semibold text-base mb-2">{c.timeCompare.after.setup}</p>
                                <p className="text-slate-400 text-sm max-w-xs">{c.timeCompare.after.tagline}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── SOCIAL PROOF TICKER — 2 rows, opposite directions ── */}
            <section className="border-t border-gray-100 py-16 overflow-hidden">
                <div className="relative flex flex-col gap-8">
                    <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-48 bg-gradient-to-r from-white to-transparent z-10" />
                    <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-48 bg-gradient-to-l from-white to-transparent z-10" />

                    {/* Row 1 — scrolls left */}
                    <div className="flex animate-[ticker_35s_linear_infinite] hover:[animation-play-state:paused] w-max gap-20">
                        {[...c.proofRow1, ...c.proofRow1].map(({ quote, author }, i) => (
                            <p key={`r1-${i}`} className="flex-shrink-0 text-[15px] whitespace-nowrap">
                                <em className="text-slate-500">&ldquo;{quote}&rdquo;</em>
                                <span className="text-slate-400 ml-2 not-italic font-medium text-sm">— {author}</span>
                            </p>
                        ))}
                    </div>

                    {/* Row 2 — scrolls right */}
                    <div className="flex animate-[ticker-reverse_40s_linear_infinite] hover:[animation-play-state:paused] w-max gap-20">
                        {[...c.proofRow2, ...c.proofRow2].map(({ quote, author }, i) => (
                            <p key={`r2-${i}`} className="flex-shrink-0 text-[15px] whitespace-nowrap">
                                <em className="text-slate-500">&ldquo;{quote}&rdquo;</em>
                                <span className="text-slate-400 ml-2 not-italic font-medium text-sm">— {author}</span>
                            </p>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── INTERACTIVE PRODUCT DEMO ─────────────────────── */}
            <InteractiveDemoSection copy={c.screenshot} />

            {/* ── 2. HOW IT WORKS ─────────────────────────────── */}
            <FeatureTabs tabs={c.how.tabs} eyebrow={c.how.eyebrow} />

            {/* ── 3. TRUST + CTA ──────────────────────────────── */}
            <section className="py-24 px-6">
                <div className="max-w-3xl mx-auto">
                    <div className="relative border border-cyan-200 bg-cyan-50/60 rounded-3xl overflow-hidden">
                        <div className="pointer-events-none absolute top-0 left-0 w-64 h-64 bg-cyan-400/10 blur-[80px]" />
                        <div className="pointer-events-none absolute bottom-0 right-0 w-64 h-64 bg-cyan-400/10 blur-[80px]" />

                        <div className="relative px-8 py-20 text-center">
                            <h2 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight mb-5">
                                {c.cta.h2[0]}<br />{c.cta.h2[1]}
                            </h2>
                            <p className="text-slate-500 text-sm mb-10 leading-relaxed max-w-md mx-auto">{c.cta.sub}</p>
                            <Link
                                href="/register"
                                className="group inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded-xl transition-colors shadow-xl shadow-cyan-600/20"
                            >
                                {c.cta.btn}
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                            </Link>
                            <p className="mt-8 font-mono text-[10px] text-slate-400 uppercase tracking-widest">{c.cta.trust}</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── 4. FOOTER ───────────────────────────────────── */}
            <footer className="border-t border-gray-100 py-16 px-6">
                <div className="max-w-6xl mx-auto">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-12">
                        {/* Brand */}
                        <div className="col-span-2 sm:col-span-1">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-7 h-7 rounded-lg bg-cyan-100 border border-cyan-200 flex items-center justify-center">
                                    <span className="font-black text-cyan-600 text-sm leading-none">M</span>
                                </div>
                                <span className="text-sm font-bold text-slate-900">Monstera Cloud</span>
                            </div>
                            <p className="text-xs text-slate-400 leading-relaxed max-w-[200px]">
                                Ad data → spreadsheets, automatically.
                            </p>
                        </div>

                        {/* Product */}
                        <div>
                            <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-4">{c.footer.product}</h4>
                            <ul className="space-y-2.5">
                                {c.footer.productLinks.map(({ label, href }) => (
                                    <li key={href}>
                                        <Link href={href} className="text-xs text-slate-500 hover:text-slate-900 transition-colors">{label}</Link>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Company */}
                        <div>
                            <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-4">{c.footer.company}</h4>
                            <ul className="space-y-2.5">
                                {c.footer.companyLinks.map(({ label, href }) => (
                                    <li key={href}>
                                        <Link href={href} className="text-xs text-slate-500 hover:text-slate-900 transition-colors">{label}</Link>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Legal */}
                        <div>
                            <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-4">{c.footer.legal}</h4>
                            <ul className="space-y-2.5">
                                {c.footer.legalLinks.map(({ label, href }) => (
                                    <li key={href}>
                                        <Link href={href} className="text-xs text-slate-500 hover:text-slate-900 transition-colors">{label}</Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    <LegalEntityNotice className="text-[10px] text-slate-500 leading-relaxed max-w-2xl mb-6" />
                    <div className="border-t border-gray-100 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
                        <p className="text-[10px] text-slate-400">{c.footer.copy}</p>
                        <p className="text-[10px] text-slate-400 italic">{c.cta.legal}</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}
