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
            h1: ["Turn ad & marketplace data", "into client-ready reporting."],
            sub: "Monstera Cloud gives marketing agencies one unified warehouse to connect, normalize, and automate performance reporting across Meta, Google Ads, TikTok, and Shopee — without spreadsheet cleanup.",
            cta: "Start 14-day agency pilot",
            ctaSub: "Explore dashboard templates",
            trust: [
                { icon: Shield, text: "Multi-tenant workspace isolation" },
                { icon: Lock, text: "Read-only OAuth 2.0 · AES-256 encrypted" },
                { icon: Eye, text: "Looker Studio & Google Sheets™ delivery" },
            ],
        },
        how: {
            eyebrow: "The agency data engine",
            tabs: [
                { id: "connect", label: "1. Connect", icon: "plug", title: "Connect all client sources", body: "Authorize client Meta Ads, Google Ads, TikTok, and Shopee accounts in one click via read-only OAuth. Zero credential sharing.", detail: "Multi-client account selection · OAuth 2.0 only" },
                { id: "sync", label: "2. Normalize", icon: "refresh", title: "Automated warehouse normalization", body: "Cross-platform spend, impressions, clicks, orders, and ROAS are normalized and stored in isolated PostgreSQL tables.", detail: "On-demand + nightly sync · Currency & timezone aligned" },
                { id: "report", label: "3. Deliver", icon: "sheet", title: "Deliver to Looker Studio & Sheets", body: "Push clean, client-ready data directly into Google Sheets™ or live Looker Studio dashboard templates. Zero copy-paste.", detail: "Looker Studio community connector · Google Sheets™ add-on" },
                { id: "optimize", label: "4. Scale", icon: "zap", title: "Scale across dozens of brands", body: "Manage unlimited client brands with isolated workspaces and granular team roles (Owner, Admin, Member, Viewer).", detail: "Save 15+ hours/week across client accounts" },
            ],
        },
        cta: {
            h2: ["Stop manual reporting.", "Scale your agency."],
            sub: "Start a 14-day agency pilot with demo metrics or connect your first client source in 5 minutes. No credit card required.",
            btn: "Start 14-day agency pilot",
            trust: "No credit card required · Read-only OAuth · VND & USD billing",
            legal: "Google Sheets™ and Google Workspace™ are trademarks of Google LLC. Monstera Cloud is not affiliated with Google.",
        },
        stats: [
            { value: "< 60s", label: "First client sync" },
            { value: "6", label: "Certified sources" },
            { value: "0", label: "Spreadsheet cleanup" },
            { value: "100%", label: "Workspace isolated" },
        ],
        timeCompare: {
            heading: "Where does your agency's time go?",
            sub: "Every week, manual client reporting steals billable hours from growth and strategy.",
            steps: [
                { task: "Export CSVs across client ad accounts", time: "45 min" },
                { task: "Reconcile currency, ROAS & data drift", time: "85 min" },
                { task: "Format client decks & Google Sheets", time: "60 min" },
                { task: "Repeat for every client next week", time: "repeat" },
            ],
            total: "3h 10min",
            unit: "/client /week",
            after: {
                label: "With Monstera Cloud",
                total: "0 min",
                unit: "/week",
                setup: "5 min one-time workspace setup",
                tagline: "Automated client dashboards that update themselves every day.",
            },
        },
        proofRow1: [
            { quote: "Saved our agency 15+ hours every week across 12 client accounts.", author: "D.T., Agency Founder" },
            { quote: "Finally Shopee Ads, TikTok, and Meta in one normalized Looker Studio report.", author: "M.K., Performance Director" },
            { quote: "Client reporting went from 2 days of manual exports to zero.", author: "H.V., Media Lead" },
            { quote: "Our account managers stopped fighting over currency and attribution discrepancies.", author: "A.L., Head of Growth" },
        ],
        proofRow2: [
            { quote: "Our clients love having live Looker Studio decks that update automatically.", author: "K.R., Operations Director" },
            { quote: "Zero client data leaks between brand workspaces. Strict tenant isolation.", author: "T.P., Agency Technical Lead" },
            { quote: "Best ROI on any data infrastructure tool we have adopted.", author: "L.N., Managing Partner" },
            { quote: "Monday reporting standups are completely automated now.", author: "P.H., Performance Lead" },
        ],
        showcase: {
            eyebrow: "Connects to",
            from: "Client platforms",
            to: "Client dashboards",
        },
        screenshot: {
            eyebrow: "Multi-client console",
            heading: "One agency warehouse. Every client platform.",
            sub: "Real-time multi-channel sync, connection health monitoring, and automated metrics flowing into client dashboards.",
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
            h1: ["Biến dữ liệu quảng cáo & sàn", "thành báo cáo khách hàng tự động."],
            sub: "Monstera Cloud cung cấp cho agency một kho dữ liệu hợp nhất để kết nối, chuẩn hóa và tự động hóa báo cáo trên Meta, Google Ads, TikTok và Shopee — không còn dọn dẹp bảng tính thủ công.",
            cta: "Dùng thử 14 ngày cho Agency",
            ctaSub: "Khám phá mẫu dashboard",
            trust: [
                { icon: Shield, text: "Tách biệt Workspace đa khách hàng" },
                { icon: Lock, text: "Chỉ OAuth 2.0 đọc · Mã hóa AES-256" },
                { icon: Eye, text: "Đẩy thẳng Looker Studio & Google Sheets™" },
            ],
        },
        how: {
            eyebrow: "Quy trình dữ liệu agency",
            tabs: [
                { id: "connect", label: "1. Kết nối", icon: "plug", title: "Kết nối mọi tài khoản khách hàng", body: "Ủy quyền tài khoản Meta Ads, Google Ads, TikTok và Shopee của khách hàng trong 1 click qua OAuth chỉ đọc. Không cần chia sẻ mật khẩu.", detail: "Chọn lọc tài khoản khách hàng · Chỉ OAuth 2.0" },
                { id: "sync", label: "2. Chuẩn hóa", icon: "refresh", title: "Tự động chuẩn hóa dữ liệu kho", body: "Chi phí, hiển thị, nhấp chuột, đơn hàng và ROAS đa kênh được chuẩn hóa và lưu trữ an toàn trong PostgreSQL riêng biệt.", detail: "Đồng bộ thủ công & hàng đêm · Đồng nhất tiền tệ & múi giờ" },
                { id: "report", label: "3. Xuất báo cáo", icon: "sheet", title: "Đến thẳng Looker Studio & Sheets", body: "Dữ liệu sạch sẵn sàng đẩy vào Google Sheets™ hoặc các mẫu dashboard Looker Studio động cho khách hàng xem.", detail: "Kết nối Looker Studio · Add-on Google Sheets™" },
                { id: "optimize", label: "4. Mở rộng", icon: "zap", title: "Mở rộng quy mô hàng chục thương hiệu", body: "Quản lý nhiều thương hiệu khách hàng với Workspace riêng biệt và phân quyền thành viên chi tiết (Owner, Admin, Member, Viewer).", detail: "Tiết kiệm 15+ giờ/tuần trên toàn bộ khách hàng" },
            ],
        },
        cta: {
            h2: ["Dừng làm báo cáo thủ công.", "Mở rộng quy mô Agency."],
            sub: "Bắt đầu dùng thử 14 ngày với dữ liệu mẫu hoặc kết nối nguồn khách hàng đầu tiên trong 5 phút. Không cần thẻ tín dụng.",
            btn: "Bắt đầu dùng thử Agency",
            trust: "Không cần thẻ tín dụng · OAuth chỉ đọc · Thanh toán VND & USD",
            legal: "Google Sheets™ và Google Workspace™ là thương hiệu của Google LLC. Monstera Cloud không liên kết với Google.",
        },
        stats: [
            { value: "< 60s", label: "Đồng bộ đầu" },
            { value: "6", label: "Nguồn chứng nhận" },
            { value: "0", label: "Dọn dẹp bảng tính" },
            { value: "100%", label: "Tách biệt Workspace" },
        ],
        timeCompare: {
            heading: "Thời gian của agency đang đi đâu?",
            sub: "Mỗi tuần, việc làm báo cáo khách hàng thủ công lấy đi hàng giờ chiến lược của team.",
            steps: [
                { task: "Xuất CSV từ các tài khoản quảng cáo", time: "45 phút" },
                { task: "Quy đổi tỷ giá, ROAS & đối chiếu lệch số", time: "85 phút" },
                { task: "Định dạng slide báo cáo & Google Sheets", time: "60 phút" },
                { task: "Lặp lại cho từng khách hàng tuần sau", time: "lặp lại" },
            ],
            total: "3h 10min",
            unit: "/khách hàng /tuần",
            after: {
                label: "Với Monstera Cloud",
                total: "0 phút",
                unit: "/tuần",
                setup: "5 phút cài đặt Workspace một lần",
                tagline: "Dashboard khách hàng tự động cập nhật mỗi ngày.",
            },
        },
        proofRow1: [
            { quote: "Tiết kiệm hơn 15 giờ mỗi tuần trên 12 tài khoản khách hàng của agency chúng tôi.", author: "D.T., Chủ Agency" },
            { quote: "Cuối cùng Shopee Ads, TikTok và Meta nằm chung một báo cáo Looker Studio chuẩn.", author: "M.K., Performance Director" },
            { quote: "Báo cáo khách hàng từ mất 2 ngày xuất file nay hoàn toàn tự động.", author: "H.V., Media Lead" },
            { quote: "Account manager không còn cãi nhau vì lệch số tiền tệ và attribution.", author: "A.L., Head of Growth" },
        ],
        proofRow2: [
            { quote: "Khách hàng rất thích khi có link Looker Studio động tự cập nhật mỗi sáng.", author: "K.R., Operations Director" },
            { quote: "Không lo rò rỉ dữ liệu giữa các thương hiệu khách hàng. Phân quyền rất chặt chẽ.", author: "T.P., Agency Tech Lead" },
            { quote: "ROI tốt nhất trong các công cụ dữ liệu mà chúng tôi từng triển khai.", author: "L.N., Managing Partner" },
            { quote: "Cuộc họp báo cáo sáng thứ Hai diễn ra nhanh hơn và có số liệu ngay tức thì.", author: "P.H., Performance Lead" },
        ],
        showcase: {
            eyebrow: "Kết nối với",
            from: "Nền tảng khách hàng",
            to: "Dashboard khách hàng",
        },
        screenshot: {
            eyebrow: "Console đa khách hàng",
            heading: "Một kho dữ liệu agency. Mọi nền tảng khách hàng.",
            sub: "Theo dõi sức khỏe đồng bộ đa kênh theo thời gian thực và tự động đưa số liệu vào dashboard khách hàng.",
        },
        footer: {
            product: "Sản phẩm",
            productLinks: [
                { label: "Nguồn dữ liệu", href: "/sources" },
                { label: "Xuất Dữ Liệu", href: "/exports" },
                { label: "Bảng giá", href: "/pricing" },
            ],
            company: "Company",
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
                        {lang === "vi" ? "Hợp nhất dữ liệu " : "Unified performance across "}
                        <WordRotator words={lang === "vi" ? HERO_WORDS_VI : HERO_WORDS_EN} />
                        {lang === "vi" ? " cho toàn bộ khách hàng." : " for all your clients."}
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
